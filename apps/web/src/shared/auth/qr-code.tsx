import { qrMatrix } from "./qr-matrix";

/** The otpauth URI as an SVG QR code, with a quiet zone of four modules. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const matrix = qrMatrix(value);
  if (!matrix) return null;
  const size = matrix.length + 8;
  let d = "";
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="size-48 rounded-md border bg-card text-foreground"
      shapeRendering="crispEdges"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
