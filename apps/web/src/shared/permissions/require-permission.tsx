import type { ReactNode } from "react";
import type {
  PermissionAction,
  PermissionResource,
  PermissionScope,
} from "@eyadex/contracts/permissions";
import { useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { can } from "./can";

type Props = {
  action?: PermissionAction;
  resource: PermissionResource;
  /** When set, only a key in one of these scopes opens the page. */
  scopes?: readonly PermissionScope[];
  children: ReactNode;
};

export function RequirePermission({ action = "view", resource, scopes, children }: Props) {
  const { session, isLoading } = useSession();
  if (isLoading || !session) return <LoadingBlock />;
  if (!can(session.permissions, action, resource, scopes)) return <ForbiddenPage />;
  return <>{children}</>;
}
