/**
 * Zod 4 dropped `invalid_type_error`. A missing value stays the old "Required" text; any present
 * value, including a wrong type, keeps that field's i18n key. Not a process-wide error map.
 */
export function requiredOr(message: string): (issue: { input?: unknown }) => string {
  return (issue) => (issue.input === undefined ? "Required" : message);
}
