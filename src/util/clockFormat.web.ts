// Web/desktop: no system 24-hour toggle exists, so the locale is the only
// signal. `hour12` is undefined for locales that don't state a preference —
// treat that as 12-hour, matching Intl's own default formatting.

// Resolved once: the locale cannot change without reloading the page.
const use24 = Intl.DateTimeFormat().resolvedOptions().hour12 === false;

export function prefers24Hour(): boolean {
  return use24;
}
