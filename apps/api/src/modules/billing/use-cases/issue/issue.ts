import type { CreateInvoiceRequest, Invoice } from "@eyadex/contracts/finance";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { invoiceAuditSnapshot, writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import { branchReach, reachesBranch } from "../../domain/invoice-reach.ts";
import {
  carriesDiscount,
  formatInvoiceNumber,
  invoiceTotals,
  mayDiscount,
} from "../../domain/invoice-rules.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import {
  branchPrefix,
  clinicHasInvoice,
  insertInvoice,
  insertLines,
  issueClinicFacts,
  liveInvoiceOf,
  readInvoice,
  recordPrefix,
  takeNumber,
} from "../../persistence/pg-invoice-store.ts";
import { lockClinicFinance } from "../../persistence/pg-price-store.ts";
import { checkServiceLines, storedLines } from "../invoice-lines.ts";
import { loadSource, type SourceReaders } from "../invoice-source.ts";

export interface IssueDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly sources: SourceReaders;
  readonly patients: BillingPatientReader;
}

// The partial unique index (0060) backs the live-invoice check under the patient lock. The service is
// checked first, so the one foreign key left to fail is a line doctor of no clinic (billing never reads
// memberships); either way the transaction rolls back and the number with it.
function issueFailure(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23505") {
    if (error.constraint === "invoices_clinic_source_live") {
      throw new ApiError("invoice_already_exists");
    }
  }
  if (error instanceof DatabaseError && error.code === "23503") {
    throw new ApiError("validation", [{ path: ["lines"], code: "unknownMember" }]);
  }
  throw error;
}

/**
 * إصدار فاتورة (spec §3.2، §8 rules 7–9، R1-7، R1-8، R1-14) في transaction واحدة: المصدر والمراجع والفرع
 * جوه نطاق الفاعل، الأقفال بالترتيب (قفل مالية العيادة في أول إصدار ليها، بعدين المراجع)، الرقم التالي
 * للفرع والسنة من غير فجوة، الإجماليات بالدالة المشتركة، صف السجل، ومفتاح `Idempotency-Key`. أي فشل
 * بيرجّع الرقم، والمفتاح المكرر بيرجّع نفس الفاتورة من غير ما ياخد رقم.
 */
export class InvoiceIssues {
  constructor(private readonly deps: IssueDeps) {}

  /**
   * يصدر الفاتورة.
   *
   * @param actor الفاعل (شايل `create:invoices` بنطاق `clinic` أو `branch`)
   * @param body الطلب بعد `createInvoiceRequestSchema`
   * @param idempotencyKey المفتاح
   * @returns الفاتورة زي ما اتحفظت
   */
  issue(actor: BillingActor, body: CreateInvoiceRequest, idempotencyKey: string): Promise<Invoice> {
    const reach = branchReach(actor, "create");
    if (reach === null) throw new ApiError("forbidden");
    const claim = {
      clinicId: actor.clinicId,
      scope: `invoice:issue:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(body),
    };
    const { db, clock, ids } = this.deps;
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<{ invoiceId: string }>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") {
          return (await readInvoice(tx, actor.clinicId, claimed.response.invoiceId))!;
        }
        const invoice = await this.write(tx, actor, reach, body);
        await completeClinicIdempotencyKey(tx, claim, { invoiceId: invoice.id });
        return invoice;
      })
      .catch(issueFailure);
  }

  private async write(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    body: CreateInvoiceRequest,
  ): Promise<Invoice> {
    const { clock, ids, patients } = this.deps;
    const { patientId, branchId } = await this.parties(tx, actor, reach, body);
    if (carriesDiscount(body.lines, body.invoiceDiscount) && !mayDiscount(actor, branchId)) {
      throw new ApiError("forbidden");
    }
    // Spec §8 rule 8: the finance lock only for the clinic's first issue (it races a currency change),
    // then the patient row.
    if (!(await clinicHasInvoice(tx, actor.clinicId))) await lockClinicFinance(tx, actor.clinicId);
    if (!(await patients.lockForInvoice(tx, actor.clinicId, patientId))) {
      throw new ApiError("not_found");
    }
    if (body.source !== "manual" && body.sourceId !== null) {
      if ((await liveInvoiceOf(tx, actor.clinicId, body.source, body.sourceId)) !== null) {
        throw new ApiError("invoice_already_exists");
      }
    }
    const prefix = await branchPrefix(tx, actor.clinicId, branchId);
    if (prefix === null) throw new ApiError("invoice_prefix_missing");
    const names = await checkServiceLines(tx, actor.clinicId, body.lines);
    const now = clock.now();
    const facts = await issueClinicFacts(tx, actor.clinicId, now);
    const totals = invoiceTotals(body.lines, body.invoiceDiscount, facts.taxRateBp);
    const seq = await takeNumber(tx, ids, actor.clinicId, branchId, facts.year, now);
    const invoiceId = ids.newId();
    await insertInvoice(tx, actor.clinicId, {
      id: invoiceId,
      branchId,
      patientId,
      year: facts.year,
      numberSeq: seq,
      number: formatInvoiceNumber(prefix, facts.year, seq),
      source: body.source,
      sourceId: body.sourceId,
      issuedAt: now,
      currency: facts.currency,
      currencyExponent: facts.currencyExponent,
      subtotalMinor: totals.subtotalMinor.toString(),
      discountMinor: totals.discountMinor.toString(),
      taxRateBp: facts.taxRateBp,
      taxMinor: totals.taxMinor.toString(),
      totalMinor: totals.totalMinor.toString(),
      invoiceDiscount: body.invoiceDiscount,
      createdBy: actor.membershipId,
    });
    const lines = storedLines(ids, body.lines, names, totals);
    await insertLines(tx, actor.clinicId, invoiceId, lines, now);
    await recordPrefix(tx, ids, actor.clinicId, branchId, prefix, now);
    const invoice = (await readInvoice(tx, actor.clinicId, invoiceId))!;
    await writeFinanceAudit(tx, {
      clinicId: actor.clinicId,
      id: ids.newId(),
      actorUserId: actor.userId,
      action: "invoice.issued",
      entityType: "invoice",
      entityId: invoiceId,
      branchId,
      before: null,
      after: invoiceAuditSnapshot(invoice),
      createdAt: now,
    });
    return invoice;
  }

  // R1-7: an appointment or visit names the patient and branch; a manual invoice names them itself and
  // they must sit inside the caller's reach. Outside it, the answer is not_found (ISO-02).
  private async parties(
    tx: Tx,
    actor: BillingActor,
    reach: MemberBranches,
    body: CreateInvoiceRequest,
  ): Promise<{ patientId: string; branchId: string }> {
    if (body.source !== "manual") {
      const facts = await loadSource(
        tx,
        this.deps.sources,
        actor.clinicId,
        reach,
        body.source,
        body.sourceId!,
      );
      return { patientId: facts.patientId, branchId: facts.branchId };
    }
    const patientId = body.patientId!;
    const branchId = body.branchId!;
    const access = await this.deps.patients.access(tx, actor.clinicId, actor, patientId);
    if (!reachesBranch(reach, branchId) || !access.inPatientReach) throw new ApiError("not_found");
    return { patientId, branchId };
  }
}
