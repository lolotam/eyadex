import {
  financeSettingsRequestSchema,
  invoicePrefixRequestSchema,
  providerPricesRequestSchema,
  servicePriceRequestSchema,
  type FinanceSettings,
  type InvoicePrefixItem,
  type ServicePrice,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { guardFinance, requireFinanceKey } from "./mock-finance-access";
import {
  clinicFinanceOf,
  exponentOf,
  financeState,
  mockLogos,
  prefixLocked,
  priceOf,
} from "./mock-finance-state";
import { auditFinanceSetting } from "./mock-finance-audit";
import { parse } from "./mock-medical-access";
import type { MockState } from "./mock-store";

const LOGO_MAX_BYTES = 1024 * 1024;

export function settingsView(db: MockState, clinicId: string): FinanceSettings {
  const f = clinicFinanceOf(db, clinicId);
  return {
    currency: f.currency,
    currencyExponent: exponentOf(f.currency),
    taxRateBp: f.taxRateBp,
    commercialRegNo: f.commercialRegNo,
    hasLogo: f.hasLogo,
  };
}

function serviceIn(db: MockState, clinicId: string, serviceId: string) {
  if (!db.services.some((s) => s.id === serviceId && s.clinicId === clinicId)) {
    throw new ApiError("not_found");
  }
}

const priceView = (db: MockState, serviceId: string): ServicePrice => ({
  serviceId,
  ...structuredClone(priceOf(db, serviceId)),
});

export function listPrices(db: MockState, persona: Persona) {
  const a = requireFinanceKey(db, persona, "view:prices:clinic");
  const f = clinicFinanceOf(db, a.clinic.id);
  return {
    currency: f.currency,
    currencyExponent: exponentOf(f.currency),
    // As the API (5f20ec56): each item also carries the service's names and status.
    items: db.services
      .filter((s) => s.clinicId === a.clinic.id)
      .map((s) => ({
        ...priceView(db, s.id),
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        status: s.status,
      })),
  };
}

export function setServicePrice(db: MockState, persona: Persona, serviceId: string, raw: unknown) {
  const a = requireFinanceKey(db, persona, "update:prices:clinic");
  serviceIn(db, a.clinic.id, serviceId);
  const body = parse(servicePriceRequestSchema, raw);
  const state = financeState(db);
  state.prices[serviceId] = { ...priceOf(db, serviceId), priceMinor: body.priceMinor };
  auditFinanceSetting(db, a, "service.price_set", "clinic_service", serviceId);
  return priceView(db, serviceId);
}

/** Replaces the whole doctor list; every member must be an active member of the clinic. */
export function setProviderPrices(
  db: MockState,
  persona: Persona,
  serviceId: string,
  raw: unknown,
) {
  const a = requireFinanceKey(db, persona, "update:prices:clinic");
  serviceIn(db, a.clinic.id, serviceId);
  const body = parse(providerPricesRequestSchema, raw);
  const known = (id: string) =>
    db.members.some((m) => m.id === id && m.clinicId === a.clinic.id && m.status === "active");
  if (!body.items.every((i) => known(i.memberId))) throw new ApiError("validation");
  financeState(db).prices[serviceId] = { ...priceOf(db, serviceId), providerPrices: body.items };
  auditFinanceSetting(db, a, "service.provider_prices_set", "clinic_service", serviceId);
  return priceView(db, serviceId);
}

export function getSettings(db: MockState, persona: Persona) {
  return settingsView(db, guardFinance(db, persona).clinic.id);
}

export function updateSettings(db: MockState, persona: Persona, raw: unknown) {
  const a = guardFinance(db, persona);
  if (!a.keys.includes("update:clinic_settings:clinic")) throw new ApiError("forbidden");
  const body = parse(financeSettingsRequestSchema, raw);
  clinicFinanceOf(db, a.clinic.id).commercialRegNo = body.commercialRegNo;
  auditFinanceSetting(db, a, "clinic.commercial_reg_no_set", "clinic", a.clinic.id);
  return settingsView(db, a.clinic.id);
}

/** `Blob.arrayBuffer` is missing in some test DOMs; FileReader reads the same bytes there. */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function isImage(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await bytesOf(file.slice(0, 4)));
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return png || jpeg;
}

export async function uploadLogo(db: MockState, persona: Persona, file: Blob) {
  const a = guardFinance(db, persona);
  if (!a.keys.includes("update:clinic_settings:clinic")) throw new ApiError("forbidden");
  if (file.size === 0 || file.size > LOGO_MAX_BYTES || !(await isImage(file))) {
    throw new ApiError("validation");
  }
  mockLogos.set(a.clinic.id, file);
  clinicFinanceOf(db, a.clinic.id).hasLogo = true;
  auditFinanceSetting(db, a, "clinic.logo_set", "clinic", a.clinic.id);
  return settingsView(db, a.clinic.id);
}

export function readLogo(db: MockState, persona: Persona): Blob | null {
  const a = guardFinance(db, persona);
  return mockLogos.get(a.clinic.id) ?? null;
}

const prefixItem = (db: MockState, clinicId: string, branchId: string): InvoicePrefixItem => ({
  branchId,
  invoicePrefix: financeState(db).prefixes[branchId] ?? null,
  locked: prefixLocked(db, clinicId, branchId),
});

export function listPrefixes(db: MockState, persona: Persona) {
  const a = requireFinanceKey(db, persona, "update:branches:clinic");
  return db.branches
    .filter((b) => b.clinicId === a.clinic.id)
    .map((b) => prefixItem(db, a.clinic.id, b.id));
}

/** Locked once used; a prefix another branch holds or once used is taken (R1-9). */
export function setPrefix(db: MockState, persona: Persona, branchId: string, raw: unknown) {
  const a = requireFinanceKey(db, persona, "update:branches:clinic");
  if (!db.branches.some((b) => b.id === branchId && b.clinicId === a.clinic.id)) {
    throw new ApiError("not_found");
  }
  const { invoicePrefix } = parse(invoicePrefixRequestSchema, raw);
  const state = financeState(db);
  if (state.prefixes[branchId] === invoicePrefix) return prefixItem(db, a.clinic.id, branchId);
  if (prefixLocked(db, a.clinic.id, branchId)) throw new ApiError("invoice_prefix_locked");
  const heldByOther = db.branches.some(
    (b) =>
      b.clinicId === a.clinic.id && b.id !== branchId && state.prefixes[b.id] === invoicePrefix,
  );
  const usedBy = state.usedPrefixes[`${a.clinic.id}:${invoicePrefix}`];
  if (heldByOther || (usedBy !== undefined && usedBy !== branchId)) {
    throw new ApiError("invoice_prefix_taken");
  }
  const before = state.prefixes[branchId] ?? null;
  state.prefixes[branchId] = invoicePrefix;
  auditFinanceSetting(db, a, "branch.invoice_prefix_set", "branch", branchId, {
    before: { invoicePrefix: before },
    after: { invoicePrefix },
  });
  return prefixItem(db, a.clinic.id, branchId);
}
