/**
 * The console's API client.
 *
 * One place that knows the base URL, attaches the token, and turns a failure
 * into a sentence. Screens previously each did their own fetch and their own
 * `data.error?.message || data.error || 'Something went wrong'` dance, and the
 * inconsistency showed: some failures surfaced as a readable message, others as
 * "[object Object]".
 */
import { apiFetch } from './apiFetch';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the server refused on permissions rather than on the request. */
  get isPermissionDenied(): boolean {
    return this.status === 403 || this.code === 'PERMISSION_DENIED' || this.code === 'ROLE_DISABLED';
  }
}

export interface ApiClient {
  baseUrl: string;
  token: string;
  get: <T = any>(path: string) => Promise<T>;
  post: <T = any>(path: string, body?: any) => Promise<T>;
  patch: <T = any>(path: string, body?: any) => Promise<T>;
  put: <T = any>(path: string, body?: any) => Promise<T>;
  del: <T = any>(path: string) => Promise<T>;
}

function messageFrom(payload: any, status: number): { message: string; code: string } {
  const error = payload?.error;

  // A validation failure names its field; lead with that rather than with the
  // wrapper sentence, which tells an operator nothing they can act on.
  const details = error?.details;
  if (Array.isArray(details) && details.length) {
    const issues = details
      .filter((d: any) => d?.issue)
      .map((d: any) => (d.field ? `${d.field}: ${d.issue}` : d.issue));
    if (issues.length) {
      return { message: issues.join('\n'), code: error?.code || `HTTP_${status}` };
    }
  }

  if (typeof error === 'string') return { message: error, code: `HTTP_${status}` };
  if (error?.message) return { message: error.message, code: error.code || `HTTP_${status}` };
  if (payload?.message) return { message: payload.message, code: `HTTP_${status}` };
  if (status === 401) return { message: 'Your session has expired. Sign in again.', code: 'UNAUTHORIZED' };
  if (status === 403) return { message: 'Your role does not allow this.', code: 'FORBIDDEN' };
  return { message: `The server returned an unexpected error (${status}).`, code: `HTTP_${status}` };
}

export function createClient(baseUrl: string, token: string): ApiClient {
  async function request<T>(method: string, path: string, body?: any): Promise<T> {
    const response = await apiFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const { message, code } = messageFrom(payload, response.status);
      throw new ApiError(message, response.status, code);
    }
    return (payload?.data ?? payload) as T;
  }

  return {
    baseUrl,
    token,
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    del: path => request('DELETE', path)
  };
}

/** Query-string builder that drops empty values, so `?q=&status=` never happens. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
