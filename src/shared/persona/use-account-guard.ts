import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorCodeOf } from "@/shared/api/api-error";

/**
 * Story 63: when any request reports the signed-in account as deactivated,
 * the session ends at once and the user is sent to sign-in with a clear message.
 */
export function useAccountDisabledGuard(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let leaving = false;
    const leave = (error: unknown) => {
      if (leaving || errorCodeOf(error) !== "account_disabled") return;
      leaving = true;
      queryClient.removeQueries({ queryKey: ["clinic"] });
      queryClient.removeQueries({ queryKey: ["platform"] });
      void navigate({ to: "/login", search: { reason: "disabled" } });
    };
    const unsubQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated") leave(event.query.state.error);
    });
    const unsubMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated") leave(event.mutation?.state.error);
    });
    for (const query of queryClient.getQueryCache().getAll()) leave(query.state.error);
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [navigate, queryClient]);
}
