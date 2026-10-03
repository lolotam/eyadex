import { foldKey, TOKEN_PREFIX } from "./credential-words.ts";
import { normalizeValue } from "./normalize.ts";

// Key classification that is not credential vocabulary: patient identity, contact fields, codes, URLs and
// private payloads. The credential words live in credential-words.ts so both rules share one vocabulary.

const endsWithAny = (folded: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => folded.endsWith(suffix));

// A phone number keeps its last 3 digits; the key decides, not the shape.
const PHONE_SUFFIXES = [
  "phone",
  "phones",
  "phonenumber",
  "phonenumbers",
  "mobile",
  "mobiles",
] as const;
export const isPhoneKey = (key: string): boolean => endsWithAny(foldKey(key), PHONE_SUFFIXES);

const EMAIL_SUFFIXES = ["email", "emails", "emailaddress", "emailaddresses"] as const;
export const isEmailKey = (key: string): boolean => endsWithAny(foldKey(key), EMAIL_SUFFIXES);

// CLAUDE.md §5 and §8: a civil ID and a birth date are never printed, not even partially. Matched as a
// PART of the key, because the caller decides the spelling (civilId, civil_id, patientCivilId, dob…).
const MEDICAL_KEY_PARTS = ["civilid", "nationalid", "birth", "dob"] as const;
export const isMedicalKey = (key: string): boolean => {
  const folded = foldKey(key);
  return MEDICAL_KEY_PARTS.some((part) => folded.includes(part));
};

// Technical "name" fields that must survive: the word "name" is redacted as patient identity, so these
// endings are exempt rather than the whole rule being omitted (routeName/eventName/filename are not a person).
const STRUCTURAL_NAME_KEYS: ReadonlySet<string> = new Set([
  "routename",
  "eventname",
  "filename",
  "keyname",
  "servicename",
  "classname",
  "tablename",
  "columnname",
  "methodname",
  "hostname",
  "modulename",
  "jobname",
  "queuename",
  "taskname",
  "typename",
  "fieldname",
  // A clinic/branch/organisation has a name, but it is not a patient: these are business entities the
  // operational log is allowed to identify, so they are exempt from the bare `name` rule too.
  "clinicname",
  "branchname",
  "organisationname",
  "organizationname",
]);

// Patient identity in operational logs (platform staff never see it). Matched as a part of the key, with
// the id exception: patientId identifies nobody and is what a support trace needs. A bare "name" IS listed
// now, with STRUCTURAL_NAME_KEYS as the exemption; the patient-name spellings (fullName, firstName,
// patientName, clientName…) are parts too. displayName is deliberately not exempt — it is a person's name.
const PATIENT_KEY_PARTS = [
  "name",
  "fullname",
  "firstname",
  "lastname",
  "middlename",
  "familyname",
  "givenname",
  "patientname",
  "clientname",
  "customername",
  "displayname",
  "ownername",
  "mothername",
  "fathername",
  "spousename",
  "contactname",
  "emergencyname",
  "doctorname",
  "gender",
  "sex",
  "nationality",
  "maritalstatus",
  "address",
  "passport",
] as const;
export const isPatientKey = (key: string): boolean => {
  const folded = foldKey(key);
  if (STRUCTURAL_NAME_KEYS.has(folded)) return false;
  if (PATIENT_KEY_PARTS.some((part) => folded.includes(part))) return true;
  return folded.includes("patient") && !/ids?$/.test(folded);
};

// A key that contains any non-ASCII letter (Arabic "اسم_العميل", or mixed "user_كلمة") cannot be reasoned
// about from its spelling, so BOTH modes redact it rather than printing an identity or credential field it
// failed to recognise. Full-width keys are NFKC-folded first, so `ｔｏｋｅｎ` is judged as `token`.
export const isNonAsciiKey = (key: string): boolean => {
  const folded = foldKey(key);
  return /\p{L}/u.test(folded) && /[^\p{ASCII}]/u.test(folded);
};

// Codes that name a state, not a credential. They keep error/status/geo codes out of the `code` rule.
const STRUCTURAL_CODE_KEYS: ReadonlySet<string> = new Set([
  "statuscode",
  "errorcode",
  "countrycode",
  "currencycode",
  "languagecode",
  "postalcode",
  "zipcode",
  "exitcode",
  "httpcode",
  "responsecode",
]);
export const isCodeKey = (key: string): boolean => {
  const folded = foldKey(key);
  return folded === "code" || folded.endsWith("code");
};
export const isStructuralCodeKey = (key: string): boolean => STRUCTURAL_CODE_KEYS.has(foldKey(key));

const SNAKE_WORDS = /^[a-z]+(_[a-z]+)*$/i;
/**
 * A secret under a code-named key: a PIN, OTP, OAuth code or pass code. Any digit (any script) or a long
 * opaque value counts; our own snake_case error codes ("not_found") do not.
 *
 * @param value the value found under a `…code` key
 * @returns whether it must be replaced
 */
export const isCodeSecretValue = (value: unknown): boolean => {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : typeof value === "bigint"
          ? value.toString()
          : undefined;
  if (text === undefined) return false;
  const normalized = normalizeValue(text);
  // A known token prefix is opaque even when it happens to be snake_case ("tok_live_x" is not our error
  // code convention, "not_found" is).
  if (TOKEN_PREFIX.test(normalized)) return true;
  if (SNAKE_WORDS.test(normalized)) return false;
  return /\p{Nd}/u.test(normalized) || normalized.length >= 10;
};

// Under a URL-named key the whole path after the first segment is withheld: a link field is where a token
// hides (invite, reset, callback), and the caller has already said the value is a link.
const URL_KEYS: ReadonlySet<string> = new Set([
  "url",
  "uri",
  "link",
  "href",
  "redirect",
  "redirecturl",
  "callback",
  "returnto",
  "next",
  "location",
]);
export const isUrlKey = (key: string): boolean => URL_KEYS.has(foldKey(key));

// Notification/source payloads and provider bodies never belong in technical diagnostics, and neither
// does the body of a request a caller sent us.
const PRIVATE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "payload",
  "eventpayload",
  "jobdata",
  "providerbody",
  "rawbody",
  "requestbody",
  "safeparameters",
  "components",
  "emailbody",
  "emailhtml",
  "emailtext",
]);
export const isPrivatePayloadKey = (key: string): boolean => PRIVATE_PAYLOAD_KEYS.has(foldKey(key));
