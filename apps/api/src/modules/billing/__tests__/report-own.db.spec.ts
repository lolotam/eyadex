import { randomUUID } from "node:crypto";

import { invoiceListResponseSchema, invoiceSchema } from "@eyadex/contracts/finance";
import { reportOwnSummaryResponseSchema } from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP, call, closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { namedPatient, serviceAppointment } from "./billing-fixtures.ts";
import { voidInvoice } from "./money-fixtures.ts";
import {
  expectForbidden,
  foreignInvoice,
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  RANGE,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
const visible: string[] = [];
const hidden: string[] = [];
const service = (price: string, provider = f.C.doctor.memberId) => ({
  kind: "service",
  serviceId: f.C.serviceId,
  providerId: provider,
  quantity: 1,
  unitPriceMinor: price,
  discount: null,
});

beforeAll(async () => {
  f = await reportFixture();
  const { h, C } = f;
  await h.owner`UPDATE clinics SET tax_rate_bp = 1000 WHERE id = ${C.clinicId}`;
  await h.owner`UPDATE clinic_services SET price_minor = 1000 WHERE id = ${C.serviceId}`;
  await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
    status, started_at, created_at, updated_at) VALUES (${C.clinicId}, ${randomUUID()}, ${C.branchD},
    ${f.patientD}, ${C.doctor.memberId}, 'draft', now(), now(), now())`;
  const first = await issueReportInvoice(f, f.patientD, C.branchD, [
    service("1000"),
    service("500", C.doctorB.memberId),
    reportFreeLine("200"),
  ]);
  visible.push(first.id);
  const edited = await call(h, {
    host: APP,
    cookie: C.admin.cookie,
    method: "PATCH",
    url: `/v1/invoices/${first.id}`,
    headers: { "if-match": '"1"' },
    body: {
      lines: [service("600"), service("500", C.doctorB.memberId), reportFreeLine("200")],
      invoiceDiscount: null,
    },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  visible.push(
    (await issueReportInvoice(f, f.patientD, C.branchR, [service("2000")], null, "2026-07-15")).id,
  );
  // An invoice in the doctor's patient reach can contain only somebody else's billed lines.
  visible.push(
    (await issueReportInvoice(f, f.patientD, C.branchD, [service("501", C.doctorB.memberId)])).id,
  );
  await serviceAppointment(h, C, f.patientR, "10:00");
  visible.push(
    (await issueReportInvoice(f, f.patientR, C.branchR, [service("3000")], null, "2026-08-15")).id,
  );
  const cancelled = await namedPatient(h, C, C.branchD, "موعد ملغي فقط");
  await serviceAppointment(h, C, cancelled, "11:00", "cancelled");
  hidden.push((await issueReportInvoice(f, cancelled, C.branchD, [service("9000")])).id);
  const otherPatient = await namedPatient(h, C, C.branchD, "مراجع دكتور آخر");
  await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
    status, started_at, created_at, updated_at) VALUES (${C.clinicId}, ${randomUUID()}, ${C.branchD},
    ${otherPatient}, ${C.doctorB.memberId}, 'draft', now(), now(), now())`;
  hidden.push((await issueReportInvoice(f, otherPatient, C.branchD, [service("8000")])).id);
  const voided = await issueReportInvoice(f, f.patientD, C.branchD, [service("7000")]);
  expect((await voidInvoice(h, C.admin.cookie, voided.id)).statusCode).toBe(200);
  hidden.push(voided.id);
  hidden.push(
    (await issueReportInvoice(f, f.patientD, C.branchD, [service("6000")], null, "2025-12-31")).id,
  );
  await foreignInvoice(f);
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R10 doctor's own billed lines", () => {
  it("uses exactly the issued invoice-list reach, but only the doctor's live lines count", async () => {
    const listed = await send(
      f.h,
      f.C.doctor.cookie,
      "GET",
      `/v1/invoices?${RANGE}&status=issued&limit=100`,
    );
    expect(listed.statusCode, listed.body).toBe(200);
    const invoices = invoiceListResponseSchema.parse(listed.json());
    expect(invoices.items.map((row) => row.id).sort()).toEqual([...visible].sort());
    expect(invoices.items.every((row) => !hidden.includes(row.id))).toBe(true);
    let ownBilled = 0n;
    for (const row of invoices.items) {
      const detail = await send(f.h, f.C.doctor.cookie, "GET", `/v1/invoices/${row.id}`);
      expect(detail.statusCode, detail.body).toBe(200);
      const invoice = invoiceSchema.parse((detail.json() as { invoice: unknown }).invoice);
      ownBilled += invoice.lines
        .filter((line) => line.providerId === f.C.doctor.memberId)
        .reduce((sum, line) => sum + BigInt(line.lineTotalMinor), 0n);
    }
    const res = await f.get("own-summary", f.C.doctor.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const report = reportOwnSummaryResponseSchema.parse(res.json());
    expect(report.rows).toEqual([
      { period: "2026-06", billedMinor: "600", currency: "KWD" },
      { period: "2026-07", billedMinor: "2000", currency: "KWD" },
      { period: "2026-08", billedMinor: "3000", currency: "KWD" },
    ]);
    expect(report.totals.billedMinor).toBe("5600");
    expect(report.totals.billedMinor).toBe(ownBilled.toString());
  });

  it("own reach crosses the member's branches and the optional branch filter only narrows it", async () => {
    const res = await f.get("own-summary", f.C.doctor.cookie, `branchId=${f.C.branchR}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(reportOwnSummaryResponseSchema.parse(res.json()).totals.billedMinor).toBe("5000");
    await expectForbidden(f, "own-summary", f.C.doctor.cookie, `branchId=${f.other.branchD}`);
    await expectForbidden(f, "outstanding", f.C.doctor.cookie);
  });

  it.each([
    {
      timezone: "Asia/Kuwait",
      day: "2026-06-15",
      instants: [
        ["2026-06-14T20:59:59.999Z", "0"],
        ["2026-06-14T21:00:00Z", "600"],
        ["2026-06-15T20:59:59.999Z", "600"],
        ["2026-06-15T21:00:00Z", "0"],
      ],
    },
    {
      timezone: "America/Havana",
      day: "2026-11-01",
      instants: [
        ["2026-11-01T03:59:59.999Z", "0"],
        ["2026-11-01T04:00:00Z", "600"],
        ["2026-11-01T04:30:00Z", "600"],
        ["2026-11-01T05:00:00Z", "600"],
        ["2026-11-01T05:30:00Z", "600"],
        ["2026-11-02T04:59:59.999Z", "600"],
        ["2026-11-02T05:00:00Z", "0"],
      ],
    },
    {
      timezone: "America/Havana",
      day: "2026-10-31",
      instants: [
        ["2026-10-31T04:00:00Z", "600"],
        ["2026-11-01T03:59:59.999Z", "600"],
        ["2026-11-01T04:00:00Z", "0"],
        ["2026-11-01T04:30:00Z", "0"],
        ["2026-11-01T05:00:00Z", "0"],
      ],
    },
    {
      timezone: "America/Havana",
      day: "2026-03-08",
      instants: [
        ["2026-03-08T04:59:59.999Z", "0"],
        ["2026-03-08T05:00:00Z", "600"],
        ["2026-03-09T03:59:59.999Z", "600"],
        ["2026-03-09T04:00:00Z", "0"],
      ],
    },
  ])(
    "keeps the exact clinic day $day in $timezone across clock changes",
    async ({ timezone, day, instants }) => {
      const { h, C } = f;
      const invoiceId = visible[0]!;
      const [original] = await h.owner<
        { issued_at: string }[]
      >`SELECT issued_at::text AS issued_at FROM invoices
      WHERE clinic_id = ${C.clinicId} AND id = ${invoiceId}`;
      const [clinic] = await h.owner<{ timezone: string }[]>`SELECT timezone FROM clinics
      WHERE id = ${C.clinicId}`;
      try {
        await h.owner`UPDATE clinics SET timezone = ${timezone} WHERE id = ${C.clinicId}`;
        await f.invalidate.clinicChanged(C.clinicId);
        for (const [instant, expected] of instants) {
          await h.owner`UPDATE invoices SET issued_at = ${instant!}::timestamptz
          WHERE clinic_id = ${C.clinicId} AND id = ${invoiceId}`;
          const res = await f.get("own-summary", C.doctor.cookie, "", `from=${day}&to=${day}`);
          expect(res.statusCode, res.body).toBe(200);
          expect(reportOwnSummaryResponseSchema.parse(res.json()).totals.billedMinor).toBe(
            expected,
          );
        }
      } finally {
        await h.owner`UPDATE invoices SET issued_at = ${original!.issued_at}::timestamptz
        WHERE clinic_id = ${C.clinicId} AND id = ${invoiceId}`;
        await h.owner`UPDATE clinics SET timezone = ${clinic!.timezone} WHERE id = ${C.clinicId}`;
        await f.invalidate.clinicChanged(C.clinicId);
      }
    },
  );

  it("clinic and branch report keys never open R10, and wider invoices keys never stand in for own", async () => {
    await expectForbidden(f, "own-summary", f.C.admin.cookie);
    await expectForbidden(f, "own-summary", f.branch.cookie);
    for (const scope of ["branch", "clinic"] as const) {
      const viewer = await memberOn(
        f.h,
        f.C.admin,
        await customRole(f.h, f.C.clinicId, ["view:report_own:own", `view:invoices:${scope}`]),
      );
      await f.invalidate.clinicChanged(f.C.clinicId);
      await expectForbidden(f, "own-summary", viewer.cookie);
    }
  });
});
