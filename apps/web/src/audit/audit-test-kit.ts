import {
  api,
  as,
  clinicIdAt,
  getState,
  PLATFORM,
  resetMockData,
  store,
} from "@/shared/api/mock/mock-test-kit";

export { api, as, clinicIdAt, getState, PLATFORM, resetMockData };

export const CLINIC_QUERY = {
  cursor: null,
  limit: 100,
  actor: "",
  action: null,
  entity: null,
  category: null,
  from: null,
  to: null,
};
export const PLATFORM_QUERY = {
  cursor: null,
  limit: 100,
  actor: "",
  action: null,
  entity: null,
  source: null,
  clinicId: null,
  from: null,
  to: null,
};

/** Writes administrative and patient-access entries in clinic 0 (and a branch edit in clinic 1). */
export async function seedActivity(): Promise<{ patientId: string; civilId: string }> {
  const db = store.getState();
  const branch = db.branches.find((b) => b.clinicId === clinicIdAt(0));
  const other = db.branches.find((b) => b.clinicId === clinicIdAt(1));
  if (!branch || !other) throw new Error("no branch");
  const input = { nameAr: branch.nameAr, nameEn: `${branch.nameEn} 2`, address: "", phone: "" };
  await api.branches.update(as("clinic_admin"), branch.id, input);
  await api.branches.update(as("clinic_admin", 1), other.id, {
    nameAr: other.nameAr,
    nameEn: `${other.nameEn} B`,
    address: "",
    phone: "",
  });
  const civilId = "290040112347";
  const created = await api.patients.create(
    as("clinic_admin"),
    {
      fullName: "مراجع تجريبي",
      phone: "55501234",
      birthDate: "1990-04-01",
      gender: "male",
      registrationBranchId: branch.id,
      civilId,
      email: "",
      messageLanguage: "",
      notificationsOptOut: false,
    },
    crypto.randomUUID(),
  );
  await api.patients.open(as("clinic_admin"), created.id);
  return { patientId: created.id, civilId };
}
