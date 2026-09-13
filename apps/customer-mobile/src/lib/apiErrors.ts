/**
 * Turns an API error payload into something a person can act on.
 *
 * The server already says exactly what is wrong and which field is wrong:
 *
 *   { error: { message: "Request payload validation failed.",
 *              details: [{ field: "password", issue: "Password must be at least 8 characters" }] } }
 *
 * The apps were showing only `message`, so a sign-up with a short password
 * failed with "Request payload validation failed." and no indication of the
 * cause. The detail is the useful half; surface it against the field it names.
 */
export interface FieldIssue {
  field: string;
  issue: string;
}

export interface ParsedApiError {
  /** Per-field problems, keyed by field name, for inline display. */
  fieldErrors: Record<string, string>;
  /** A single sentence suitable for a banner when nothing is field-specific. */
  message: string;
}

export function parseApiError(payload: any, fallback = 'Something went wrong. Please try again.'): ParsedApiError {
  const error = payload?.error;
  const details: FieldIssue[] = Array.isArray(error?.details) ? error.details : [];

  const fieldErrors: Record<string, string> = {};
  for (const detail of details) {
    if (detail?.field && detail?.issue && !fieldErrors[detail.field]) {
      fieldErrors[detail.field] = detail.issue;
    }
  }

  // Prefer a field issue over the generic wrapper: "Password must be at least 8
  // characters" tells the user what to do, "validation failed" does not.
  const firstIssue = details[0]?.issue;
  const message =
    firstIssue ||
    (typeof error === 'string' ? error : undefined) ||
    error?.message ||
    payload?.message ||
    fallback;

  return { fieldErrors, message };
}
