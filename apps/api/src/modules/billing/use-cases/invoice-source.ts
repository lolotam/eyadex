import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import type { MemberBranches } from "../domain/billing-actor.ts";
import { reachesBranch } from "../domain/invoice-reach.ts";
import type {
  BillingAppointmentReader,
  BillingVisitReader,
  SourceFacts,
} from "../ports/billing-sources.ts";

export interface SourceReaders {
  readonly appointments: BillingAppointmentReader;
  readonly visits: BillingVisitReader;
}

/**
 * المصدر (موعد أو زيارة) جوه نطاق الفاعل، والمراجع والفرع متاخدين منه (R1-7). الزيارة خدمتها من موعدها،
 * وزيارة من غير موعد مالهاش خدمة. مصدر مش موجود أو برا الفروع = `not_found` (ISO-02).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param readers الـ ports
 * @param clinicId العيادة
 * @param reach فروع الفاعل للفعل ده
 * @param source نوع المصدر
 * @param sourceId المصدر
 * @returns حقايق المصدر
 */
export async function loadSource(
  tx: Tx,
  readers: SourceReaders,
  clinicId: string,
  reach: MemberBranches,
  source: "appointment" | "visit",
  sourceId: string,
): Promise<SourceFacts> {
  const facts = await readSource(tx, readers, clinicId, source, sourceId);
  if (facts === null || !reachesBranch(reach, facts.branchId)) throw new ApiError("not_found");
  return facts;
}

async function readSource(
  tx: Tx,
  readers: SourceReaders,
  clinicId: string,
  source: "appointment" | "visit",
  sourceId: string,
): Promise<SourceFacts | null> {
  if (source === "appointment") return readers.appointments.find(tx, clinicId, sourceId);
  const visit = await readers.visits.find(tx, clinicId, sourceId);
  if (visit === null) return null;
  const appointment =
    visit.appointmentId === null
      ? null
      : await readers.appointments.find(tx, clinicId, visit.appointmentId);
  return {
    patientId: visit.patientId,
    branchId: visit.branchId,
    providerId: visit.providerId,
    serviceId: appointment?.serviceId ?? null,
  };
}
