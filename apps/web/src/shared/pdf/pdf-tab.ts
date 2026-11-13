/**
 * Lessons 6.1/6.2: the tab opens inside the click (before any await, or the browser blocks it), is
 * pointed at the file once it arrives, and the object URL is always revoked. A blocked popup falls
 * back to a normal download link; a failed download closes the empty tab.
 */
export function openPdfTab(): Window | null {
  // No "noopener": with it window.open returns null and the tab could not be navigated later.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

const REVOKE_AFTER_MS = 60_000;

export function showPdf(tab: Window | null, blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  if (tab && !tab.closed) {
    tab.location.href = url;
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function closePdfTab(tab: Window | null): void {
  if (tab && !tab.closed) tab.close();
}
