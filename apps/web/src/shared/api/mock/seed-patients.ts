import type { Branch } from "@eyadex/contracts/organization";
import type { Patient } from "@eyadex/contracts/patients";
import type { MockState } from "./mock-store";
import { seedCivilId } from "./seed-civil-id";

/** Fictional names, Arabic and English, alternating male / female to match the seeded gender. */
const PATIENT_NAMES = [
  "أحمد العنزي",
  "فاطمة المطيري",
  "Omar Haddad",
  "Sarah Al-Kandari",
  "عبدالله الرشيدي",
  "نورة العجمي",
  "Ali Hassan",
  "Mariam Youssef",
  "حمد الشمري",
  "دانة الكندري",
  "Faisal Al-Otaibi",
  "Reem Al-Salem",
  "يوسف الهاجري",
  "شيخة الدوسري",
  "Bader Al-Mutawa",
  "Lulwa Al-Ghanim",
  "خالد البناي",
  "هيا العتيبي",
  "Nasser Al-Fadhli",
  "Aisha Rahman",
  "سعود الظفيري",
  "منيرة الصباح",
  "Tariq Mansour",
  "Hessa Al-Qattan",
  "جاسم الخالدي",
];

/** Keep patient fixtures together so notification preferences and demographic data share one seed. */
export function seedPatients(
  state: MockState,
  clinicId: string,
  clinicIndex: number,
  branches: readonly Branch[],
  makeId: () => string,
  createdAt: string,
): void {
  const patientCount = clinicIndex === 0 ? 25 : 6;
  for (let pi = 0; pi < patientCount; pi += 1) {
    const name = PATIENT_NAMES[(pi + clinicIndex * 8) % PATIENT_NAMES.length] ?? "أحمد العنزي";
    const branch = branches[pi % 2];
    if (!branch) continue;
    const birthDate = `${1970 + ((pi * 3) % 40)}-${String((pi % 12) + 1).padStart(2, "0")}-15`;
    const patient: Patient = {
      id: makeId(),
      clinicId,
      fileNumber: pi + 1,
      fullName: name,
      // Fake numbers in the +9655xxxxxxx range; never real ones.
      phone: `+9655${String(1000000 + clinicIndex * 100000 + pi * 3517).slice(-7)}`,
      birthDate,
      gender: pi % 2 === 0 ? "male" : "female",
      registrationBranchId: branch.id,
      // Fictional, and every one encodes the birth date above.
      civilId: pi % 3 === 0 ? null : seedCivilId(birthDate, pi * 97 + clinicIndex * 31),
      // Fictional addresses on a reserved domain, so the demo shows sent and skipped messages.
      email: pi % 2 === 0 ? `patient${pi + 1}.c${clinicIndex + 1}@example.invalid` : null,
      messageLanguage: pi % 5 === 0 ? "en" : null,
      notificationsOptOut: pi % 4 === 3,
      status: pi === 7 || pi === patientCount - 1 ? "archived" : "active",
      createdAt,
    };
    state.patients.push(patient);
  }
  state.patientCounters[clinicId] = patientCount;
}
