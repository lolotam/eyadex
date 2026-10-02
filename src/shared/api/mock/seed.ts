import type { Clinic, ClinicFeatures } from "@contracts/clinics";
import type { Branch, Member } from "@contracts/organization";
import type { Patient } from "@contracts/patients";
import type { MockState } from "./mock-store";
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
  { slug: "serenity", nameAr: "عيادة السكينة للطب النفسي", nameEn: "Serenity Psychiatric Clinic", specialty: "psychiatry", status: "active", days: 210, maxUsers: 10, maxBranches: 3 },
  { slug: "al-noor", nameAr: "مركز النور للعلاج النفسي", nameEn: "Al Noor Psychology Center", specialty: "psychology", status: "trial", days: 9, maxUsers: 8, maxBranches: 2 },
  { slug: "bright-smile", nameAr: "عيادة الابتسامة المشرقة", nameEn: "Bright Smile Dental", specialty: "dental", status: "suspended", days: 90, maxUsers: 6, maxBranches: 2 },
] as const;

const BRANCH_NAMES = [
  ["السالمية", "Salmiya"], ["حولي", "Hawalli"], ["الجابرية", "Jabriya"],
  ["الفروانية", "Farwaniya"], ["مدينة الكويت", "Kuwait City"], ["الفحيحيل", "Fahaheel"],
] as const;

const STAFF = [
  { key: "clinic_admin", name: "Noura Al-Sabah", local: "admin" },
  { key: "doctor", name: "Dr. Khaled Al-Mutairi", local: "khaled" },
  { key: "receptionist", name: "Mariam Al-Enezi", local: "mariam" },
  { key: "technician", name: "Yousef Al-Rashidi", local: "yousef" },
  { key: "doctor", name: "Dr. Huda Al-Kandari", local: "huda" },
] as const;

const FIRST = ["أحمد", "فاطمة", "محمد", "سارة", "عبدالله", "نورة", "علي", "مريم", "حمد", "دانة"];
const LAST = ["العنزي", "المطيري", "الرشيدي", "الكندري", "العجمي"];

export function buildSeed(): MockState {
  const makeId = idFactory();
  const now = Date.now();
  const state: MockState = {
    clinics: [], features: {}, branches: [], roles: [], members: [], invitations: [], patients: [], platformAudit: [], clinicAudit: [],
  };

  CLINICS.forEach((c, ci) => {
    const clinicId = makeId();
    const createdAt = new Date(now - (120 - ci * 30) * DAY).toISOString();
    const clinic: Clinic = {
      id: clinicId, slug: c.slug, nameAr: c.nameAr, nameEn: c.nameEn, specialty: c.specialty,
      defaultLanguage: "ar", timezone: "Asia/Kuwait", status: c.status,
      expiresAt: new Date(now + c.days * DAY).toISOString(),
      maxUsers: c.maxUsers, maxBranches: c.maxBranches, createdAt,
    };
    state.clinics.push(clinic);
    const features: ClinicFeatures = { patients: true };
    state.features[clinicId] = features;

    const branches: Branch[] = [0, 1].map((bi) => {
      const pair = BRANCH_NAMES[ci * 2 + bi] ?? BRANCH_NAMES[0];
      return {
        id: makeId(), clinicId, nameAr: pair[0], nameEn: pair[1],
        address: bi === 0 ? "شارع الخليج العربي، الكويت" : "شارع بيروت، الكويت",
        phone: `+965 22${ci + 1}${bi + 1} 0000`, isActive: true, createdAt,
      };
    });
    state.branches.push(...branches);

    const roles = buildSystemRoles(clinicId, makeId);
    state.roles.push(...roles);

    STAFF.forEach((s, si) => {
      const role = roles.find((r) => r.systemKey === s.key);
      if (!role) return;
      const branch = branches[si % 2];
      const member: Member = {
        id: makeId(), clinicId, userId: makeId(), fullName: s.name, email: `${s.local}@example.com`,
        roleId: role.id, allBranches: s.key === "clinic_admin" || !branch, branchIds: branch && s.key !== "clinic_admin" ? [branch.id] : [],
        status: "active", preferredLanguage: "ar", createdAt,
      };
      state.members.push(member);
    });

    for (let pi = 0; pi < 20; pi += 1) {
      const first = FIRST[pi % FIRST.length] ?? "أحمد";
      const last = LAST[(pi + ci) % LAST.length] ?? "العنزي";
      const branch = branches[pi % 2];
      if (!branch) continue;
      const patient: Patient = {
        id: makeId(), clinicId, fileNumber: String(1001 + pi), fullName: `${first} ${last}`,
        phone: `+965 ${String(5000_0000 + ci * 1_000_000 + pi * 137).slice(0, 8)}`,
        birthDate: `${1970 + ((pi * 3) % 40)}-${String((pi % 12) + 1).padStart(2, "0")}-15`,
        gender: pi % 2 === 0 ? "male" : "female", registrationBranchId: branch.id,
        civilId: pi % 3 === 0 ? null : `2${String(90000000000 + pi * 7919 + ci).slice(0, 11)}`,
        status: pi === 19 ? "archived" : "active", createdAt,
      };
      state.patients.push(patient);
    }

    state.platformAudit.push({
      id: makeId(), actorName: "Waleed Mohamed", action: "clinic.created", clinicId,
      summary: `Created clinic ${c.nameEn}`, createdAt,
    });
  });

  return state;
}
