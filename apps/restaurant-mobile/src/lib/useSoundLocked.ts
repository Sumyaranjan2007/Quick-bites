/** Phones play the order sound without a tap first; only a browser blocks it (see useSoundLocked.web.ts). */
export function useSoundLocked(): boolean {
  return false;
}
