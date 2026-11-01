import {
  patientNotificationListSchema,
  type PatientNotificationList,
} from "@eyadex/contracts/notifications";
import type { Database } from "@eyadex/db";

import { parseContract } from "../../../shared/contract-parser.ts";
import { ApiError } from "../../../shared/errors.ts";
import { actorViewReach, viewSees, type AppointmentActor } from "../domain/booking-rules.ts";
import { findAppointment } from "../persistence/pg-appointment-store.ts";
import type { AppointmentNotifications } from "../ports/appointment-notifications.ts";

/**
 * The message history of one appointment (spec §5, ADR-0031), newest first, for a caller whose
 * `view:appointments` keys see the appointment (its branch, or under `own` its provider is the caller);
 * any other appointment, another clinic's included, is `not_found`.
 *
 * @param db the clinic pool
 * @param notifications the ledger behind the module's port
 * @param actor the caller
 * @param id the appointment
 * @returns the history
 */
export function readAppointmentNotifications(
  db: Database,
  notifications: AppointmentNotifications,
  actor: AppointmentActor,
  id: string,
): Promise<PatientNotificationList> {
  return db.withTenant(actor.clinicId, async (tx) => {
    const row = await findAppointment(tx, actor.clinicId, id);
    if (row === null || !viewSees(actorViewReach(actor), row)) throw new ApiError("not_found");
    return parseContract(
      patientNotificationListSchema,
      await notifications.history(tx, actor.clinicId, id),
    );
  });
}
