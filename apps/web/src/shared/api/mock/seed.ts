import { DEFAULT_PLATFORM_SETTINGS } from "@eyadex/contracts/platform";
import type { Clinic, ClinicFeatures } from "@eyadex/contracts/clinics";
import type { Branch } from "@eyadex/contracts/organization";
import type { MembershipUser } from "@eyadex/contracts/users";
import type { MockState } from "./mock-store";
import { issueInviteToken } from "./mock-invite-tokens";
import { seedPatients } from "./seed-patients";
import { seedAppointments } from "./seed-appointments";
import { seedMedical } from "./seed-medical";
import { EMPTY_MEDICAL } from "./mock-medical-state";
import { seedScheduling } from "./seed-scheduling";
import { buildSystemRoles } from "./seed-roles";

const DAY = 24 * 60 * 60 * 1000;

function idFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  };
}

const CLINICS = [
  {
    slug: "serenity",
    nameAr: "عيادة السكينة للطب النفسي",
    nameEn: "Serenity Psychiatric Clinic",
    specialty: "psychiatry",
    status: "active",
    days: 210,
    maxUsers: 10,
    maxBranches: 3,
  },
  {
    slug: "al-noor",
    nameAr: "مركز النور للعلاج النفسي",
    nameEn: "Al Noor Psychology Center",
    specialty: "psychology",
    status: "trial",
    days: 9,
    maxUsers: 6,
    maxBranches: 2,
  },
  {
    slug: "bright-smile",
    nameAr: "عيادة الابتسامة المشرقة",
    nameEn: "Bright Smile Dental",
    specialty: "dental",
    status: "suspended",
    days: 90,
    maxUsers: 8,
    maxBranches: 2,
  },
] as const;

const BRANCH_NAMES = [
  ["السالمية", "Salmiya"],
  ["حولي", "Hawalli"],
  ["الجابرية", "Jabriya"],
  ["الفروانية", "Farwaniya"],
  ["مدينة الكويت", "Kuwait City"],
  ["الفحيحيل", "Fahaheel"],
] as const;

const STAFF = [
  { key: "clinic_admin", name: "Noura Al-Sabah", local: "admin" },
  { key: "doctor", name: "Dr. Khaled Al-Mutairi", local: "khaled" },
  { key: "receptionist", name: "Mariam Al-Enezi", local: "mariam" },
  { key: "technician", name: "Yousef Al-Rashidi", local: "yousef" },
  { key: "doctor", name: "Dr. Huda Al-Kandari", local: "huda" },
  { key: "receptionist", name: "Salem Al-Ajmi", local: "salem" },
] as const;

/** Index into STAFF of the seeded deactivated account. */
const DEACTIVATED_STAFF = 5;

export function buildSeed(): MockState {
  const makeId = idFactory();
  const now = Date.now();
  const state: MockState = {
    clinics: [],
    features: {},
    branches: [],
    roles: [],
    members: [],
    invitations: [],
    inviteOutbox: {},
    patients: [],
    patientCounters: {},
    services: [],
    bookingProfiles: {},
    scheduleRows: [],
    timeOff: [],
    appointments: [],
    medical: EMPTY_MEDICAL(),
    platformAccounts: [
      {
        id: makeId(),
        fullName: "Waleed Mohamed",
        email: "waleed@eyadex.com",
        status: "active",
        joinedAt: new Date(now - 200 * DAY).toISOString(),
        createdAt: new Date(now - 200 * DAY).toISOString(),
      },
      {
        id: makeId(),
        fullName: "Noura Al-Saleh",
        email: "noura@eyadex.com",
        status: "active",
        joinedAt: new Date(now - 90 * DAY).toISOString(),
        createdAt: new Date(now - 95 * DAY).toISOString(),
      },
      {
        id: makeId(),
        fullName: "Fahad Al-Mutairi",
        email: "fahad@eyadex.com",
        status: "deactivated",
        joinedAt: new Date(now - 150 * DAY).toISOString(),
        createdAt: new Date(now - 160 * DAY).toISOString(),
      },
    ],
    platformSettings: { ...DEFAULT_PLATFORM_SETTINGS },
    platformAudit: [],
    clinicAudit: [],
  };

  CLINICS.forEach((c, ci) => {
    const clinicId = makeId();
    const createdAt = new Date(now - (120 - ci * 30) * DAY).toISOString();
    const clinic: Clinic = {
      id: clinicId,
      slug: c.slug,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      specialty: c.specialty,
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
      status: c.status,
      expiresAt: new Date(now + c.days * DAY).toISOString(),
      maxUsers: c.maxUsers,
      maxBranches: c.maxBranches,
      createdAt,
    };
    state.clinics.push(clinic);
    // P2: the demo shows the released state, so the demo clinic has the medical module on.
    const features: ClinicFeatures = { patients: true, appointments: true, medical: ci === 0 };
    state.features[clinicId] = features;

    const branches: Branch[] = [0, 1].map((bi) => {
      const pair = BRANCH_NAMES[ci * 2 + bi] ?? BRANCH_NAMES[0];
      return {
        id: makeId(),
        clinicId,
        nameAr: pair[0],
        nameEn: pair[1],
        address: bi === 0 ? "شارع الخليج العربي، الكويت" : "شارع بيروت، الكويت",
        phone: `+965 22${ci + 1}${bi + 1} 0000`,
        isActive: true,
        createdAt,
      };
    });
    state.branches.push(...branches);

    const roles = buildSystemRoles(clinicId, makeId);
    state.roles.push(...roles);

    STAFF.forEach((s, si) => {
      const role = roles.find((r) => r.systemKey === s.key);
      if (!role) return;
      const branch = branches[si % 2];
      const member: MembershipUser = {
        id: makeId(),
        clinicId,
        userId: makeId(),
        fullName: s.name,
        email: `${s.local}.${c.slug}@example.com`,
        roleId: role.id,
        allBranches: s.key === "clinic_admin" || !branch,
        branchIds: branch && s.key !== "clinic_admin" ? [branch.id] : [],
        status: si === DEACTIVATED_STAFF ? "deactivated" : "active",
        preferredLanguage: "ar",
        lastLoginAt: si < 3 ? new Date(now - (si + 1) * DAY).toISOString() : null,
        createdAt,
      };
      state.members.push(member);
    });

    const doctorRole = roles.find((r) => r.systemKey === "doctor");
    const technicianRole = roles.find((r) => r.systemKey === "technician");
    const firstBranch = branches[0];
    if (doctorRole && technicianRole && firstBranch) {
      state.invitations.push(
        {
          id: makeId(),
          clinicId,
          email: `layla.${c.slug}@example.com`,
          fullName: "Dr. Layla Al-Hajri",
          roleId: doctorRole.id,
          allBranches: false,
          branchIds: [firstBranch.id],
          status: "pending",
          expiresAt: new Date(now + 5 * DAY).toISOString(),
          createdAt: new Date(now - 2 * DAY).toISOString(),
          invitedBy: "Noura Al-Sabah",
          respondedAt: null,
          tokenHash: "",
        },
        {
          id: makeId(),
          clinicId,
          email: `fahad.${c.slug}@example.com`,
          fullName: "Fahad Al-Shammari",
          roleId: technicianRole.id,
          allBranches: true,
          branchIds: [],
          status: "pending",
          expiresAt: new Date(now - 3 * DAY).toISOString(),
          createdAt: new Date(now - 10 * DAY).toISOString(),
          invitedBy: "Noura Al-Sabah",
          respondedAt: null,
          tokenHash: "",
        },
      );
    }

    seedPatients(state, clinicId, ci, branches, makeId, createdAt);
    seedScheduling(state, clinicId, makeId, createdAt);
    if (ci === 0) seedAppointments(state, clinicId, makeId, createdAt);
    if (ci === 0) seedMedical(state, clinicId, makeId);

    state.platformAudit.push({
      id: makeId(),
      actorName: "Waleed Mohamed",
      action: "clinic.created",
      clinicId,
      summary: `Created clinic ${c.nameEn}`,
      before: null,
      after: { nameAr: c.nameAr, nameEn: c.nameEn },
      createdAt,
    });
  });

  for (const inv of state.invitations) issueInviteToken(state, inv);
  return state;
}
