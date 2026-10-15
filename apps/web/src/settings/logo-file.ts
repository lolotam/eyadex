/** The logo limit of spec §2: 1 MB. */
export const MAX_LOGO_BYTES = 1024 * 1024;

/** PNG or JPEG of at most 1 MB; the API refuses anything else as well. */
export function isAcceptedLogo(file: { type: string; size: number }): boolean {
  return (file.type === "image/png" || file.type === "image/jpeg") && file.size <= MAX_LOGO_BYTES;
}
