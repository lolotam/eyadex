import type { ReactNode } from "react";
import type { PermissionAction, PermissionResource } from "@contracts/permissions";
import { useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { can } from "./can";

type Props = { action?: PermissionAction; resource: PermissionResource; children: ReactNode };

export function RequirePermission({ action = "view", resource, children }: Props) {
  const { session, isLoading } = useSession();
  if (isLoading || !session) return <LoadingBlock />;
  if (!can(session.permissions, action, resource)) return <ForbiddenPage />;
  return <>{children}</>;
}
