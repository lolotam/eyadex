/**
 * HTTP mode: area pages whose API routes do not exist yet (slices 8–11). They show the calm
 * "coming soon" state instead of calling a method that answers not_implemented.
 */
const UNSERVED = [
  /^\/clinic\/(settings|account)(\/|$)/,
  /^\/platform\/?$/,
  /^\/platform\/(team|settings)(\/|$)/,
];

export function isUnservedPath(pathname: string): boolean {
  return UNSERVED.some((pattern) => pattern.test(pathname));
}

/**
 * The platform home (overview, slice 11) is unserved, but it holds a link to creating a clinic,
 * which the API does serve; its "coming soon" state keeps that action.
 */
export function comingSoonActionFor(pathname: string): "createClinic" | null {
  return /^\/platform\/?$/.test(pathname) ? "createClinic" : null;
}
