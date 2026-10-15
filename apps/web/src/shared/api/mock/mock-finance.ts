import {
  invoiceListQuerySchema,
  platformClinicFinanceRequestSchema,
  sendInvoiceRequestSchema,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { FinanceApi } from "../finance-client";
import { guardFinance, holdsView, seesInvoice, type FinanceAccess } from "./mock-finance-access";
import { clinicFinanceOf, clinicHasInvoice, exponentOf, financeState } from "./mock-finance-state";
import * as settings from "./mock-finance-settings";
import { renderInvoicePdf } from "./mock-invoice-pdf";
import { draftOf, editInvoice, issueInvoice, strip, voidInvoice } from "./mock-invoice-writes";
import { parse } from "./mock-medical-access";
import { resolvePlatformActor, writePlatformAudit } from "./mock-platform-actor";
import { delay, getState, newId, persist } from "./mock-store";

function viewer(persona: Persona): FinanceAccess {
  const a = guardFinance(getState(), persona);
  if (!holdsView(a)) throw new ApiError("forbidden");
  return a;
}

function visibleInvoice(persona: Persona, id: string) {
  const db = getState();
  const a = viewer(persona);
  const invoice = financeState(db).invoices.find((i) => i.id === id && i.clinicId === a.clinic.id);
  if (!invoice || !seesInvoice(db, a, invoice)) throw new ApiError("not_found");
  return invoice;
}

function clinicOf(clinicId: string) {
  const clinic = getState().clinics.find((c) => c.id === clinicId);
  if (!clinic) throw new ApiError("not_found");
  return clinic;
}

const platformView = (clinicId: string) => {
  const f = clinicFinanceOf(getState(), clinicId);
  return { currency: f.currency, currencyExponent: exponentOf(f.currency), taxRateBp: f.taxRateBp };
};

/** Saves after a write that succeeded; a refused write leaves the stored state as it was. */
async function write<T>(run: () => T | Promise<T>): Promise<T> {
  await delay();
  const result = await run();
  persist();
  return result;
}

export function createMockFinance(): FinanceApi {
  const db = getState;
  return {
    prices: async (p) => (await delay(), settings.listPrices(db(), p)),
    setServicePrice: (p, id, priceMinor) =>
      write(() => settings.setServicePrice(db(), p, id, { priceMinor })),
    setProviderPrices: (p, id, items) =>
      write(() => settings.setProviderPrices(db(), p, id, { items })),
    settings: async (p) => (await delay(), settings.getSettings(db(), p)),
    updateSettings: (p, commercialRegNo) =>
      write(() => settings.updateSettings(db(), p, { commercialRegNo })),
    logo: async (p) => (await delay(), settings.readLogo(db(), p)),
    uploadLogo: (p, file) => write(() => settings.uploadLogo(db(), p, file)),
    prefixes: async (p) => (await delay(), settings.listPrefixes(db(), p)),
    setPrefix: (p, branchId, invoicePrefix) =>
      write(() => settings.setPrefix(db(), p, branchId, { invoicePrefix })),

    async listInvoices(persona, raw) {
      await delay();
      const a = viewer(persona);
      const q = parse(invoiceListQuerySchema, raw);
      const rows = financeState(db())
        .invoices.filter(
          (i) =>
            i.clinicId === a.clinic.id &&
            seesInvoice(db(), a, i) &&
            (!q.branchId || i.branchId === q.branchId) &&
            (!q.patientId || i.patientId === q.patientId) &&
            (!q.status || i.status === q.status) &&
            (!q.source || i.source === q.source) &&
            (!q.sourceId || i.sourceId === q.sourceId) &&
            (!q.number || i.number.includes(q.number.toUpperCase())) &&
            (!q.from || i.issuedAt.slice(0, 10) >= q.from) &&
            (!q.to || i.issuedAt.slice(0, 10) <= q.to),
        )
        .sort((x, y) => y.issuedAt.localeCompare(x.issuedAt) || y.id.localeCompare(x.id));
      const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
      const page = rows.slice(start, start + q.limit);
      const more = start + q.limit < rows.length;
      return {
        items: page.map(({ clinicId: _c, lines: _l, ...item }) => (void _c, void _l, item)),
        nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
        total: rows.length,
      };
    },
    getInvoice: async (p, id) => (await delay(), strip(visibleInvoice(p, id))),
    draft: async (p, source, id) => (await delay(), draftOf(db(), guardFinance(db(), p), source, id)),
    issue: (p, input, key) =>
      write(() => issueInvoice(db(), guardFinance(db(), p), input, key, new Date())),
    edit: (p, id, version, input) =>
      write(() => editInvoice(db(), guardFinance(db(), p), id, version, input)),
    voidInvoice: (p, id, version, reason) =>
      write(() => voidInvoice(db(), guardFinance(db(), p), id, version, { reason }, new Date())),
    async pdf(persona, id) {
      await delay();
      const invoice = visibleInvoice(persona, id);
      return renderInvoicePdf(invoice);
    },
    send: (persona, id, raw) =>
      write(() => {
        const invoice = visibleInvoice(persona, id);
        const body = parse(sendInvoiceRequestSchema, raw);
        if (invoice.status === "void") throw new ApiError("invoice_void");
        // TODO(spec): the demo answers the send without a message-history row, since the mock ledger
        // keys rows by appointment or visit only. Delivery is the worker's in the real API.
        const sends = financeState(db()).sends;
        const key = `${invoice.clinicId}:${body.sendRequestId}`;
        const previous = sends[key];
        if (previous) {
          if (previous.invoiceId !== id || previous.channel !== body.channel) {
            throw new ApiError("send_request_conflict");
          }
          return { notificationId: previous.notificationId };
        }
        const notificationId = newId();
        sends[key] = { invoiceId: id, channel: body.channel, notificationId };
        return { notificationId };
      }),

    async platformFinance(persona, clinicId) {
      await delay();
      resolvePlatformActor(db(), persona);
      clinicOf(clinicId);
      return platformView(clinicId);
    },
    updatePlatformFinance: (persona, clinicId, raw) =>
      write(() => {
        const actor = resolvePlatformActor(db(), persona);
        const clinic = clinicOf(clinicId);
        const body = parse(platformClinicFinanceRequestSchema, raw);
        const f = clinicFinanceOf(db(), clinicId);
        const before = platformView(clinicId);
        if (body.currency && body.currency !== f.currency && clinicHasInvoice(db(), clinicId)) {
          throw new ApiError("currency_locked");
        }
        if (body.currency) f.currency = body.currency;
        if (body.taxRateBp !== undefined) f.taxRateBp = body.taxRateBp;
        writePlatformAudit(db(), {
          actorName: actor.fullName,
          action: "clinic.finance_changed",
          clinicId,
          summary: `Updated finance of ${clinic.nameEn}`,
          before,
          after: platformView(clinicId),
        });
        return platformView(clinicId);
      }),
    async platformTotals(persona, clinicId) {
      await delay();
      resolvePlatformActor(db(), persona);
      clinicOf(clinicId);
      const sums = new Map<string, { month: string; currency: string; minor: bigint }>();
      for (const i of financeState(db()).invoices) {
        if (i.clinicId !== clinicId || i.status === "void") continue;
        const month = i.issuedAt.slice(0, 7);
        const k = `${month}:${i.currency}`;
        const row = sums.get(k) ?? { month, currency: i.currency, minor: 0n };
        row.minor += BigInt(i.totalMinor);
        sums.set(k, row);
      }
      return {
        months: [...sums.values()]
          .sort((x, y) => y.month.localeCompare(x.month))
          .map((r) => ({
            month: r.month,
            currency: r.currency as never,
            invoicedMinor: r.minor.toString(),
          })),
      };
    },
  };
}
