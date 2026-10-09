import {
  bookingProfileInputSchema,
  serviceInputSchema,
  serviceListQuerySchema,
  type ClinicService,
  type ServiceInput,
  type ServiceStatus,
} from "@eyadex/contracts/services";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { actorReplayKey } from "./mock-idempotency";
import { guardAppointments, profileOf } from "./mock-scheduling-rules";
import { delay, getState, newId, persist, type MockState, type StoredService } from "./mock-store";
import { enforceMayTouchAdmin, paginate } from "./mock-user-rules";

type ServicesApi = Pick<
  SchedulingApi,
  | "listServices"
  | "createService"
  | "updateService"
  | "deactivateService"
  | "reactivateService"
  | "getBookingProfile"
  | "setBookingProfile"
>;

function parseService(raw: ServiceInput): ServiceInput {
  const parsed = serviceInputSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

// The API's order: module before the permission (guardAppointments first), then the key itself.
function access(
  db: MockState,
  persona: Persona,
  action: "view" | "create" | "update" | "deactivate",
) {
  guardAppointments(db, persona);
  return authorize(db, persona, action, "services");
}

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

function enforceNameFree(
  db: MockState,
  clinicId: string,
  input: ServiceInput,
  exceptId: string | null,
) {
  const taken = db.services.some(
    (s) =>
      s.clinicId === clinicId &&
      s.id !== exceptId &&
      (same(s.nameAr, input.nameAr) || same(s.nameEn, input.nameEn)),
  );
  if (taken) throw new ApiError("service_name_taken");
}

function findService(db: MockState, clinicId: string, id: string): StoredService {
  const service = db.services.find((s) => s.clinicId === clinicId && s.id === id);
  if (!service) throw new ApiError("not_found");
  return service;
}

const snapshot = (s: StoredService) => ({
  id: s.id,
  nameAr: s.nameAr,
  nameEn: s.nameEn,
  durationMinutes: s.durationMinutes,
  status: s.status,
});

const view = (s: StoredService): ClinicService => ({
  id: s.id,
  nameAr: s.nameAr,
  nameEn: s.nameEn,
  durationMinutes: s.durationMinutes,
  status: s.status,
  createdAt: s.createdAt,
});

export function createMockServices(): ServicesApi {
  async function setStatus(persona: Persona, id: string, status: ServiceStatus) {
    await delay();
    const db = getState();
    const { clinic, actorName } = access(db, persona, "deactivate");
    const service = findService(db, clinic.id, id);
    if (service.status === status) return view(service);
    const before = snapshot(service);
    service.status = status;
    const action = status === "inactive" ? "service.deactivated" : "service.reactivated";
    writeClinicAudit(db, {
      clinicId: clinic.id,
      actorName,
      action,
      entity: "clinic_service",
      before,
      after: snapshot(service),
    });
    persist();
    return view(service);
  }

  return {
    async listServices(persona, rawQuery) {
      await delay();
      const db = getState();
      const { clinic } = access(db, persona, "view");
      const parsed = serviceListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const rows = db.services
        .filter((s) => s.clinicId === clinic.id)
        .filter((s) => !parsed.data.status || s.status === parsed.data.status)
        .map(view);
      return paginate(rows, parsed.data.cursor, parsed.data.limit);
    },
    async createService(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      const { clinic, member, actorName } = access(db, persona, "create");
      const input = parseService(rawInput);
      const replayKey = actorReplayKey(clinic.id, member.id, idempotencyKey);
      const fingerprint = JSON.stringify(input);
      const previous = db.idempotentServices?.[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        return view(findService(db, clinic.id, previous.serviceId));
      }
      enforceNameFree(db, clinic.id, input, null);
      const service: StoredService = {
        id: newId(),
        clinicId: clinic.id,
        ...input,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      db.services.push(service);
      db.idempotentServices = {
        ...db.idempotentServices,
        [replayKey]: { serviceId: service.id, fingerprint },
      };
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "service.created",
        entity: "clinic_service",
        before: null,
        after: snapshot(service),
      });
      persist();
      return view(service);
    },
    async updateService(persona, id, rawInput) {
      await delay();
      const db = getState();
      const { clinic, actorName } = access(db, persona, "update");
      const input = parseService(rawInput);
      const service = findService(db, clinic.id, id);
      const unchanged =
        service.nameAr === input.nameAr &&
        service.nameEn === input.nameEn &&
        service.durationMinutes === input.durationMinutes;
      if (unchanged) return view(service);
      enforceNameFree(db, clinic.id, input, id);
      const before = snapshot(service);
      Object.assign(service, input);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "service.updated",
        entity: "clinic_service",
        before,
        after: snapshot(service),
      });
      persist();
      return view(service);
    },
    deactivateService: (persona, id) => setStatus(persona, id, "inactive"),
    reactivateService: (persona, id) => setStatus(persona, id, "active"),
    async getBookingProfile(persona, memberId) {
      await delay();
      const db = getState();
      guardAppointments(db, persona);
      const { clinic } = authorize(db, persona, "view", "users");
      if (!db.members.some((m) => m.clinicId === clinic.id && m.id === memberId)) {
        throw new ApiError("not_found");
      }
      return { memberId, ...profileOf(db, memberId) };
    },
    async setBookingProfile(persona, memberId, rawInput) {
      await delay();
      const db = getState();
      guardAppointments(db, persona);
      const { clinic, role, actorName } = authorize(db, persona, "update", "users");
      const parsed = bookingProfileInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const member = db.members.find((m) => m.clinicId === clinic.id && m.id === memberId);
      if (!member) throw new ApiError("not_found");
      enforceMayTouchAdmin(db, role, member.roleId);
      const before = profileOf(db, memberId);
      const next = parsed.data;
      const same =
        before.acceptsAppointments === next.acceptsAppointments &&
        before.defaultDurationMinutes === next.defaultDurationMinutes;
      if (!same) {
        db.bookingProfiles[memberId] = { ...next };
        const person = { id: memberId, fullName: member.fullName };
        writeClinicAudit(db, {
          clinicId: clinic.id,
          actorName,
          action: "user.booking_changed",
          entity: "user",
          before: { ...person, ...before },
          after: { ...person, ...next },
        });
        persist();
      }
      return { memberId, ...next };
    },
  };
}
