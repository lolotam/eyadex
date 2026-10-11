import type { VisitList } from "@eyadex/contracts/visits";
import { ApiError } from "../api-error";
import { patientOf, reachesContent, type MedicalAccess } from "./mock-medical-access";
import { summaryOf } from "./mock-medical-project";
import type { StoredVisit } from "./mock-medical-state";
import { worksIn } from "./mock-medical-walk-in";
import type { MockState } from "./mock-store";

const PAGE = 20;
/** The API's P2-F4 bound: a note search scans at most the patient's 500 newest visits in reach. */
export const SEARCH_SCAN_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Newest first, then the higher id, as the API's `ORDER BY started_at DESC, id DESC`. */
export const newestFirst = (x: StoredVisit, y: StoredVisit) =>
  x.startedAt === y.startedAt ? (x.id < y.id ? 1 : -1) : x.startedAt < y.startedAt ? 1 : -1;

const encodeCursor = (v: StoredVisit) =>
  btoa(`${v.startedAt}|${v.id}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

// The API's `decodeCursor` (queries/visit-list.ts): the last (startedAt, id) seen, opaque to the
// client; anything else is `validation`, never a silent first page.
function decodeCursor(cursor: string | undefined): { startedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  let text = "";
  try {
    text = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw new ApiError("validation");
  }
  const [startedAt = "", id = "", ...rest] = text.split("|");
  if (rest.length > 0 || !UUID.test(id) || Number.isNaN(Date.parse(startedAt))) {
    throw new ApiError("validation");
  }
  return { startedAt, id };
}

/**
 * One page of `rows` (sorted `newestFirst`) after the cursor, keyset like the API's: a visit started
 * between two fetches never repeats an item of the earlier page.
 */
export function visitPage(
  db: MockState,
  a: MedicalAccess,
  rows: StoredVisit[],
  cursor: string | undefined,
  patient: ReturnType<typeof patientOf>,
): VisitList {
  const after = decodeCursor(cursor);
  const remaining =
    after === null
      ? rows
      : rows.filter(
          (v) =>
            v.startedAt < after.startedAt || (v.startedAt === after.startedAt && v.id < after.id),
        );
  const slice = remaining.slice(0, PAGE);
  const last = slice.at(-1);
  return {
    items: slice.map((v) => summaryOf(db, a, v)),
    nextCursor: remaining.length > PAGE && last !== undefined ? encodeCursor(last) : null,
    can: {
      search: reachesContent(db, a, "view", patient.id),
      // As the API's `canStart`: a walk-in for an active file of a branch the caller works in.
      start:
        a.keys.includes("create:visits:own") &&
        patient.status === "active" &&
        worksIn(a, patient.registrationBranchId),
    },
  };
}
