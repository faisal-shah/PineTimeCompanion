// Pure time rendering, deliberately free of imports so it stays unit-testable
// without pulling in the platform (clockFormat reaches into a native module).
// formatTime.ts is the platform-aware layer on top.

/** "21:05" when use24, else "9:05 PM". */
export function renderTime(hour: number, minute: number, use24: boolean): string {
  const mm = String(minute).padStart(2, '0');
  if (use24) {
    return `${String(hour).padStart(2, '0')}:${mm}`;
  }
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${mm} ${suffix}`;
}
