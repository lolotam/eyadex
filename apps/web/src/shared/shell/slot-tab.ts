import type { ReactNode } from "react";
import type { TranslationKey } from "@/shared/i18n/dictionary";

/**
 * A tab one business area hands another through a route (CLAUDE.architecture.md §1.1: areas never
 * import each other), so the host page shows it without knowing what it holds.
 */
export type SlotTab<Context> = {
  id: string;
  labelKey: TranslationKey;
  /** Whether the session's keys show the tab (UX only: the API refuses too). */
  visible: (permissions: readonly string[]) => boolean;
  /** Called only while the tab is open, so an audited read happens only when the user opens it. */
  render: (context: Context) => ReactNode;
};
