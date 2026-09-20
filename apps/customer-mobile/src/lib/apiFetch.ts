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

/*
 * What the app does when the server says this account may no longer act.
 *
 * Blocking an account applies to the session the customer already has open
 * rather than to a next sign-in that a blocked account will never make, so the
 * refusal arrives on whatever request happens next — a feed refresh, a basket,
 * a checkout. Every screen here calls `apiFetch` directly and parses its own
 * errors, so without this the block reads as a different unexplained failure on
 * each screen and the customer goes on tapping.
 *
 * Registered by the shell rather than imported from it, so this module keeps
 * knowing nothing about the screens.
 */
type SessionEndedReason = { code: 'ACCOUNT_BLOCKED' | 'ACCOUNT_NOT_FOUND'; message: string };
let onSessionEnded: ((reason: SessionEndedReason) => void) | null = null;

export function setSessionEndedHandler(handler: ((reason: SessionEndedReason) => void) | null): void {
  onSessionEnded = handler;
}

/**
 * Reads the refusal WITHOUT consuming the body the caller is about to read.
 *
 * `res.clone()` matters here: every screen reads `res.json()` itself, and a
 * body can only be read once. Peeking at the original would leave the caller
 * with an empty response and turn a clear "your account was blocked" into a
 * parse error on whichever screen happened to be open.
 */
function notifyIfSessionEnded(res: Response): void {
  if (res.status !== 401 && res.status !== 403) return;
  if (!onSessionEnded) return;
  res
    .clone()
    .json()
    .then((body: any) => {
      const code = body?.error?.code;
      if (code === 'ACCOUNT_BLOCKED' || code === 'ACCOUNT_NOT_FOUND') {
        onSessionEnded?.({
          code,
          message: body?.error?.message || 'This account is no longer active. Contact Quick Bites support.'
        });
      }
    })
    .catch(() => {
      /* a refusal we cannot read is left to the caller to report */
    });
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    notifyIfSessionEnded(res);
    return res;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new TimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
