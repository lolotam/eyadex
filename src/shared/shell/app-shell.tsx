import { useState, type ReactNode } from "react";
import { Menu, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LanguageSwitch } from "@/shared/i18n/language-switch";
import { PersonaSwitcher } from "@/shared/persona/persona-switcher";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import type { NavItem } from "./nav-items";
import { AreaNav } from "./area-nav";

type Props = { areaLabel: TranslationKey; subtitle?: string; items: NavItem[]; children: ReactNode };

function Brand({ areaLabel, subtitle }: { areaLabel: TranslationKey; subtitle?: string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3 py-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Stethoscope className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{t("app.name")}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle ?? t(areaLabel)}</div>
      </div>
    </div>
  );
}

export function AppShell({ areaLabel, subtitle, items, children }: Props) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-e bg-sidebar md:flex">
        <Brand areaLabel={areaLabel} subtitle={subtitle} />
        <div className="px-2">
          <AreaNav items={items} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("nav.menu")}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 bg-sidebar p-2">
              <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
              <Brand areaLabel={areaLabel} subtitle={subtitle} />
              <AreaNav items={items} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="text-sm font-medium text-muted-foreground">{t(areaLabel)}</div>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitch />
            <PersonaSwitcher />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
