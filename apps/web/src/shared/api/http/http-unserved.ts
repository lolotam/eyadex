import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";

/** Namespaces the API does not serve yet: every method answers not_implemented, nothing is invented. */
const notImplemented = () => Promise.reject(new ApiError("not_implemented"));

export function createUnservedNamespaces(): Pick<
  ApiClient,
  | "patients"
  | "audit"
  | "clinicSettings"
  | "account"
  | "platformOverview"
  | "platformTeam"
  | "platformSettings"
> {
  return {
    patients: {
      list: notImplemented,
      branchOptions: notImplemented,
      open: notImplemented,
      create: notImplemented,
      update: notImplemented,
      archive: notImplemented,
      restore: notImplemented,
    },
    audit: {
      clinicList: notImplemented,
      platformList: notImplemented,
      platformClinicOptions: notImplemented,
    },
    clinicSettings: { get: notImplemented, update: notImplemented },
    account: { get: notImplemented, update: notImplemented },
    platformOverview: { get: notImplemented },
    platformTeam: {
      list: notImplemented,
      invite: notImplemented,
      deactivate: notImplemented,
      reactivate: notImplemented,
    },
    platformSettings: { get: notImplemented, update: notImplemented },
  };
}
