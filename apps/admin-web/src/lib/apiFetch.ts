/**
 * fetch with a hard timeout.
 *
 * Plain fetch has no timeout: on a flaky mobile connection a request can hang
 * indefinitely, leaving the user on a spinner with no error and no retry. Every
 * network call in the app goes through this so a stalled request surfaces as a
 * readable failure instead of a frozen screen.
 */
export const DEFAULT_TIMEOUT_MS = 15000;

export class TimeoutError extends Error {
  constructor(message = 'The server took too long to respond. Check your connection and try again.') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new TimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
