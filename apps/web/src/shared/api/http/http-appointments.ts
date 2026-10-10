import {
  appointmentBranchesSchema,
  appointmentDaySchema,
  appointmentWriteResponseSchema,
} from "@eyadex/contracts/appointments";
import type { AppointmentsApi } from "../appointments-client";
import type { HttpContext } from "./http-context";

const appointment = (id: string) => `/v1/appointments/${encodeURIComponent(id)}`;

export function createHttpAppointments(ctx: HttpContext): AppointmentsApi {
  const { transport } = ctx;
  const write = { schema: appointmentWriteResponseSchema };
  return {
    listBranches: () =>
      transport.send("GET", "/v1/appointments/branches", { schema: appointmentBranchesSchema }),
    day: (_persona, query) =>
      transport.send("GET", "/v1/appointments/day", {
        schema: appointmentDaySchema,
        query: { branchId: query.branchId, date: query.date },
      }),
    create: (_persona, input, idempotencyKey) =>
      transport.send("POST", "/v1/appointments", {
        ...write,
        idempotencyKey,
        body: {
          branchId: input.branchId,
          providerMembershipId: input.providerMembershipId,
          patientId: input.patientId,
          serviceId: input.serviceId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          overbook: input.overbook,
        },
      }),
    reschedule: (_persona, id, input) =>
      transport.send("PUT", appointment(id), {
        ...write,
        body: {
          branchId: input.branchId,
          providerMembershipId: input.providerMembershipId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          overbook: input.overbook,
        },
      }),
    setStatus: (_persona, id, input) =>
      transport.send("POST", `${appointment(id)}/status`, {
        ...write,
        body: { status: input.status },
      }),
    cancel: (_persona, id, input) =>
      transport.send("POST", `${appointment(id)}/cancel`, {
        ...write,
        body: { reason: input.reason, note: input.note },
      }),
  };
}
