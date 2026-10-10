import { attachmentListSchema } from "@eyadex/contracts/attachments";
import { icd10ResultSchema } from "@eyadex/contracts/icd10";
import { medicalProfileSchema } from "@eyadex/contracts/medical-profile";
import { medicineListSchema, medicineWriteResponseSchema } from "@eyadex/contracts/medicines";
import {
  prescriptionPrintSchema,
  visitDetailSchema,
  visitListSchema,
  visitWriteResponseSchema,
  walkInBranchesSchema,
  walkInCandidatesSchema,
} from "@eyadex/contracts/visits";
import type { MedicalApi } from "../medical-client";
import type { HttpContext } from "./http-context";

// P2 spec §5. Clinical text, names, medicine names and search text go in bodies only; a URL holds
// ids, a cursor, or (the contract's one exception) the ICD-10 lookup's code or title words.
const id = encodeURIComponent;
const visit = (v: string) => `/v1/visits/${id(v)}`;
const patient = (p: string) => `/v1/patients/${id(p)}`;
const medicine = (m: string) => `/v1/medicines/${id(m)}`;

export function createHttpMedical(ctx: HttpContext): MedicalApi {
  const { transport } = ctx;
  const write = async (method: "PUT" | "POST", path: string, body?: unknown) =>
    (await transport.send(method, path, { schema: visitWriteResponseSchema, body: body ?? {} }))
      .visit;
  const medicineWrite = async (method: "PUT" | "POST", path: string, body?: unknown) =>
    (await transport.send(method, path, { schema: medicineWriteResponseSchema, body: body ?? {} }))
      .medicine;
  return {
    listVisits: (_p, patientId, query) =>
      transport.send("GET", `${patient(patientId)}/visits`, {
        schema: visitListSchema,
        query: { cursor: query.cursor },
      }),
    searchVisits: (_p, patientId, query) =>
      transport.send("POST", `${patient(patientId)}/visits/search`, {
        schema: visitListSchema,
        body: query.cursor ? { q: query.q, cursor: query.cursor } : { q: query.q },
      }),
    walkInBranches: () =>
      transport.send("GET", "/v1/visits/walk-in-branches", { schema: walkInBranchesSchema }),
    walkInCandidates: (_p, input) =>
      transport.send("POST", "/v1/visits/walk-in-candidates", {
        schema: walkInCandidatesSchema,
        body: { branchId: input.branchId, q: input.q },
      }),
    startVisit: async (_p, input, idempotencyKey) =>
      (
        await transport.send("POST", "/v1/visits", {
          schema: visitWriteResponseSchema,
          body: input,
          idempotencyKey,
        })
      ).visit,
    getVisit: (_p, visitId) => transport.send("GET", visit(visitId), { schema: visitDetailSchema }),
    saveNote: (_p, visitId, input) => write("PUT", `${visit(visitId)}/note`, input),
    saveDiagnoses: (_p, visitId, input) => write("PUT", `${visit(visitId)}/diagnoses`, input),
    savePrescription: (_p, visitId, input) => write("PUT", `${visit(visitId)}/prescription`, input),
    signVisit: (_p, visitId) => write("POST", `${visit(visitId)}/sign`),
    cancelVisit: (_p, visitId, input) => write("POST", `${visit(visitId)}/cancel`, input),
    addAddendum: (_p, visitId, input) => write("POST", `${visit(visitId)}/addenda`, input),
    getMedicalProfile: (_p, patientId) =>
      transport.send("GET", `${patient(patientId)}/medical-profile`, {
        schema: medicalProfileSchema,
      }),
    saveMedicalProfile: (_p, patientId, input) =>
      transport.send("PUT", `${patient(patientId)}/medical-profile`, {
        schema: medicalProfileSchema,
        body: input,
      }),
    searchIcd10: (_p, q) =>
      transport.send("GET", "/v1/icd10", { schema: icd10ResultSchema, query: { q } }),
    listMedicines: () => transport.send("GET", "/v1/medicines", { schema: medicineListSchema }),
    createMedicine: async (_p, input, idempotencyKey) =>
      (
        await transport.send("POST", "/v1/medicines", {
          schema: medicineWriteResponseSchema,
          body: input,
          idempotencyKey,
        })
      ).medicine,
    updateMedicine: (_p, medicineId, input) => medicineWrite("PUT", medicine(medicineId), input),
    deactivateMedicine: (_p, medicineId) =>
      medicineWrite("POST", `${medicine(medicineId)}/deactivate`),
    reactivateMedicine: (_p, medicineId) =>
      medicineWrite("POST", `${medicine(medicineId)}/reactivate`),
    listAttachments: (_p, patientId, query) =>
      transport.send("GET", `${patient(patientId)}/attachments`, {
        schema: attachmentListSchema,
        query: { visitId: query.visitId },
      }),
    uploadAttachment: async (_p, patientId, file, visitId) => {
      const form = new FormData();
      form.append("file", file, file.name);
      if (visitId !== null) form.append("visitId", visitId);
      await transport.sendEmpty("POST", `${patient(patientId)}/attachments`, { form });
    },
    downloadAttachment: (_p, attachmentId) =>
      transport.download(`/v1/attachments/${id(attachmentId)}`),
    archiveAttachment: (_p, attachmentId) =>
      transport.sendEmpty("POST", `/v1/attachments/${id(attachmentId)}/archive`),
    getPrescriptionPrint: (_p, visitId) =>
      transport.send("GET", `${visit(visitId)}/prescription/print`, {
        schema: prescriptionPrintSchema,
      }),
  };
}
