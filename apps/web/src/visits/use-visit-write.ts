import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { VisitDetail } from "@eyadex/contracts/visits";
import { medicalKeys, useClinicPersona } from "@/medical/medical-queries";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import type { MedicalApi } from "@/shared/api/medical-client";
import type { Persona } from "@eyadex/contracts/session";
import type { TranslationKey } from "@/shared/i18n/dictionary";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { sectionSaveKey, type SectionSaves, type VisitSection } from "./visit-section-saves";

// One toast for a visit's section save errors: Sign or Cancel repeating a failure the save already
// showed replaces that toast instead of stacking a second one.
const sectionErrorToast = (visitId: string) => ({ id: sectionSaveKey(visitId).join(":") });

/**
 * A visit write: the answer replaces the open visit in place (no second audited open), and the
 * file's visit lists are dropped so they read fresh. A `section` save is counted by the Sign button
 * (its key) and followed by the page's `saves`, so Sign waits for it and refuses while it failed.
 */
export function useVisitWrite<I>(
  visitId: string,
  run: (api: MedicalApi, persona: Persona, input: I) => Promise<VisitDetail>,
  options: {
    success?: TranslationKey;
    quiet?: boolean;
    onDone?: () => void;
    section?: VisitSection;
    saves?: SectionSaves | undefined;
  } = {},
) {
  const api = useApi();
  const { persona, personaKey } = useClinicPersona();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    ...(options.section ? { mutationKey: sectionSaveKey(visitId, options.section) } : {}),
    mutationFn: (input: I) => {
      const save = run(api.medical, persona, input);
      const { section, saves } = options;
      return section && saves ? saves.track(section, save) : save;
    },
    onSuccess: (detail) => {
      queryClient.setQueryData([...medicalKeys.visit(visitId), ...personaKey], detail);
      void queryClient.invalidateQueries({ queryKey: [...medicalKeys.all, "visits"] });
      if (options.success) toast.success(t(options.success));
      options.onDone?.();
    },
    onError: (e) => {
      if (options.quiet) return;
      const message = t(`errors.${errorCodeOf(e)}`);
      if (options.section) toast.error(message, sectionErrorToast(visitId));
      else toast.error(message);
    },
  });
}

/**
 * Sign and Cancel draft refused by `SectionSaves.settle`: shows the failed save's error again, since
 * its own toast may be long gone when the save failed before the confirm.
 */
export function useSectionSaveRefusal(visitId: string) {
  const { t } = useI18n();
  return (e: unknown) => toast.error(t(`errors.${errorCodeOf(e)}`), sectionErrorToast(visitId));
}
