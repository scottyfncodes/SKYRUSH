/**
 * Short vibration pulses for high-value moments. Only browsers that implement
 * the Vibration API respond (iOS Safari does not), so nothing in the game may
 * depend on them; every pulse also has a visual and audio cue.
 */
export const pulse = (enabled: boolean, pattern: number | number[]): void => {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when vibration is blocked; feedback is optional.
  }
};

/** True when the player asked the OS to minimise motion. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
