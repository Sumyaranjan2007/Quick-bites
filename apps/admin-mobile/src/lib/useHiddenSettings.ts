/**
 * Keeps the "Server settings" field out of the way of people who are not
 * looking for it.
 *
 * Every one of these apps can be pointed at a different backend. That is
 * genuinely needed — it is how a build gets tested against a laptop, a staging
 * server and production without four builds — and it is also a field that
 * should never be the second thing a customer sees on the sign-in screen. A
 * visible "Backend API URL" box invites somebody to type in it, and an app
 * pointed at nothing looks broken in a way its owner cannot undo.
 *
 * So it is still there and it is no longer on display. Six deliberate taps on
 * the logo reveals it for the rest of that session; the app is never left in a
 * state where a tester cannot reach it, and nothing is hidden from anyone who
 * knows it exists.
 *
 * Six rather than three: a child handing the phone back taps twice, a slow
 * double-tap on a logo is common, and three would be reachable by accident.
 * The window between taps is what stops taps spread over a whole sitting from
 * accumulating into an unlock.
 */
import { useCallback, useRef, useState } from 'react';

const TAPS_REQUIRED = 6;
const WINDOW_MS = 2500;

export function useHiddenSettings() {
  const [unlocked, setUnlocked] = useState(false);
  const taps = useRef(0);
  const lastTap = useRef(0);

  const registerTap = useCallback(() => {
    const now = Date.now();
    // A pause resets the count rather than adding to it, so two taps now and
    // four taps a minute later do not open anything.
    taps.current = now - lastTap.current > WINDOW_MS ? 1 : taps.current + 1;
    lastTap.current = now;
    if (taps.current >= TAPS_REQUIRED) {
      taps.current = 0;
      setUnlocked(true);
    }
  }, []);

  return { unlocked, registerTap };
}
