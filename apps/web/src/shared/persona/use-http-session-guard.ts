import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorCodeOf } from "@/shared/api/api-error";
import { onUnauthorized } from "@/shared/api/http/http-transport";

const AREA_PATH = /^\/(clinic|platform)(\/|$)/;

/**
 * HTTP mode: a 401 on any `/v1` call (or no session at all) clears the cached session and data and
 * sends the user to sign-in. The platform also goes there while its second factor is missing.
 */
export function useHttpSessionGuard(sessionError: unknown): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const leave = useCallback(() => {
    if (!AREA_PATH.test(window.location.pathname)) return;
    queryClient.removeQueries({ queryKey: ["clinic"] });
    queryClient.removeQueries({ queryKey: ["platform"] });
    queryClient.removeQueries({ queryKey: ["session"] });
    void navigate({ to: "/login" });
  }, [navigate, queryClient]);

  useEffect(() => onUnauthorized(leave), [leave]);

  useEffect(() => {
    const code = errorCodeOf(sessionError);
    if (code === "unauthorized" || code === "two_factor_required") leave();
  }, [leave, sessionError]);
}
