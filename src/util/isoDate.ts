// YYYY-MM-DD <-> Date, in LOCAL time.
//
// `new Date('2026-07-14')` parses as UTC and can land on the previous day west
// of Greenwich, which is exactly the kind of off-by-one a schedule anchor must
// not have. These build from local components instead.

/** Local midnight of a YYYY-MM-DD string; today if it isn't a valid date. */
export function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    return new Date();
  }
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects impossible dates like 2026-02-31, which Date would roll over.
  return date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d) ? date : new Date();
}

/** YYYY-MM-DD from a Date's local components. */
export function dateToIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
