import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { useAuthClient } from "./use-auth-client";

/** HTTP mode header: who is signed in, and sign-out. */
export function HttpAccountMenu() {
  const { t } = useI18n();
  const { session } = useSession();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await auth.signOut();
    } finally {
      queryClient.clear();
      void navigate({ to: "/login" });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-2 text-sm sm:flex">
        <UserRound className="size-4" aria-hidden />
        {session?.user.fullName}
      </span>
      <Button variant="outline" size="sm" className="gap-2 bg-card" onClick={() => void signOut()}>
        <LogOut className="size-4" aria-hidden />
        {t("auth.signOut")}
      </Button>
    </div>
  );
}
