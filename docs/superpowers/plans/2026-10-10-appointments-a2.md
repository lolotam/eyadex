# Appointments slice A2 — booking, reschedule, status, cancel, quick file, overbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice A2 of the appointments design: first a global lock order that removes the deadlock Codex confirmed on A1, then the `appointments` table and the booking rules (spec §4 rules 1–11, D-3, D-5, D-6, D-10, D-11, D-13, D-14, D-15) through API, database, mock and the branch day view with its booking dialog.

**Architecture:** One forward-only SQL file (`db/sql/0043_appointments.sql`) adds the RLS-forced `appointments` table and keeps its audit rows out of the platform's audit view. The appointments module gains a booking use case (create / reschedule) and a status use case (status / cancel) that run every rule inside one `withTenant` transaction under the provider lock, after the rows they read are locked in the global order of ADR-0027. Members come through `ProviderDirectory` (identity), branches through `SchedulingBranchReader` (tenancy) and — a new arrow — patients through `BookingPatientReader` (patients' `PgBookingPatients`), all bound in `appointments.module.ts`. The pure slot rules live in `@eyadex/contracts/appointments` so the API and the web mock decide identically. The web gets `ApiClient["appointments"]` (mock + HTTP), the route `/clinic/appointments` (branch day view) and the booking dialog; the quick file goes through the existing `POST /v1/patients` with its own `Idempotency-Key`.

**Tech Stack:** PostgreSQL 18 (RLS, advisory locks), NestJS 12 on Fastify, Drizzle 0.45 (schema mirror only), postgres.js, Zod 3 (`@eyadex/contracts`), TanStack Start + Query, react-hook-form, shadcn/ui, lucide, vitest 4.

**Spec:** `docs/specs/appointments-design.md` (owner-approved 2026-10-09; this plan covers §6 row A2) + owner decisions of 2026-10-10 (lock order first; new clinics' receptionist gets the booking keys).

## Global Constraints

- Worktree `/f/Dev/Worktrees/eyadex/a2` (branch `appointments-a2`, base `origin/main` `178ac12`); LF line endings; never push, no PR, nothing on production/Dokploy/SSH.
- Every shell step starts with `source /f/Dev/Temp/claude/a2/env.sh` (Node 24 on PATH, `cd` into the worktree, the six `EYADEX_TEST_*` URLs on port `55443`, Redis db `8`).
- Postgres container `eyadex-pg-a2` (port 55443); `MSYS_NO_PATHCONV=1 sh /f/Dev/Worktrees/eyadex/dbcheck.sh eyadex-pg-a2 /f/Dev/Worktrees/eyadex/a2` re-creates and checks the database.
- SQL file `db/sql/0043_appointments.sql`. ADR: **new ADR-0027** (the global lock order is a cross-module rule) + an "A2" amendment section in ADR-0026 (the appointments table and booking rules).
- Clinic tables: `clinic_id uuid NOT NULL`, PK `(clinic_id, id)`, RLS ENABLED + FORCED with the standard policy for USING and WITH CHECK, indexes lead with `clinic_id`, every FK has a plain leading-column index, `eyadex_app` only, `REVOKE ALL` from `eyadex_platform`, no `DELETE` grant.
- Global lock order (ADR-0027), every path takes a prefix of it in this order and never goes back: `roles:<clinic>` → `users:<clinic>` → `patients:<clinic>` → `appointments:<clinic>:<membership>` (sorted by membership id when several) → `appointments` row → membership row → patient row → `branches:<clinic>` → branch row → `clinic_services` row.
- Booking rules are decided under the provider lock in one transaction; `overbook:appointments:*` lifts exactly coverage (D-6/D-14), time off and overlap, and sets `overbooked = true` only when one of them was lifted.
- Statuses (D-5): `booked → arrived → completed`; `booked → no_show`; `booked|arrived → cancelled` (reason required: `patient_cancelled|provider_cancelled|other`, note optional ≤ 200); anything else → `invalid_transition`. Reschedule only while `booked`.
- Duration (D-2, D-15): `endsAt` from the client when sent, else service duration, else provider default; always 5–480 minutes.
- Audit: one `administrative` clinic row per create, reschedule, status change, cancel; entity `appointment`; snapshot = provider name, branch id, service names, times, status, overbooked, cancel reason. No patient name, phone, civil ID or cancel note in any snapshot.
- Platform: no grant on `appointments`, and `platform_clinic_admin_audit` excludes `entity_type = 'appointment'`.
- Module flag `appointments` off ⇒ every `/v1/appointments*` route answers `module_disabled`.
- Times stored UTC (`timestamptz`), shown in the clinic time zone; schedules stay wall-clock.
- Existing clinics' roles are not changed by 0043. New clinics' receptionist: + `view:appointments:branch`, `create:appointments:branch`, `update:appointments:branch`, `view:schedules:branch`, `view:services:clinic`. Doctor unchanged (A3).
- Out of A2: `own` queries (A3), week / month / queue views (A4), reminders, prices.
- UI: ar + en through i18n keys; "المراجع/المراجعون" (never "المريض/المرضى"), never "كاشير"/"Cashier", `Eyadex` in Latin; logical CSS only; shadcn/ui; ≤ 300 lines and one component per file; route `...pageHead("clinicAppointments")` (ADR-0025).
- Arabic JSDoc on every exported function in `domain/**` and every method in `ports/**`.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## TODO(spec) decisions taken (conservative), recorded in ADR-0026 §11

1. D-10 names "name, mobile, branch" for the quick file; the existing patients use case (which D-10 says to reuse) also requires birth date and gender (`NOT NULL` since 0010). A2 keeps the patient file rules unchanged: the quick file asks for those two as well, and the civil ID is left for later.
2. Reschedule is allowed only while the appointment is `booked` (an arrived visit is already happening).
3. A booking in the past is accepted (the clinic records walk-ins after the fact); no rule in the spec refuses it.
4. The provider must work in the booking branch (`provider_not_in_branch`) and the branch must be active (`branch_inactive`); `overbook` does not lift these (it lifts rule 2's three checks only).
5. A write answers `{ appointment }` clipped to the caller's `view:appointments` reach (`null` when it cannot see that branch), as A1's schedule writes.
6. `created_by` stores the actor's user id with no foreign key (like `audit_log.actor_user_id`): a foreign key would take a second membership row lock at insert time, after the branch row, and re-open the cycle of ADR-0027.

---

## File Structure

### Database

| File                                                                   | Responsibility                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `db/sql/0043_appointments.sql` (create)                                | `appointments` table, indexes, RLS, grants; `platform_clinic_admin_audit` without appointment rows      |
| `db/tests/rls-isolation.sql` (modify)                                  | Seed + cross-clinic read/write probes, not deletable, platform cannot read the table nor its audit rows |
| `packages/db/src/schema/appointments.ts` (create), `index.ts` (modify) | Drizzle mirror                                                                                          |
| `packages/db/src/__tests__/schema-surface.spec.ts` (modify)            | The new table keeps `(clinic_id, id)`                                                                   |

### Contracts

| File                                                          | Responsibility                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/appointments.ts` (create)             | Statuses, transitions, cancel reasons, inputs, views, day view, slot rules (`appointmentSlotProblems`, `resolveAppointmentEnd`) |
| `packages/contracts/package.json` (modify)                    | Export `./appointments`                                                                                                         |
| `packages/contracts/src/common.ts` (modify)                   | `outside_schedule`, `provider_time_off`, `appointment_overlap`, `patient_inactive`, `service_inactive`, `invalid_transition`    |
| `packages/contracts/src/organization.ts`, `audit.ts` (modify) | Entity `appointment`, actions `appointment.*`, kept from the platform filter                                                    |

### API

| File                                                                                              | Responsibility                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `shared/provider-lock.ts` (modify)                                                                | `lockProviders` (sorted), JSDoc pointing at ADR-0027                             |
| `modules/appointments/ports/provider-directory.ts` + identity `pg-provider-directory.ts` (modify) | `lockForWrite`: the membership row `FOR SHARE OF m`                              |
| `modules/appointments/use-cases/schedule-changes/schedule-changes.ts` (modify)                    | Membership row before the branch row (the deadlock fix)                          |
| `modules/appointments/__tests__/lock-order.db.spec.ts` (create)                                   | Three-session proof                                                              |
| `shared/errors.ts`, `shared/api-error-messages.ts` (modify)                                       | Statuses and messages of the six codes                                           |
| `modules/identity/domain/system-roles.ts` (modify)                                                | Receptionist booking keys                                                        |
| `modules/audit/domain/audit-snapshot.ts` (modify)                                                 | `appointment` allowlist                                                          |
| `modules/patients/persistence/pg-booking-patients.ts` (create), `patients/index.ts` (modify)      | Patients' adapter for `BookingPatientReader`                                     |
| `modules/appointments/ports/booking-patient-reader.ts`, `tokens.ts`                               | Port + tokens                                                                    |
| `modules/appointments/domain/booking-rules.ts`                                                    | Reach, overbook decision, audit snapshot                                         |
| `modules/appointments/persistence/pg-appointment-store.ts`                                        | SQL on `appointments` (+ time-off overlap read in `pg-schedule-store.ts`)        |
| `modules/appointments/queries/appointment-views.ts`, `appointment-day.ts`                         | Appointment view projection, branch day view, branch options                     |
| `modules/appointments/use-cases/book-appointment/book-appointment.ts`, `slot-check.ts`            | Create + reschedule                                                              |
| `modules/appointments/use-cases/appointment-status/appointment-status.ts`                         | Status + cancel                                                                  |
| `modules/appointments/http/appointments.controller.ts`                                            | Six thin routes                                                                  |
| `modules/appointments/appointments.module.ts`                                                     | Wiring (`PgBookingPatients` bound here)                                          |
| `shared/__tests__/module-boundaries.spec.ts` (modify)                                             | `appointments` table allowed; patients imported only through `patients/index.ts` |

### Web

| File                                                                                                                                                                          | Responsibility                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `shared/api/appointments-client.ts` (create), `api-client.ts` (modify)                                                                                                        | `AppointmentsApi`                             |
| `shared/api/http/http-appointments.ts` (create), `http-adapter.ts` (modify)                                                                                                   | HTTP side                                     |
| `shared/api/mock/mock-appointments.ts`, `mock-appointment-rules.ts`, `seed-appointments.ts` (create); `mock-store.ts`, `seed.ts`, `mock-adapter.ts`, `seed-roles.ts` (modify) | Mock side, same rules and check order         |
| `appointments/*` (create)                                                                                                                                                     | Day view, booking dialog, quick file, actions |
| `routes/clinic.appointments.tsx` (create), `shared/shell/nav-items.ts` (modify)                                                                                               | Route + nav (`view:appointments` + module)    |
| `shared/i18n/{ar,en}-appointments.ts` (create), `{ar,en}.ts`, `{ar,en}-routes.ts`, `{ar,en}-audit.ts` (modify)                                                                | Strings                                       |

### Docs

`docs/adr/0027-lock-order.md` (create), `docs/adr/0026-appointments-model.md` (amend), `CLAUDE.architecture.md` §2.2/§3, `apps/api/AGENTS.md`, `docs/roadmap.md`.

---

## Task 1: The global lock order — the schedule save locks the membership row before the branch row

**Files:**

- Modify: `apps/api/src/modules/appointments/ports/provider-directory.ts`, `apps/api/src/modules/identity/persistence/pg-provider-directory.ts`, `apps/api/src/modules/appointments/use-cases/schedule-changes/schedule-changes.ts`, `apps/api/src/shared/provider-lock.ts`
- Create: `apps/api/src/modules/appointments/__tests__/lock-order.db.spec.ts`, `docs/adr/0027-lock-order.md`
- Modify: `apps/api/AGENTS.md`

**Interfaces:**

- Produces: `ProviderDirectory.lockForWrite(tx, clinicId, membershipId): Promise<ProviderRecord | null>` (membership row `FOR SHARE OF m`); `lockProviders(tx, clinicId, membershipIds)` (sorted, de-duplicated).

The cycle (Codex on A1): (a) user branch change: `users:` → membership `FOR UPDATE` → waits `branches:`; (b) branch deactivation: `branches:` → waits branch `FOR UPDATE`; (c) schedule save: provider lock → branch `FOR SHARE` → INSERT waits the FK `KEY SHARE` on the membership row held by (a). With (c) taking the membership row before the branch row, (c) waits on (a) without holding the branch, (b) finishes, then (a), then (c).

- [ ] **Step 1: Write the failing three-session test**

```ts
// apps/api/src/modules/appointments/__tests__/lock-order.db.spec.ts
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { schedulingClinic, send } from "./scheduling-fixtures.ts";

// ADR-0027: three sessions in the order Codex found on A1. (a) a user's branch change holds `users:`
// and the membership row, then asks `branches:`; (b) a branch deactivation holds `branches:`, then asks
// the branch row; (c) the real schedule save of that member in that branch.
let h: Harness;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
const url = process.env["EYADEX_TEST_OWNER_URL"]!;
const waiting = async (n: number) => {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_stat_activity
                                WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`fewer than ${n} sessions waiting on a lock`);
};
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await schedulingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await send(h, C.admin.cookie, "PUT", `/v1/users/${C.doctor.memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
});
afterAll(async () => closeHarness(h));

describe("the global lock order (ADR-0027)", () => {
  it("a schedule save, a user's branch change and a branch deactivation all complete", async () => {
    const a = postgres(url, { max: 1, onnotice: () => undefined });
    const b = postgres(url, { max: 1, onnotice: () => undefined });
    const aHeld = gate();
    const aNext = gate();
    const bHeld = gate();
    const bNext = gate();
    try {
      const sessionA = a.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`users:${C.clinicId}`}, 0))`;
        await tx`SELECT id FROM memberships WHERE clinic_id = ${C.clinicId} AND id = ${C.doctor.memberId} FOR UPDATE`;
        aHeld.open();
        await aNext.p;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
      });
      await aHeld.p;
      const sessionB = b.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${C.clinicId}`}, 0))`;
        bHeld.open();
        await bNext.p;
        await tx`SELECT id FROM branches WHERE clinic_id = ${C.clinicId} AND id = ${C.branchD} FOR UPDATE`;
      });
      await bHeld.p;
      const save = send(
        h,
        C.admin.cookie,
        "PUT",
        `/v1/schedules/${C.doctor.memberId}/branches/${C.branchD}`,
        { shifts: [{ weekday: 3, startsAt: "08:00", endsAt: "12:00" }] },
      );
      await waiting(1); // (c) waits on the membership row (old code: holding the branch row)
      aNext.open();
      await waiting(2); // (a) waits on `branches:`
      bNext.open(); // (b) asks the branch row: a cycle with the old order
      const [ra, rb, rc] = await Promise.allSettled([sessionA, sessionB, save]);
      expect(ra.status).toBe("fulfilled");
      expect(rb.status).toBe("fulfilled");
      expect(rc.status === "fulfilled" && rc.value.statusCode).toBe(200);
    } finally {
      await a.end();
      await b.end();
    }
  });
});
```

- [ ] **Step 2: Run it — FAIL on the old order** (`cd apps/api && npx vitest run --config vitest.db.config.ts src/modules/appointments/__tests__/lock-order.db.spec.ts`): PostgreSQL aborts one session with `deadlock detected` (40P01) after `deadlock_timeout`, so one of the three settles rejected or with 500.

- [ ] **Step 3: The port method and its identity adapter**

```ts
// ports/provider-directory.ts — inside ProviderDirectory
  /**
   * نفس العضو، وصفّه مقفول `FOR SHARE` لحد آخر الـ transaction (ترتيب الأقفال ADR-0027): أي كتابة عن
   * مقدّم خدمة بتقفل صف العضوية قبل صف الفرع، فتعطيل العضو أو تغيير فروعه في نفس اللحظة بيستنى، ومفيش دايرة.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)` وماسكة قفل مقدّم الخدمة
   * @param clinicId العيادة
   * @param membershipId العضوية
   * @returns العضو، أو `null` لو مش عضو في العيادة دي
   */
  lockForWrite(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRecord | null>;
```

```ts
// identity/persistence/pg-provider-directory.ts — inside PgProviderDirectory
  async lockForWrite(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRow | null> {
    const rows = await tx.execute<Raw>(
      sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.id = ${membershipId} FOR SHARE OF m`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }
```

- [ ] **Step 4: `ScheduleChanges.visible` reads through `lockForWrite`** (every schedules write: replace, add and cancel time off — the time-off INSERT takes the same FK lock), so in `replaceBranch` the membership row is locked before `branches.lockForFiling`:

```ts
const provider = await this.deps.providers.lockForWrite(tx, actor.clinicId, membershipId);
```

- [ ] **Step 5: `lockProviders` in `shared/provider-lock.ts`**

```ts
/**
 * Several providers in one transaction (a reschedule to another provider): sorted, so two transactions
 * moving appointments between the same two providers take them in the same order (ADR-0027).
 */
export async function lockProviders(
  tx: Tx,
  clinicId: string,
  membershipIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(membershipIds)].sort()) await lockProvider(tx, clinicId, id);
}
```

- [ ] **Step 6: Run the test — PASS; run the A1 schedule specs — PASS.** Stash only `schedule-changes.ts` once to record the failing-first proof.
- [ ] **Step 7: ADR-0027 and the AGENTS.md line** (the order of the Global Constraints, each path's prefix, the A1 cycle, the test), commit `fix(appointments): one global lock order — the schedule save locks the membership before the branch`.

## Task 2: Contracts — appointments, error codes, audit vocabulary

**Files:** Create `packages/contracts/src/appointments.ts`, `packages/contracts/src/__tests__/appointments.spec.ts` (or the package's test folder); modify `package.json` exports, `common.ts`, `organization.ts`, `audit.ts`.

**Interfaces — Produces:**

```ts
export const APPOINTMENT_STATUSES = [
  "booked",
  "arrived",
  "completed",
  "no_show",
  "cancelled",
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export const cancelReasonSchema = z.enum(["patient_cancelled", "provider_cancelled", "other"]);
export type CancelReason = z.infer<typeof cancelReasonSchema>;

/** D-5: the only moves; `cancelled` goes through the cancel route (reason required). */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  booked: ["arrived", "no_show", "cancelled"],
  arrived: ["completed", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};
export const canTransition = (from: AppointmentStatus, to: AppointmentStatus) =>
  APPOINTMENT_TRANSITIONS[from].includes(to);
export const isReschedulable = (status: AppointmentStatus) => status === "booked";

const instant = z.string().datetime({ offset: true });
const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;
const inBounds = (a: string, b: string) => {
  const m = minutesBetween(a, b);
  return m >= 5 && m <= 480;
};

export const appointmentInputSchema = z
  .object({
    branchId: idSchema,
    providerMembershipId: idSchema,
    patientId: idSchema,
    serviceId: idSchema.nullable(),
    startsAt: instant,
    endsAt: instant.nullable(),
    overbook: z.boolean(),
  })
  .strict()
  .refine((v) => v.endsAt === null || inBounds(v.startsAt, v.endsAt), {
    message: "validation.duration",
    path: ["endsAt"],
  });

export const appointmentRescheduleSchema = z
  .object({
    branchId: idSchema,
    providerMembershipId: idSchema,
    startsAt: instant,
    endsAt: instant,
    overbook: z.boolean(),
  })
  .strict()
  .refine((v) => inBounds(v.startsAt, v.endsAt), {
    message: "validation.duration",
    path: ["endsAt"],
  });

export const appointmentStatusInputSchema = z
  .object({ status: z.enum(["arrived", "completed", "no_show"]) })
  .strict();
export const appointmentCancelSchema = z
  .object({ reason: cancelReasonSchema, note: note.nullable() })
  .strict();

export const appointmentSchema = z
  .object({
    id: idSchema,
    branchId: idSchema,
    providerMembershipId: idSchema,
    providerName: z.string(),
    patientId: idSchema,
    patientName: z.string(),
    patientFileNumber: z.number().int(),
    serviceId: idSchema.nullable(),
    serviceNameAr: z.string().nullable(),
    serviceNameEn: z.string().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: appointmentStatusSchema,
    overbooked: z.boolean(),
    cancelReason: cancelReasonSchema.nullable(),
    cancelNote: z.string().nullable(),
  })
  .strict();
export const appointmentWriteResponseSchema = z
  .object({ appointment: appointmentSchema.nullable() })
  .strict();

export const appointmentDayQuerySchema = z
  .object({ branchId: idSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();
export const dayProviderSchema = z
  .object({
    membershipId: idSchema,
    fullName: z.string(),
    defaultDurationMinutes: z.number().int(),
    bookable: z.boolean(),
    shifts: z.array(z.object({ startsAt: z.string(), endsAt: z.string() }).strict()),
    timeOff: z.array(
      z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }).strict(),
    ),
  })
  .strict();
export const appointmentDaySchema = z
  .object({
    branch: scheduleBranchSchema,
    date: z.string(),
    timezone: z.string(),
    providers: z.array(dayProviderSchema),
    appointments: z.array(appointmentSchema),
    can: z.object({ create: z.boolean(), update: z.boolean(), overbook: z.boolean() }).strict(),
  })
  .strict();
export const appointmentBranchesSchema = z
  .object({ items: z.array(scheduleBranchSchema) })
  .strict();

export type SlotProblem = "outside_schedule" | "provider_time_off" | "appointment_overlap";
export interface Span {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Rule 4: the end the client sent, else the service's duration, else the provider's default. */
export function resolveAppointmentEnd(
  startsAt: string,
  endsAt: string | null,
  serviceMinutes: number | null,
  providerDefaultMinutes: number,
): string;

/** Rule 2 in its fixed order: coverage (one branch's rows, D-14), time off, overlap; `[]` = free. */
export function appointmentSlotProblems(
  slot: Span,
  timezone: string,
  branchShifts: readonly WallShift[],
  timeOff: readonly Span[],
  others: readonly Span[],
): SlotProblem[];
```

- `appointmentSlotProblems` uses `instantToWall` for the wall start and end (DST-safe wall duration) and `coversWallInterval`.
- `common.ts`: add the six codes. `organization.ts`: `"appointment"` entity. `audit.ts`: `appointment.booked|rescheduled|status_changed|cancelled`; `CLINIC_ONLY_ACTION = /^(patient|service|schedule|time_off|appointment)\./`.

- [ ] Step 1: failing tests — transitions table (every pair), end resolution (client end, service, default), slot problems: inside a shift → `[]`; split shift gap → outside; a shift continued across midnight (Sun 20:00–24:00 + Mon 00:00–01:00, 23:45–00:15) → `[]`; a gap at midnight → outside; time off overlapping → `provider_time_off`; touching ends → free; overlap → `appointment_overlap`; all three in order; duration bounds refused by the schema (4 and 481 minutes).
- [ ] Step 2: run → FAIL (module missing). Step 3: implement. Step 4: run → PASS. Step 5: commit `feat(contracts): appointments, booking rules and error codes (A2)`.

## Task 3: SQL 0043 + RLS negatives + Drizzle mirror

```sql
-- db/sql/0043_appointments.sql
CREATE TABLE appointments (
  clinic_id              uuid NOT NULL REFERENCES clinics (id),
  id                     uuid NOT NULL,
  branch_id              uuid NOT NULL,
  patient_id             uuid NOT NULL,
  provider_membership_id uuid NOT NULL,
  service_id             uuid NULL,
  starts_at              timestamptz NOT NULL,
  ends_at                timestamptz NOT NULL,
  status                 text NOT NULL CHECK (status IN ('booked', 'arrived', 'completed', 'no_show', 'cancelled')),
  overbooked             boolean NOT NULL,
  cancel_reason          text NULL CHECK (cancel_reason IN ('patient_cancelled', 'provider_cancelled', 'other')),
  cancel_note            text NULL CHECK (char_length(cancel_note) <= 200),
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, provider_membership_id) REFERENCES memberships (clinic_id, id),
  FOREIGN KEY (clinic_id, service_id) REFERENCES clinic_services (clinic_id, id),
  CONSTRAINT appointments_interval_check CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '8 hours'),
  CONSTRAINT appointments_cancel_check CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX appointments_clinic_provider_starts_idx ON appointments (clinic_id, provider_membership_id, starts_at);
CREATE INDEX appointments_clinic_branch_starts_idx ON appointments (clinic_id, branch_id, starts_at);
CREATE INDEX appointments_clinic_patient_idx ON appointments (clinic_id, patient_id);
CREATE INDEX appointments_clinic_service_idx ON appointments (clinic_id, service_id);
CREATE INDEX appointments_clinic_provider_patient_live_idx
  ON appointments (clinic_id, provider_membership_id, patient_id) WHERE status <> 'cancelled';
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointments_tenant_isolation ON appointments
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON appointments TO eyadex_app;
REVOKE ALL ON appointments FROM eyadex_platform;
CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative' AND entity_type NOT IN ('patient', 'appointment');
```

- `rls-isolation.sql`: seed one appointment per clinic (ids of the existing seed), add `appointments` to both table lists, a cross-clinic INSERT probe (`ISO-01 write leak`), `DELETE FROM appointments` refused (no grant), platform `PERFORM 1 FROM appointments` refused, and an audit row `entity_type = 'appointment'` invisible through `platform_clinic_admin_audit` as `eyadex_platform`.
- Drizzle: `packages/db/src/schema/appointments.ts` with the CHECKs exactly as `pg_get_constraintdef` prints them (run dbcheck, read them back with `psql -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='appointments'::regclass"`), the partial index with `.where(sql\`(status <> 'cancelled'::text)\`)`.
- [ ] Steps: write SQL + test → dbcheck (FAIL before the SQL exists for the new probes, PASS after) → mirror → `pnpm --filter @eyadex/db test:db` (drift PASS) → commit `feat(db): 0043 appointments table under forced RLS`.

## Task 4: New clinics' receptionist gets the booking keys

- `system-roles.ts` receptionist permissions: `view|create|update:patients:branch` + `view|create|update:appointments:branch`, `view:schedules:branch`, `view:services:clinic`.
- Test in `identity/domain/__tests__/appointments-catalogue.spec.ts`: receptionist template holds exactly those keys, doctor unchanged (`view:patients:branch` only).
- Web `seed-roles.ts` `ROLE_TEMPLATES.receptionist` the same list; marketing keyring test still green.
- Commit `feat(identity): new clinics' receptionist books appointments in its branches`.

## Task 5: API domain — booking decisions and the audit snapshot

```ts
// modules/appointments/domain/booking-rules.ts
/** وصول `overbook`: مفتاح clinic = كل الفروع، branch = فروع العضو، غير كده مفيش. */
export function overbookReach(permissions: readonly string[], member: Reach): Reach;
/** رد قاعدة 2: مسموح (ومتعلّم overbooked لو اتشال فحص) أو أول مشكلة. */
export function decideSlot(
  problems: readonly SlotProblem[],
  overbook: boolean,
): { kind: "ok"; overbooked: boolean } | { kind: "refused"; code: SlotProblem };
/** D-5: نفس الحالة = لا شيء، مسموح، أو `invalid_transition`. */
export function decideTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): "same" | "move" | "invalid";
/** اللقطة المسموحة للسجل: مفيش اسم مراجع ولا تليفون ولا ملاحظة الإلغاء. */
export function appointmentAuditSnapshot(a: AppointmentAuditFields): Record<string, unknown>;
```

- `audit-snapshot.ts`: `appointment: ["providerName", "branchId", "serviceNameAr", "serviceNameEn", "startsAt", "endsAt", "status", "overbooked", "cancelReason"]`.
- Tests: `decideSlot([], false)` ok/false; problems + overbook → ok/true; problems without → refused first; transitions; snapshot never contains `patientName`, `cancelNote`, a phone; audit allowlist drops `patientId`.
- Commit `feat(appointments): booking decisions and the appointment audit snapshot`.

## Task 6: Ports and persistence

- `ports/booking-patient-reader.ts`:

```ts
export interface BookingPatient {
  readonly id: string;
  readonly fullName: string;
  readonly fileNumber: number;
  readonly active: boolean;
}
export interface BookingPatientReader {
  /** الملف مقفول `FOR SHARE` (أرشفته في نفس اللحظة بتستنى). */
  lockForBooking(tx: Tx, clinicId: string, patientId: string): Promise<BookingPatient | null>;
  /** أسماء وأرقام ملفات لعرض المواعيد. */
  labels(
    tx: Tx,
    clinicId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, BookingPatient>>;
}
```

- `patients/persistence/pg-booking-patients.ts` implements it (`SELECT id, full_name, file_number, status FROM patients … FOR SHARE`), exported from `patients/index.ts`.
- `persistence/pg-appointment-store.ts`: `insertAppointment`, `findAppointment(tx, clinicId, id, forUpdate)`, `providerBusy(tx, clinicId, membershipId, from, to, exceptId)` (non-cancelled, `starts_at < to AND ends_at > from`), `saveTimes`, `saveStatus`, `saveCancel`, `branchDay(tx, clinicId, branchId, from, to)` (non-cancelled), `lockService(tx, clinicId, id)` (`clinic_services … FOR SHARE`).
- `pg-schedule-store.ts`: `readTimeOffOverlapping(tx, clinicId, membershipId, from, to)`.
- Commit with Task 7.

## Task 7: Use cases, controller, wiring, `test:db`

Check order of a create (API and mock identical):

1. guard (active user → clinic access → module → `create:appointments:branch`);
2. the create reach covers `branchId`, else `forbidden`; `overbook: true` needs an overbook reach covering it, else `forbidden`;
3. Idempotency-Key claim (`appointments:create:<userId>`; replay → the stored id, re-projected; other body → `idempotency_conflict`);
4. `lockProvider`; provider `lockForWrite` → `not_found` / `provider_not_bookable`;
5. patient `lockForBooking` → `not_found` / `patient_inactive`;
6. branch `lockForFiling` → `not_found` / `branch_inactive`; provider works there → `provider_not_in_branch`;
7. service `lockService` → `not_found` / `service_inactive`;
8. end resolved (rule 4) and bounded (`validation`, path `endsAt`);
9. slot problems (schedule rows of that branch, time off, the provider's other appointments) → `decideSlot`;
10. insert, one `appointment.booked` row, complete the key, answer clipped to the view reach.

Reschedule (`PUT /v1/appointments/:id`, `update:appointments:branch`): peek the row (unknown or outside the update reach → `not_found`), `lockProviders([old, new])`, re-read `FOR UPDATE` (retry ≤ 3 when it moved meanwhile), `booked` only → `invalid_transition`, new branch inside the update reach → `forbidden`, then steps 4–9 for the target (excluding itself from the overlap), `overbooked` recomputed, one `appointment.rescheduled` row with old and new times; same values → no row.
Status (`POST …/status`) and cancel (`POST …/cancel`, reason + note): peek, lock the provider, re-read `FOR UPDATE`, `decideTransition`, one `appointment.status_changed` / `appointment.cancelled` row; same status → no row.
Reads: `GET /v1/appointments/branches` (active branches inside the view reach), `GET /v1/appointments/day?branchId&date` (branch inside the view reach else `not_found`; providers working in the branch and bookable, plus any provider with an appointment that day; their weekday rows in that branch; time off overlapping the day; non-cancelled appointments; `can` from the actor's keys at that branch).

`test:db` (`appointments.db.spec.ts`, `appointment-rules.db.spec.ts`, `appointment-concurrency.db.spec.ts`):

- books inside a shift (201, one audit row, no patient name in `raw`); same key replays; other body → 409.
- `outside_schedule`, `provider_time_off`, `appointment_overlap` (also across branches), D-14 cross-midnight accepted.
- overbook holder: same booking → 201 `overbooked: true`, audit `after.overbooked = true`; non-holder asking `overbook` → 403.
- archived patient → `patient_inactive`; non-bookable provider; inactive service; wrong branch → `forbidden` for the branch-scope desk.
- reschedule keeps old/new times in the audit; status table (arrived → completed; completed → arrived `invalid_transition`; cancel without reason 400; cancel → audit without note).
- module off → `module_disabled`; another clinic's appointment id → `not_found`.
- concurrency: two simultaneous bookings, same provider and slot → exactly one 201 and one `appointment_overlap`.
- Commit `feat(appointments): book, reschedule, status and cancel under the provider lock (A2)`.

## Task 8: Web — `ApiClient["appointments"]`, HTTP adapter, mock

```ts
export interface AppointmentsApi {
  listBranches(persona: Persona): Promise<ScheduleBranch[]>;
  day(persona: Persona, query: AppointmentDayQuery): Promise<AppointmentDay>;
  create(
    persona: Persona,
    input: AppointmentInput,
    idempotencyKey: string,
  ): Promise<AppointmentWriteResponse>;
  reschedule(
    persona: Persona,
    id: string,
    input: AppointmentRescheduleInput,
  ): Promise<AppointmentWriteResponse>;
  setStatus(
    persona: Persona,
    id: string,
    input: AppointmentStatusInput,
  ): Promise<AppointmentWriteResponse>;
  cancel(
    persona: Persona,
    id: string,
    input: AppointmentCancelInput,
  ): Promise<AppointmentWriteResponse>;
}
```

- Mock: `authorizeAppointments(db, persona, action)` = `guardAppointments` + reach from `view|create|update:appointments:clinic|branch`; the same 10-step order; slot rules from `@eyadex/contracts/appointments`; audit through `mock-audit`; store field `appointments`, `idempotentAppointments`; `STORAGE_KEY` → `v16`; seed a few appointments for the demo clinic today.
- Tests (`appointments-mock.test.ts`): check order (module off before forbidden), each rule code, overbook, transitions, idempotency, branch scope of the receptionist.
- Commit `feat(web): appointments client — mock and HTTP adapters with the API's rules`.

## Task 9: Web — branch day view and booking dialog

- `appointments/appointments-page.tsx` (branch select + date navigation + legend), `day-view.tsx` (time axis + one `provider-column.tsx` per provider), `day-grid.ts` (pure: visible range from the shifts and appointments, minute ↔ offset, 15-minute slots, block placement) + `day-grid.test.ts`, `appointment-block.tsx` (status icon + label + tint, actions menu: arrived / completed / no-show / reschedule / cancel, only when `can.update`), `booking-dialog.tsx` (create + reschedule, pre-filled start/end, overbook switch only when `can.overbook`, rule errors from `booking-errors.ts`), `patient-picker.tsx` (search through `api.patients.list`, or "new file"), `quick-file-form.tsx` (name, mobile, birth date, gender, branch → `api.patients.create` with its own key), `cancel-dialog.tsx` (reason select + note), `appointment-queries.ts`.
- Route `routes/clinic.appointments.tsx` with `...pageHead("clinicAppointments")`; `CLINIC_NAV` entry `{ to: "/clinic/appointments", label: "nav.appointments", icon: CalendarDays, resource: "appointments" }` (`can()` already drops module-off keys).
- i18n `ar-appointments.ts` / `en-appointments.ts`, route heads, audit labels, error messages.
- Tests: `day-grid.test.ts`, nav test (entry gated by `appointments`), booking-errors ar/en keys present, dialog hides overbook without the key.
- Commit `feat(web): branch day view and booking dialog (A2)`.

## Task 10: Docs

- ADR-0026: A2 section (table, rules, check order, audit, platform view, TODO(spec) list above; §6's receptionist TODO resolved by the owner).
- ADR-0027 (Task 1). `CLAUDE.architecture.md` §2.2 appointments row: May import `tenancy`, `identity`, `patients` (index.ts; adapters bound in appointments.module.ts). `apps/api/AGENTS.md`: lock-order line + A2 line. `docs/roadmap.md` A2 status.
- Commit `docs: ADR-0027 lock order, ADR-0026 slice A2`.

## Task 11: Gates, browser check, Codex

`pnpm typecheck`, `pnpm lint`, `pnpm test`, package builds, dbcheck, `test:db` for db/api/worker/auth, `NITRO_PRESET=node-server pnpm build:all`, prettier on touched files; Chrome/Playwright check of `/clinic/appointments` in mock mode (ar + en, 1440 and 390); up to 3 Codex rounds with logs `/f/Dev/Worktrees/eyadex/codex-a2-r<N>.log`.

## Self-review — spec A2 coverage

| Spec item                                                                  | Task            |
| -------------------------------------------------------------------------- | --------------- |
| §2 `appointments` columns, indexes incl. `own` partial, FK indexes, grants | 3               |
| Rule 1 bookable provider                                                   | 7 (step 4)      |
| Rule 2 branch scope, coverage + D-14, time off, overlap                    | 2, 7            |
| Rule 3 provider lock, one transaction                                      | 1, 7            |
| Rule 4 duration, D-15 bounds                                               | 2, 3 (CHECK), 7 |
| Rule 5 D-5 transitions, cancel reason (D-11)                               | 2, 5, 7         |
| Rule 6 reschedule, old/new times audited                                   | 7               |
| Rule 7 active patient, quick file (D-10)                                   | 6, 7, 9         |
| Rule 8 Idempotency-Key on create                                           | 7               |
| Rule 9 audit, no phone/civil ID                                            | 5, 7            |
| Rule 10 module flag                                                        | 7, 8            |
| Rule 11 UTC / clinic time zone                                             | 2, 7, 9         |
| D-3 overbook                                                               | 5, 7, 8         |
| Owner 1: lock order + three-session test                                   | 1               |
| Owner 2: receptionist defaults                                             | 4               |
| Screens: day view, booking dialog                                          | 9               |
| §8 tests: concurrency, RLS negatives, platform no grant                    | 3, 7            |
