import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockPlatformInvites } from "./mock-platform-invites";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";
import { createMockUsers } from "./mock-users";
import { createMockInvitations } from "./mock-invitations";
import { createMockRoles } from "./mock-roles";
import { createMockPatients } from "./mock-patients";
import { createMockAppointments } from "./mock-appointments";
import { createMockCalendar } from "./mock-calendar";
import { createMockSchedules } from "./mock-schedules";
import { createMockServices } from "./mock-services";
import { createMockNotifications } from "./mock-notifications";
import { createMockWhatsapp } from "./mock-whatsapp";
import { createMockFinance } from "./mock-finance";
import { createMockPayments } from "./mock-payments";
import { createMockCashClosings } from "./mock-cash-closings";
import { createMockAuditLog } from "./mock-audit-log";
import { createMockMedicalAttachments } from "./mock-medical-attachments";
import { createMockMedicalFiles } from "./mock-medical-files";
import { createMockMedicalMedicines } from "./mock-medical-medicines";
import { createMockMedicalVisits } from "./mock-medical-visits";
import { createMockMedicalWalkIn } from "./mock-medical-walk-in";
import { createMockMedicalWrites } from "./mock-medical-writes";
import { createMockAccount, createMockClinicSettings } from "./mock-clinic-settings";
import {
  createMockPlatformOverview,
  createMockPlatformSettings,
  createMockPlatformTeam,
} from "./mock-platform-console";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: { ...createMockPlatform(), ...createMockPlatformInvites() },
    branches: createMockBranches(),
    users: createMockUsers(),
    invitations: createMockInvitations(),
    roles: createMockRoles(),
    patients: createMockPatients(),
    scheduling: { ...createMockServices(), ...createMockSchedules() },
    appointments: { ...createMockAppointments(), ...createMockCalendar() },
    medical: {
      ...createMockMedicalVisits(),
      ...createMockMedicalWalkIn(),
      ...createMockMedicalWrites(),
      ...createMockMedicalFiles(),
      ...createMockMedicalAttachments(),
      ...createMockMedicalMedicines(),
    },
    notifications: createMockNotifications(),
    whatsapp: createMockWhatsapp(),
    finance: createMockFinance(),
    payments: createMockPayments(),
    cashClosings: createMockCashClosings(),
    audit: createMockAuditLog(),
    clinicSettings: createMockClinicSettings(),
    account: createMockAccount(),
    platformOverview: createMockPlatformOverview(),
    platformTeam: createMockPlatformTeam(),
    platformSettings: createMockPlatformSettings(),
  };
}
