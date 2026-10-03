import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "./persona-provider";
import { PersonaPicker } from "./persona-picker";

export function PersonaSwitcher() {
  const { t } = useI18n();
  const { persona } = usePersona();
  const { session } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 bg-card">
          <UserRound className="size-4" />
          <span className="hidden sm:inline">
            {session?.user.fullName ?? t(`persona.${persona.kind}`)}
          </span>
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
            {t(`persona.${persona.kind}`)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PersonaPicker onDone={() => setOpen(false)} />
        <Button asChild variant="ghost" size="sm" className="mt-3 w-full justify-start gap-2">
          <Link to="/login" onClick={() => setOpen(false)}>
            <LogOut className="size-4" />
            {t("persona.signOut")}
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
