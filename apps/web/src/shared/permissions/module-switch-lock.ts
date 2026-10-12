import { MODULE_REQUIRES } from "@eyadex/contracts/onboarding";

/**
 * Would flipping this module's switch break "a module needs the module it requires" (PR #70)? Off →
 * on is locked while its required module is off; on → off is locked while a module needing it is on.
 * UX only: the API refuses the gap too (`validation.moduleRequires`).
 */
export function moduleSwitchLocked(
  module: string,
  flags: Readonly<Record<string, boolean>>,
): boolean {
  const requires = (MODULE_REQUIRES as Readonly<Record<string, string | undefined>>)[module];
  if (!flags[module]) return requires !== undefined && !flags[requires];
  return Object.entries(MODULE_REQUIRES).some(
    ([dependent, needed]) => needed === module && flags[dependent] === true,
  );
}
