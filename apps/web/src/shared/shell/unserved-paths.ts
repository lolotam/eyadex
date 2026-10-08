/**
 * HTTP mode: area pages whose API routes do not exist yet (slices 8–11). They show the calm
 * "coming soon" state instead of calling a method that answers not_implemented.
 */
const UNSERVED = [
  /^\/clinic\/(audit|settings|account)(\/|$)/,
  /^\/platform\/?$/,
  /^\/platform\/clinics\/?$/,
  /^\/platform\/(team|settings|audit)(\/|$)/,
];

export function isUnservedPath(pathname: string): boolean {
  return UNSERVED.some((pattern) => pattern.test(pathname));
}

/**
 * The platform home and clinic list are unserved, but they hold the only link to creating a clinic,
 * which the API does serve; their "coming soon" state keeps that action.
 */
export function comingSoonActionFor(pathname: string): "createClinic" | null {
  return /^\/platform(\/clinics)?\/?$/.test(pathname) ? "createClinic" : null;
}
