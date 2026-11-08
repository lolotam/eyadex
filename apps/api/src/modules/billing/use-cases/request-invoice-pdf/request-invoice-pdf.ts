import type { Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { viewReach } from "../../domain/invoice-reach.ts";
import { pdfSubscriptionBlocked } from "../../domain/pdf-delivery.ts";
import { pdfRevision } from "../../domain/pdf-revision.ts";
import { invoiceOwner, lockInvoice } from "../../persistence/pg-invoice-changes.ts";
import { admitPdf, type PdfAdmission } from "../../persistence/pg-pdf-admission.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { InvoicePdfAccessReader } from "../../ports/invoice-pdf-access.ts";
import type { PdfHeaderRevisions, PdfPatientRevision } from "../../ports/pdf-display-revisions.ts";
import { invoiceVisible } from "../invoice-visible.ts";

/** Disabled internal composition seam. Not registered or exported by BillingModule. */
export class RequestInvoicePdf {
  constructor(
    private readonly deps: {
      access: InvoicePdfAccessReader;
      patients: BillingPatientReader;
      patientRevision: PdfPatientRevision;
      headerRevisions: PdfHeaderRevisions;
      rendererRevision: string;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  /** The caller supplies its trusted withTenant transaction, before taking later-order locks. */
  async request(tx: Tx, actor: BillingActor, invoiceId: string): Promise<PdfAdmission> {
    const access = await this.deps.access.read(tx, actor.clinicId, actor.userId);
    if (!access?.active || access.membershipId !== actor.membershipId)
      throw new ApiError("account_disabled");
    if (pdfSubscriptionBlocked(access.clinicStatus, access.expiresAt, this.deps.clock.now()))
      throw new ApiError("subscription_blocked");
    if (!access.financeEnabled) throw new ApiError("module_disabled");
    if (!access.roleActive) throw new ApiError("forbidden");
    const currentActor: BillingActor = {
      ...actor,
      permissions: access.permissions,
      member: access.allBranches ? { all: true } : { all: false, branchIds: access.branchIds },
    };
    const reach = viewReach(currentActor);
    if (!reach) throw new ApiError("forbidden");
    const owner = await invoiceOwner(tx, actor.clinicId, invoiceId);
    if (!owner || !(await invoiceVisible(tx, this.deps.patients, currentActor, reach, owner)))
      throw new ApiError("not_found");
    if (!(await this.deps.patients.lockForInvoice(tx, actor.clinicId, owner.patientId)))
      throw new ApiError("not_found");
    const patient = await this.deps.patientRevision.read(tx, actor.clinicId, owner.patientId);
    const invoice = await lockInvoice(tx, actor.clinicId, invoiceId);
    if (!invoice || invoice.patientId !== owner.patientId || invoice.branchId !== owner.branchId)
      throw new ApiError("not_found");
    const header = await this.deps.headerRevisions.read(tx, actor.clinicId, invoice.branchId);
    if (!header || !patient) throw new ApiError("not_found");
    return admitPdf(tx, {
      clinicId: actor.clinicId,
      invoiceId,
      version: invoice.version,
      revision: pdfRevision(this.deps.rendererRevision, { ...header, patient }),
      jobId: this.deps.ids.newId(),
    });
  }
}
