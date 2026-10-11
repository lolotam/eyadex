import type { VisitSummary } from "@eyadex/contracts/visits";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { matches } from "../domain/text-match.ts";
import { EMPTY_NOTE, type VisitReach } from "../domain/visit-rules.ts";
import { addendaOf, notesOf, NOTE_COLUMN } from "../persistence/pg-note-store.ts";
import {
  toVisitRow,
  VISIT_COLUMNS,
  type RawVisit,
  type VisitRow,
} from "../persistence/pg-visit-store.ts";
import type { ReadContext } from "../use-cases/medical-deps.ts";
import { openNote, previewOf, visitSummary } from "./visit-views.ts";

const PAGE = 20;
// P2-F4: the search decrypts at most this many of the patient's newest visits per request.
export const SEARCH_SCAN_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last (started_at, id) seen, base64url-encoded so the client treats it as opaque. */
const encodeCursor = (visit: VisitRow) =>
  Buffer.from(`${visit.startedAt}|${visit.id}`).toString("base64url");

function decodeCursor(cursor: string | undefined): { startedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const [startedAt = "", id = "", ...rest] = Buffer.from(cursor, "base64url").toString().split("|");
  if (rest.length > 0 || !UUID.test(id) || Number.isNaN(Date.parse(startedAt))) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  return { startedAt, id };
}

/** Which of the patient's visits the caller's visits reach shows: `own` and `clinic` all, `branch` some. */
const reachSql = (reach: VisitReach): SQL => {
  if ("own" in reach || reach.all) return sql`true`;
  return sql`v.branch_id IN
    (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(reach.branchIds)}::jsonb))`;
};

const afterSql = (after: { startedAt: string; id: string } | null): SQL =>
  after === null
    ? sql`true`
    : sql`(v.started_at, v.id) < (${after.startedAt}::timestamptz, ${after.id}::uuid)`;

async function patientVisits(
  reads: ReadContext,
  clinicId: string,
  patientId: string,
  where: SQL,
  limit: number,
): Promise<VisitRow[]> {
  const rows = await reads.tx.execute<RawVisit>(
    sql`SELECT ${VISIT_COLUMNS} FROM visits v
        WHERE v.clinic_id = ${clinicId} AND v.patient_id = ${patientId} AND ${where}
        ORDER BY v.started_at DESC, v.id DESC LIMIT ${limit}`,
  );
  return rows.map(toVisitRow);
}

async function summaries(
  reads: ReadContext,
  clinicId: string,
  visits: readonly VisitRow[],
  previews: ReadonlyMap<string, string | null>,
): Promise<VisitSummary[]> {
  const members = await reads.members.findMany(
    reads.tx,
    clinicId,
    visits.map((v) => v.providerMembershipId),
  );
  return visits.map((v) =>
    visitSummary(
      v,
      members.get(v.providerMembershipId)?.fullName ?? "—",
      previews.get(v.id) ?? null,
    ),
  );
}

/** A page of visits and whether any preview of clinical content went out (an audited read). */
export interface VisitPage {
  readonly items: VisitSummary[];
  readonly nextCursor: string | null;
  readonly previewsShown: boolean;
}

/**
 * A patient's visits newest first (spec §5), 20 a page, inside the caller's visits reach; the assessment
 * preview only when `withPreviews` (a reader of the content).
 *
 * @returns the page
 */
export async function listVisitPage(
  reads: ReadContext,
  clinicId: string,
  patientId: string,
  reach: VisitReach,
  cursor: string | undefined,
  withPreviews: boolean,
): Promise<VisitPage> {
  const after = decodeCursor(cursor);
  const where = sql`${reachSql(reach)} AND ${afterSql(after)}`;
  const rows = await patientVisits(reads, clinicId, patientId, where, PAGE + 1);
  const page = rows.slice(0, PAGE);
  const previews = new Map<string, string | null>();
  if (withPreviews) {
    const notes = await notesOf(
      reads.tx,
      clinicId,
      page.map((v) => v.id),
    );
    for (const v of page) {
      const note = notes.get(v.id);
      // Only the assessment is opened: the preview needs nothing else.
      const sealed = note?.sections.assessment ?? null;
      const assessment =
        note === undefined || sealed === null
          ? null
          : reads.cipher.open(
              clinicId,
              { table: "visit_notes", column: NOTE_COLUMN.assessment, rowId: note.id },
              sealed,
            );
      previews.set(v.id, previewOf({ ...EMPTY_NOTE, assessment }));
    }
  }
  const last = page.at(-1);
  return {
    items: await summaries(reads, clinicId, page, previews),
    nextCursor: rows.length > PAGE && last !== undefined ? encodeCursor(last) : null,
    previewsShown: [...previews.values()].some((p) => p !== null),
  };
}

/**
 * P2-F4: the patient's 500 newest visits inside the caller's reach, decrypted in memory, filtered on their
 * note sections and addenda, then paged by cursor. Nothing of the query or the text leaves this function
 * except the matching visits' summaries.
 *
 * @returns the page of matches (previews included: the caller reads the content)
 */
export async function searchVisitPage(
  reads: ReadContext,
  clinicId: string,
  patientId: string,
  reach: VisitReach | null,
  q: string,
  cursor: string | undefined,
): Promise<Omit<VisitPage, "previewsShown">> {
  const after = decodeCursor(cursor);
  const scanned = await patientVisits(
    reads,
    clinicId,
    patientId,
    reach === null ? sql`true` : reachSql(reach),
    SEARCH_SCAN_LIMIT,
  );
  const ids = scanned.map((v) => v.id);
  const notes = await notesOf(reads.tx, clinicId, ids);
  const addenda = await addendaOf(reads.tx, clinicId, ids);
  const previews = new Map<string, string | null>();
  const hits = scanned.filter((v) => {
    const note = openNote(reads.cipher, clinicId, notes.get(v.id));
    const bodies = addenda
      .filter((a) => a.visitId === v.id)
      .map((a) =>
        reads.cipher.open(
          clinicId,
          { table: "visit_addenda", column: "body_enc", rowId: a.id },
          a.bodyEnc,
        ),
      );
    const text = [...Object.values(note), ...bodies].filter((t) => t !== null).join("\n");
    previews.set(v.id, previewOf(note));
    return matches(text, q);
  });
  const remaining =
    after === null
      ? hits
      : hits.filter(
          (v) =>
            v.startedAt < after.startedAt || (v.startedAt === after.startedAt && v.id < after.id),
        );
  const page = remaining.slice(0, PAGE);
  const last = page.at(-1);
  return {
    items: await summaries(reads, clinicId, page, previews),
    nextCursor: remaining.length > PAGE && last !== undefined ? encodeCursor(last) : null,
  };
}
