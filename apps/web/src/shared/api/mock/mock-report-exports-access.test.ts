import { expect, it } from "vitest";
import { setup, blobBytes } from "./mock-report-exports.test-kit";
import { getState, resetMockData } from "./mock-store";
import { EXPORT_LIFETIME_MS } from "./mock-report-export-run";
import { invoice, payment } from "./mock-report-export.test-kit";

type Fixture = ReturnType<typeof setup>;
const revoke: Record<string, { code: string; apply: (f: Fixture) => void }> = {
  report: {
    code: "forbidden",
    apply: (f) => {
      f.role.permissions = ["view:payments:branch"];
    },
  },
  covering: {
    code: "forbidden",
    apply: (f) => {
      f.role.permissions = ["view:report_takings:branch"];
    },
  },
  branch: {
    code: "not_found",
    apply: (f) => {
      f.member.branchIds = [f.a.id, f.c.id];
    },
  },
  removedBranch: {
    code: "not_found",
    apply: (f) => {
      f.db.branches = f.db.branches.filter((b) => b.id !== f.b.id);
    },
  },
  account: {
    code: "account_disabled",
    apply: (f) => {
      f.member.status = "deactivated";
    },
  },
  role: {
    code: "account_disabled",
    apply: (f) => {
      f.role.isActive = false;
    },
  },
  missingRole: {
    code: "account_disabled",
    apply: (f) => {
      f.db.roles = f.db.roles.filter((r) => r.id !== f.role.id);
    },
  },
  suspended: {
    code: "subscription_blocked",
    apply: (f) => {
      const clinic = f.db.clinics.find((c) => c.id === f.ctx.clinicId);
      if (!clinic) throw new Error("clinic");
      clinic.status = "suspended";
    },
  },
  subscriptionBoundary: {
    code: "subscription_blocked",
    apply: (f) => {
      const clinic = f.db.clinics.find((c) => c.id === f.ctx.clinicId);
      if (!clinic) throw new Error("clinic");
      clinic.expiresAt = f.clock().toISOString();
    },
  },
  module: {
    code: "module_disabled",
    apply: (f) => {
      const features = f.db.features[f.ctx.clinicId];
      if (!features) throw new Error("features");
      features.finance = false;
    },
  },
};

it.each(Object.keys(revoke))(
  "download %s denied at first and final real Blob boundary without altering done/audit",
  async (key) => {
    for (const during of [false, true]) {
      const f = setup();
      const job = await f.finish();
      const bytes = job.artifact;
      const audit = structuredClone(f.db.clinicAudit);
      const denial = revoke[key];
      if (!denial) throw new Error("Missing denial");
      if (!during) denial.apply(f);
      const attempt = f.api.downloadExport(f.persona, job.id);
      if (during) {
        // Terminal cleanup yields once, then the actual Blob preparation yields a second time.
        await Promise.resolve();
        denial.apply(f);
      }
      await expect(attempt).rejects.toMatchObject({ code: denial.code });
      expect(job.status).toBe("done");
      expect(job.artifact).toBe(bytes);
      expect(f.db.clinicAudit).toStrictEqual(audit);
    }
  },
);

it.each(["account", "role", "missingRole", "suspended", "subscriptionBoundary", "module"])(
  "metadata guard %s wins malformed id/query and rechecks after advancement",
  async (key) => {
    for (const during of [false, true]) {
      const f = setup();
      const job = await f.request({ format: "xlsx" });
      const denial = revoke[key];
      if (!denial) throw new Error("denial");
      if (!during) {
        denial.apply(f);
        await expect(f.api.getExport(f.persona, "malformed")).rejects.toMatchObject({
          code: denial.code,
        });
        await expect(f.api.listExports(f.persona, { limit: -1 })).rejects.toMatchObject({
          code: denial.code,
        });
        await expect(f.api.downloadExport(f.persona, "malformed")).rejects.toMatchObject({
          code: denial.code,
        });
      } else {
        f.tick();
        await f.api.getExport(f.persona, job.id);
        f.tick();
        const work = f.api.listExports(f.persona, {});
        denial.apply(f);
        await expect(work).rejects.toMatchObject({ code: denial.code });
        expect(job.status).toBe("failed");
        expect(job.artifact).toBeNull();
        expect(f.db.clinicAudit.some((r) => r.entityId === job.id)).toBe(false);
      }
    }
  },
);

it.each([false, true])(
  "scope narrowing during=%s refuses whole frozen scope; widening never adds C",
  async (during) => {
    const f = setup();
    f.role.permissions = ["view:report_takings:clinic", "view:payments:clinic"];
    const job = await f.finish();
    const audit = structuredClone(f.db.clinicAudit);
    const narrow = () => {
      f.role.permissions = ["view:report_takings:branch", "view:payments:branch"];
    };
    if (!during) narrow();
    const work = f.api.downloadExport(f.persona, job.id);
    if (during) {
      await Promise.resolve();
      narrow();
    }
    await expect(work).rejects.toMatchObject({ code: "not_found" });
    expect(job.status).toBe("done");
    expect(f.db.clinicAudit).toStrictEqual(audit);
    const wide = setup();
    const invB = invoice(wide, 2, { branchId: wide.b.id });
    payment(wide, 2, invB);
    const invC = invoice(wide, 3, { branchId: wide.c.id });
    payment(wide, 3, invC);
    const frozen = await wide.request();
    wide.role.permissions = ["view:report_takings:clinic", "view:payments:clinic"];
    wide.tick();
    await wide.api.getExport(wide.persona, frozen.id);
    wide.tick();
    await wide.api.getExport(wide.persona, frozen.id);
    const text = new TextDecoder().decode(
      await blobBytes(await wide.api.downloadExport(wide.persona, frozen.id)),
    );
    expect(text).toContain("Branch A");
    expect(text).toContain("Branch B");
    expect(text).not.toContain("Branch C");
    expect(frozen.params.branchIds).toStrictEqual([wide.a.id, wide.b.id]);
  },
);

it.each([false, true])(
  "exact own contribution loss during=%s immediately purges, keeps ledger until original expiry and never resurrects",
  async (during) => {
    const f = setup(true);
    const job = await f.finish();
    expect(job.ownPatientIds).toStrictEqual([f.patient.id]);
    const expiry = job.expiresAt;
    const audit = structuredClone(f.db.clinicAudit);
    if (!during) f.appointment.status = "cancelled";
    const work = f.api.downloadExport(f.persona, job.id);
    if (during) {
      await Promise.resolve();
      f.appointment.status = "cancelled";
    }
    await expect(work).rejects.toMatchObject({ code: "not_found" });
    expect(job.status).toBe("purged");
    expect(job.artifact).toBeNull();
    expect(job.ownPatientIds).toStrictEqual([f.patient.id]);
    expect(job.expiresAt).toBe(expiry);
    f.appointment.status = "booked";
    await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
      code: "not_found",
    });
    f.tick(EXPORT_LIFETIME_MS - 1);
    expect((await f.api.getExport(f.persona, job.id)).export.status).toBe("purged");
    expect(job.ownPatientIds).toStrictEqual([f.patient.id]);
    f.tick(1);
    await f.api.listExports(f.persona, {});
    expect(job.ownPatientIds).toBeNull();
    expect(job.status).toBe("purged");
    expect(f.db.clinicAudit).toStrictEqual(audit);
  },
);

it("empty complete own ledger is valid; null is refused; replacement own key is forbidden without purge", async () => {
  const f = setup(true);
  f.db.appointments = [];
  const job = await f.finish();
  expect(job.rowCount).toBe(0);
  expect(job.ownPatientIds).toStrictEqual([]);
  expect((await f.api.downloadExport(f.persona, job.id)).size).toBeGreaterThan(0);
  job.ownPatientIds = null;
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(job.status).toBe("done");
  job.ownPatientIds = [];
  f.role.permissions = ["view:report_own:own", "view:invoices:clinic"];
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(job.status).toBe("done");
  expect(job.artifact).not.toBeNull();
});

it.each(["reset", "expiry", "purge", "replacement"])(
  "final download identity/status check catches %s across Blob preparation",
  async (kind) => {
    const f = setup();
    const job = await f.finish();
    const audit = structuredClone(f.db.clinicAudit);
    const work = f.api.downloadExport(f.persona, job.id);
    await Promise.resolve();
    if (kind === "reset") resetMockData();
    if (kind === "expiry") f.tick(EXPORT_LIFETIME_MS);
    if (kind === "purge") {
      job.status = "purged";
      job.artifact = null;
    }
    if (kind === "replacement") job.artifact = job.artifact?.slice() ?? null;
    await expect(work).rejects.toMatchObject({ code: "not_found" });
    if (kind === "reset") expect(getState()).not.toBe(f.db);
    if (kind === "expiry") {
      expect(job.status).toBe("expired");
      expect(job.artifact).toBeNull();
    }
    expect(f.db.clinicAudit).toStrictEqual(audit);
  },
);

it("downloads never progress unfinished work, and failed jobs stay visible without audit", async () => {
  const f = setup();
  const job = await f.request();
  const audit = structuredClone(f.db.clinicAudit);
  f.tick();
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(job.status).toBe("queued");
  await f.api.getExport(f.persona, job.id);
  f.tick();
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(job.status).toBe("running");
  f.role.permissions = [];
  expect((await f.api.getExport(f.persona, job.id)).export.status).toBe("failed");
  expect((await f.api.listExports(f.persona, {})).items[0]?.status).toBe("failed");
  await expect(f.api.downloadExport(f.persona, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(f.db.clinicAudit).toStrictEqual(audit);
});
