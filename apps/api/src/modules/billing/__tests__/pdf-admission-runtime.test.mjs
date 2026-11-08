// Runs against a dedicated migrated database. The application uses a real LOGIN app role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, DatabaseError } from "@eyadex/db";
import { fixture } from "./pdf-admission-fixtures.mjs";
import { admitPdf } from "../../../../dist/modules/billing/persistence/pg-pdf-admission.js";
import { RequestInvoicePdf } from "../../../../dist/modules/billing/use-cases/request-invoice-pdf/request-invoice-pdf.js";
import { PgBillingPatients } from "../../../../dist/modules/patients/persistence/pg-billing-patients.js";
import { PgPdfPatientRevision } from "../../../../dist/modules/patients/persistence/pg-pdf-patient-revision.js";
import { PgPdfHeaderRevisions } from "../../../../dist/modules/tenancy/persistence/pg-pdf-header-revisions.js";
import { PgBillingExportAccess } from "../../../../dist/modules/identity/persistence/pg-billing-export-access.js";

test("actual guarded admission: identity, isolation, coalescing, saturation and rollback", async () => {
  const { owner, db, clinics } = await fixture();
  const c = clinics[0];
  const actor = {
    clinicId: c.id,
    membershipId: c.id,
    userId: c.id,
    permissions: [],
    member: { all: true },
  };
  const request = new RequestInvoicePdf({
    access: new PgBillingExportAccess(),
    patients: new PgBillingPatients(),
    patientRevision: new PgPdfPatientRevision(),
    headerRevisions: new PgPdfHeaderRevisions(),
    rendererRevision: "test-v1",
    clock: { now: () => new Date() },
    ids: { newId: randomUUID },
  });
  const run = (invoice = c.invoices[0]) =>
    db.withTenant(c.id, (tx) => request.request(tx, actor, invoice));
  const admit = (clinic, invoice, extra = {}) =>
    db.withTenant(clinic.id, (tx) =>
      admitPdf(tx, {
        clinicId: clinic.id,
        invoiceId: invoice,
        version: 1,
        revision: "test-v1:1:1:1",
        jobId: randomUUID(),
        ...extra,
      }),
    );
  const count = async () => {
    const [r] = await owner`SELECT admitted,(SELECT count(*)::int FROM invoice_pdf_jobs
      WHERE status IN ('queued','running','retry_wait')) AS actual FROM invoice_pdf_capacity`;
    assert.equal(r.admitted, r.actual);
    return r.admitted;
  };
  try {
    assert.equal(
      (await db.withTenant(c.id, (tx) => tx.execute(sql`SELECT current_user`)))[0].current_user,
      "eyadex_app",
    );
    for (const [block, restore, code] of [
      [
        owner`UPDATE memberships SET status='deactivated' WHERE clinic_id=${c.id}`,
        owner`UPDATE memberships SET status='active' WHERE clinic_id=${c.id}`,
        "account_disabled",
      ],
      [
        owner`UPDATE clinic_features SET enabled=false WHERE clinic_id=${c.id} AND module='finance'`,
        owner`UPDATE clinic_features SET enabled=true WHERE clinic_id=${c.id} AND module='finance'`,
        "module_disabled",
      ],
      [
        owner`UPDATE roles SET is_active=false WHERE clinic_id=${c.id} AND id=${c.id}`,
        owner`UPDATE roles SET is_active=true WHERE clinic_id=${c.id} AND id=${c.id}`,
        "forbidden",
      ],
      [
        owner`UPDATE clinics SET status='suspended' WHERE id=${c.id}`,
        owner`UPDATE clinics SET status='active' WHERE id=${c.id}`,
        "subscription_blocked",
      ],
    ]) {
      await block;
      await assert.rejects(run(), (e) => e.code === code);
      await restore;
    }
    await assert.rejects(run(clinics[1].invoices[0]), (e) => e.code === "not_found");
    await owner`DELETE FROM role_permissions WHERE clinic_id=${c.id} AND role_id=${c.id}`;
    await assert.rejects(run(), (e) => e.code === "forbidden");
    await owner`UPDATE memberships SET all_branches=false WHERE clinic_id=${c.id}`;
    for (const scope of ["branch", "own"]) {
      await owner`INSERT INTO role_permissions (clinic_id,id,role_id,permission_id,created_at)
        SELECT ${c.id},${randomUUID()},${c.id},id,now() FROM permissions WHERE key=${`view:invoices:${scope}`}`;
      await assert.rejects(run(), (e) => e.code === "not_found");
      await owner`DELETE FROM role_permissions WHERE clinic_id=${c.id} AND role_id=${c.id}`;
    }
    await owner`INSERT INTO role_permissions (clinic_id,id,role_id,permission_id,created_at)
      SELECT ${c.id},${randomUUID()},${c.id},id,now() FROM permissions WHERE key='view:invoices:clinic'`;
    await owner`UPDATE memberships SET all_branches=true WHERE clinic_id=${c.id}`;
    const same = await Promise.all(Array.from({ length: 8 }, () => run()));
    assert.equal(new Set(same.map((r) => r.jobId)).size, 1);
    assert.equal(await count(), 1);
    for (const query of [
      owner`UPDATE patients SET full_name='changed' WHERE clinic_id=${c.id}`,
      owner`UPDATE branches SET name_en='changed' WHERE clinic_id=${c.id}`,
      owner`UPDATE clinics SET name_en='changed' WHERE id=${c.id}`,
    ]) {
      await query;
      assert.equal((await run()).status, "admitted");
      assert.equal(await count(), 1);
    }
    const [old] =
      await owner`SELECT id FROM invoice_pdf_jobs WHERE clinic_id=${c.id} AND status='queued'`;
    await db.withTenant(c.id, (tx) =>
      tx.execute(sql`UPDATE invoice_pdf_jobs SET status='running',
      attempt=1,fence=1,lease_token=${randomUUID()},lease_until=clock_timestamp()+interval '30 seconds',
      deadline_at=clock_timestamp()+interval '60 seconds' WHERE clinic_id=${c.id} AND id=${old.id}`),
    );
    await owner`UPDATE invoices SET version=version+1 WHERE clinic_id=${c.id} AND id=${c.invoices[0]}`;
    assert.equal((await run()).status, "admitted");
    const [retired] =
      await owner`SELECT status,fence::text,lease_token FROM invoice_pdf_jobs WHERE id=${old.id}`;
    assert.deepEqual(retired, { status: "superseded", fence: "2", lease_token: null });
    const [current] = await owner`SELECT invoice_version,render_revision FROM invoice_pdf_jobs
      WHERE clinic_id=${c.id} AND status='queued'`;
    assert.equal(current.invoice_version, 2);
    assert.equal(current.render_revision, "test-v1:2:2:2");
    const [retry] =
      await owner`SELECT id FROM invoice_pdf_jobs WHERE clinic_id=${c.id} AND status='queued'`;
    await db.withTenant(c.id, async (tx) => {
      await tx.execute(sql`UPDATE invoice_pdf_jobs SET status='running',attempt=1,fence=1,
        lease_token=${randomUUID()},lease_until=clock_timestamp()+interval '30 seconds',
        deadline_at=clock_timestamp()+interval '60 seconds' WHERE id=${retry.id}`);
      await tx.execute(sql`UPDATE invoice_pdf_jobs SET status='retry_wait',retry_count=1,
        lease_token=NULL,lease_until=NULL,deadline_at=NULL,next_attempt_at=clock_timestamp()+interval '30 seconds'
        WHERE id=${retry.id}`);
    });
    assert.equal((await run()).jobId, retry.id);
    await owner`UPDATE patients SET full_name='newest' WHERE clinic_id=${c.id}`;
    assert.equal((await run()).status, "admitted");
    assert.equal(
      (await owner`SELECT status FROM invoice_pdf_jobs WHERE id=${retry.id}`)[0].status,
      "superseded",
    );
    assert.equal(await count(), 1);
    await assert.rejects(
      db.withTenant(c.id, (tx) =>
        tx.execute(sql`UPDATE invoice_pdf_jobs SET status='running',
      clinic_slot=2,lease_token=${randomUUID()},lease_until=clock_timestamp()+interval '30 seconds',
      deadline_at=clock_timestamp()+interval '60 seconds' WHERE id=${old.id}`),
      ),
      DatabaseError,
    );
    const beforeRollback = await count();
    await assert.rejects(
      db.withTenant(c.id, async (tx) => {
        await admitPdf(tx, {
          clinicId: c.id,
          invoiceId: c.invoices[1],
          version: 1,
          revision: "test-v1:1:1:1",
          jobId: randomUUID(),
        });
        throw new Error("rollback-proof");
      }),
      /rollback-proof/,
    );
    assert.equal(await count(), beforeRollback);
    for (let i = 1; i < 10; i++) assert.equal((await admit(c, c.invoices[i])).status, "admitted");
    assert.equal((await admit(c, c.invoices[10])).status, "saturated");
    for (const clinic of clinics.slice(1, 10))
      for (const invoice of clinic.invoices.slice(0, 10))
        assert.equal((await admit(clinic, invoice)).status, "admitted");
    assert.equal(await count(), 100);
    const last = clinics[10];
    await db.withTenant(last.id, async (tx) => {
      await tx.execute(
        sql`UPDATE invoices SET version=2 WHERE clinic_id=${last.id} AND id=${last.invoices[0]}`,
      );
      assert.equal(
        (
          await admitPdf(tx, {
            clinicId: last.id,
            invoiceId: last.invoices[0],
            version: 2,
            revision: "test-v1:1:1:1",
            jobId: randomUUID(),
          })
        ).status,
        "saturated",
      );
      await tx.execute(
        sql`UPDATE invoices SET version=3 WHERE clinic_id=${last.id} AND id=${last.invoices[0]}`,
      );
    });
    assert.equal(
      (await owner`SELECT version FROM invoices WHERE id=${last.invoices[0]}`)[0].version,
      3,
    );
    assert.equal(await count(), 100);
    await db.withTenant(c.id, (tx) =>
      tx.execute(sql`UPDATE invoice_pdf_jobs SET status='failed',clinic_slot=NULL
      WHERE clinic_id=${c.id} AND invoice_id=${c.invoices[1]}`),
    );
    assert.equal(await count(), 99);
    assert.equal((await admit(last, last.invoices[0], { version: 3 })).status, "admitted");
    await assert.rejects(
      admit(last, randomUUID()),
      (e) =>
        e instanceof DatabaseError &&
        e.code === "23503" &&
        !e.cause &&
        !e.message.includes("INSERT"),
    );
    assert.equal(await count(), 100);
    assert.equal(
      (await owner`SELECT count(*)::int AS n FROM audit_log WHERE action='invoice.pdf_opened'`)[0]
        .n,
      0,
    );
  } finally {
    await db.close();
    await owner.end();
  }
});
