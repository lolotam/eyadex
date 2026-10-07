import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { areaOfHost, type Area } from "@/shared/api/area-host";
import { DEFAULT_PERSONA, PersonaContext, SESSION_KEY, type PersonaValue } from "./persona-context";
import { isSessionReady } from "./session-readiness";
import { useHttpSessionGuard } from "./use-http-session-guard";

const noop = () => undefined;

/**
 * HTTP mode: the cookie is the sign-in. The persona is built from the session the API returns,
 * never from a role name. Nothing runs on the server: the area and the session are read after
 * mount, and `ready` stays false until the session has loaded.
 */
export function HttpPersonaProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [area, setArea] = useState<Area | null | undefined>(undefined);
  useEffect(() => setArea(areaOfHost(window.location.hostname)), []);
  const enabled = area === "clinic" || area === "platform";
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.session.getContext(DEFAULT_PERSONA),
    enabled,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  useHttpSessionGuard(query.error);

  const value = useMemo<PersonaValue>(() => {
    const ready = isSessionReady(area, query.data !== undefined);
    return {
      persona: query.data?.persona ?? DEFAULT_PERSONA,
      ready,
      setPersona: noop,
      http: {
        area,
        session: query.data,
        isLoading: area === undefined || (enabled && query.isPending),
        error: query.error,
        retry: () => void query.refetch(),
      },
    };
  }, [area, enabled, query]);

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}
