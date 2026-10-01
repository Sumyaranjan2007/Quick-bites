/**
 * The name a saved document gets (owner, 1 Oct 2026): what it is, whose, and
 * the date, e.g. `Bangalore-Biryani-House_FSSAI_2026-10-01`. No imports, so
 * the backend gate can check it.
 */
/** A file name a person can read, with no characters a file system refuses. */
export function documentFileName(parts: Array<string | undefined | null>): string {
  // India's date, not UTC's: a document saved at 1 am is dated today.
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return [...parts, date]
    .filter(Boolean)
    .map(p => String(p).trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('_')
    .slice(0, 90);
}
