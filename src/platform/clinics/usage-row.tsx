import { Progress } from "@/components/ui/progress";

export function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {max}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}

