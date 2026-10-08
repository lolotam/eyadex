export {
  createAuth,
  type AuthArea,
  type AreaSession,
  type AuthInstance,
  type CreateAuthOptions,
  type EyadexAuth,
  type NewUserAccount,
} from "./create-auth.ts";
export {
  areaCookiePrefix,
  DEFAULT_COOKIE_PREFIX,
  MIN_SECRET_LENGTH,
  PASSWORD_LIMITS,
} from "./options.ts";
export { CLIENT_IP_HEADER } from "./area-binding.ts";
export { ENROLLMENT_LOCK_PREFIX, type LockedResult } from "./enrollment-lock.ts";
export {
  createFirstPlatformAccount,
  type FirstPlatformAccount,
  type FirstPlatformAccountResult,
} from "./first-platform-account.ts";
