/** Wait for the kernel to confirm that the killed Linux process group has no members. */
export async function pdfProcessGroupGone(pid: number): Promise<boolean> {
  const deadline = performance.now() + 1000;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    if (performance.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
