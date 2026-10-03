import { Link } from "@tanstack/react-router";
import { useI18n } from "@/shared/i18n/i18n-provider";
import type { NavItem } from "./nav-items";

export function AreaNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.exact ?? false }}
            className="relative flex h-10 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
            activeProps={{
              className:
                "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary",
            }}
          >
            <Icon className="size-4 shrink-0" />
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
