/**
 * HTTP mode: area pages whose API routes do not exist yet (slices 8–11). They show the calm
 * "coming soon" state instead of calling a method that answers not_implemented.
 */
const UNSERVED = [
  /^\/clinic\/(patients|audit|settings|account)(\/|$)/,
  /^\/platform\/?$/,
  /^\/platform\/clinics\/?$/,
  /^\/platform\/(team|settings|audit)(\/|$)/,
];

export function isUnservedPath(pathname: string): boolean {
  return UNSERVED.some((pattern) => pattern.test(pathname));
}
