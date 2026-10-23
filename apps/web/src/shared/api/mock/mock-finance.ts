import { dayInTimeZone } from "@eyadex/contracts/audit";
import {
  invoiceListQuerySchema,
  platformClinicFinanceRequestSchema,
  sendInvoiceRequestSchema,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { FinanceApi } from "../finance-client";
import { guardFinance, holdsView, seesInvoice, type FinanceAccess } from "./mock-finance-access";
import {
  clinicFinanceOf,
  clinicHasInvoice,
  clinicHasPrice,
  clinicMonth,
  exponentOf,
  financeState,
} from "./mock-finance-state";
import * as settings from "./mock-finance-settings";
import { writeClinicAudit } from "./mock-audit";
import { renderInvoicePdf } from "./mock-invoice-pdf";
import { draftOf, editInvoice, issueInvoice, voidInvoice } from "./mock-invoice-writes";
import { strip } from "./mock-invoice-view";
import { settlementOf } from "./mock-settlement";
import { parse } from "./mock-medical-access";
import { resolvePlatformActor, writePlatformAudit } from "./mock-platform-actor";
import { platformTotalsOf } from "./mock-platform-totals";
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

/** The patient's display name for an invoice, same clinic only; as the API, a missing one is `unknown`. */
function patientNameOf(clinicId: string, patientId: string): string {
  const patient = getState().patients.find((x) => x.clinicId === clinicId && x.id === patientId);
  if (!patient) throw new ApiError("unknown");
  return patient.fullName;
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
    setPaymentMethods: (p, paymentMethods) =>
      write(() => settings.setPaymentMethods(db(), p, { paymentMethods })),
    prefixes: async (p) => (await delay(), settings.listPrefixes(db(), p)),
    setPrefix: (p, branchId, invoicePrefix) =>
      write(() => settings.setPrefix(db(), p, branchId, { invoicePrefix })),

    async listInvoices(persona, raw) {
      await delay();
      const a = viewer(persona);
      const q = parse(invoiceListQuerySchema, raw);
      const related =
        q.encounter && q.source === "appointment"
          ? db()
              .medical.visits.filter(
                (v) => v.clinicId === a.clinic.id && v.appointmentId === q.sourceId,
              )
              .map((v) => ({ source: "visit", sourceId: v.id }))
          : q.encounter && q.source === "visit"
            ? [
                {
                  source: "appointment",
                  sourceId: db().medical.visits.find(
                    (v) => v.clinicId === a.clinic.id && v.id === q.sourceId,
                  )?.appointmentId,
                },
              ]
            : [];
      const matchesSource = (i: { source: string; sourceId: string | null }) =>
        ((!q.source || i.source === q.source) && (!q.sourceId || i.sourceId === q.sourceId)) ||
        related.some(
          (s) => s.sourceId != null && i.source === s.source && i.sourceId === s.sourceId,
        );
      // As the API: from/to are days on the clinic's clock, not UTC days.
      const day = (iso: string) => dayInTimeZone(iso, a.clinic.timezone);
      const rows = financeState(db())
        .invoices.filter(
          (i) =>
            i.clinicId === a.clinic.id &&
            seesInvoice(db(), a, i) &&
            (!q.branchId || i.branchId === q.branchId) &&
            (!q.patientId || i.patientId === q.patientId) &&
            (!q.status || i.status === q.status) &&
            (!q.settlement || settlementOf(db(), i)?.state === q.settlement) &&
            matchesSource(i) &&
            (!q.number || i.number.includes(q.number.toUpperCase())) &&
            (!q.from || day(i.issuedAt) >= q.from) &&
            (!q.to || day(i.issuedAt) <= q.to),
        )
        .sort((x, y) => y.issuedAt.localeCompare(x.issuedAt) || y.id.localeCompare(x.id));
      const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
      const page = rows.slice(start, start + q.limit);
      const more = start + q.limit < rows.length;
      return {
        items: page.map((i) => {
          const { lines: _l, ...item } = strip(db(), i);
          // As the API's patients port: a name read, not a file open, so no patient-access row.
          return (void _l, { ...item, patientName: patientNameOf(a.clinic.id, i.patientId) });
        }),
        nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
        total: rows.length,
      };
    },
    // The detail alone carries the name, read here so the page writes no patient-access row.
    getInvoice: async (p, id) => {
      await delay();
      const invoice = visibleInvoice(p, id);
      const patient = db().patients.find(
        (x) => x.clinicId === invoice.clinicId && x.id === invoice.patientId,
      );
      return { ...strip(db(), invoice), ...(patient ? { patientName: patient.fullName } : {}) };
    },
    draft: async (p, source, id) => (
      await delay(),
      draftOf(db(), guardFinance(db(), p), source, id)
    ),
    issue: (p, input, key) =>
      write(() => issueInvoice(db(), guardFinance(db(), p), input, key, new Date())),
    edit: (p, id, version, input) =>
      write(() => editInvoice(db(), guardFinance(db(), p), id, version, input)),
    voidInvoice: (p, id, version, reason) =>
      write(() => voidInvoice(db(), guardFinance(db(), p), id, version, { reason }, new Date())),
    async pdf(persona, id) {
      await delay();
      const file = renderInvoicePdf(strip(db(), visibleInvoice(persona, id)));
      // As the API: one `invoice.pdf_opened` row, only once the file exists, with no snapshot.
      const a = viewer(persona);
      writeClinicAudit(db(), {
        clinicId: a.clinic.id,
        actorName: a.actorName,
        action: "invoice.pdf_opened",
        entity: "invoice",
        entityId: id,
        before: null,
        after: null,
      });
      persist();
      return file;
    },
    send: (persona, id, raw) =>
      write(() => {
        const invoice = visibleInvoice(persona, id);
        const body = parse(sendInvoiceRequestSchema, raw);
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
        // As the API: a retried press answers first even after a void; only a new press is refused.
        if (invoice.status === "void") throw new ApiError("invoice_void");
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
        if (
          body.currency &&
          body.currency !== f.currency &&
          (clinicHasInvoice(db(), clinicId) || clinicHasPrice(db(), clinicId))
        ) {
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
      const { timezone } = clinicOf(clinicId);
      return platformTotalsOf(db(), clinicId, timezone);
    },
  };
}
