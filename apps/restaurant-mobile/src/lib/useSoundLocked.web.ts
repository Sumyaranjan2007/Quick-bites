import { useEffect, useState } from 'react';

/**
 * True until the page has been clicked or typed in (owner, 23 Oct 2026: the sound in every scenario). A browser plays
 * no sound for a page nobody has touched, so a Partner website reopened on the counter PC stayed silent for every new
 * order. Browsers without `userActivation` are not asked about (false).
 */
export function useSoundLocked(): boolean {
  const [locked, setLocked] = useState(() => (globalThis as any).navigator?.userActivation?.hasBeenActive === false);
  useEffect(() => {
    if (!locked) return;
    const unlock = () => setLocked(false);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [locked]);
  return locked;
}
