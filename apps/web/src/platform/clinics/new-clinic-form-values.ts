import type { CreateClinicInput } from "@eyadex/contracts/clinics";
import { newClinicDefaults, type PlatformSettings } from "@eyadex/contracts/platform";

/**
 * The create form's first values: empty clinic and admin fields, limits and modules from the
 * platform settings (ADR-0020 amendment). The super admin may change them before creating.
 */
export function newClinicFormValues(settings: PlatformSettings): CreateClinicInput {
  return {
    nameAr: "",
    nameEn: "",
    slug: "",
    specialty: "psychiatry",
    defaultLanguage: "ar",
    timezone: "Asia/Kuwait",
    adminName: "",
    adminEmail: "",
    ...newClinicDefaults(settings),
  };
}
