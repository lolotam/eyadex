/** A signed amount: the minus sign carries the meaning, the destructive tint only repeats it. */
export function SignedAmount({ minor, text }: { minor: string; text: string }) {
  const negative = minor.startsWith("-");
  return (
    <bdi className={negative ? "text-destructive" : undefined} data-negative={negative || undefined}>
      {text}
    </bdi>
  );
}
