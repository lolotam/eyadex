import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// apps/api/AGENTS.md: a Pg adapter is bound in `<module>.module.ts` and injected through its port, so
// the HTTP layer depends on ports only and every cross-module read is wired in one place.
const modulesDir = fileURLToPath(new URL("../../modules/", import.meta.url));

const adapterUses = (module: string): string[] => {
  const httpDir = join(modulesDir, module, "http");
  return readdirSync(httpDir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(httpDir, file), "utf8");
      const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap(
        ([, names = ""]) => [...names.matchAll(/\bPg[A-Z]\w*/g)].map(([name]) => name),
      );
      const built = [...source.matchAll(/\bnew (Pg[A-Z]\w*)/g)].map(([, name = ""]) => name);
      return [...new Set([...imports, ...built])].map((name) => `${module}/http/${file}: ${name}`);
    });
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Test fixtures may share identity's HTTP harness; the rule is about the code that ships.
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

// CLAUDE.architecture.md §2.2 (ADR-0014, owner decision 2026-10-07): outside identity, the only import of
// identity is its index.ts (guards and request types).
const identityDeepImports = (module: string): string[] =>
  sourceFiles(join(modulesDir, module)).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/identity\/[^"']*)["']/g)]
      .map(([, target = ""]) => target)
      .filter((target) => !/\/identity\/index\.ts$/.test(target))
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );

// Every relation scan below reads a name as a letter or underscore, then letters, digits or underscores
// (icd10_codes, 0047), so a table with a digit is never cut short.
// apps/api/AGENTS.md: the audit module reads the audit relations only (0011, 0012, 0013, 0034); names
// from memberships and roles (identity), branches and clinics (tenancy) come through its ports.
const AUDIT_RELATIONS = [
  "audit_log",
  "platform_audit_actors",
  "platform_audit_log",
  "platform_clinic_admin_audit",
];
const auditSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "audit")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !AUDIT_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );

// ADR-0026: the appointments module names only its own tables; members come through ProviderDirectory
// (identity), branches through SchedulingBranchReader (tenancy) and patients' files through
// BookingPatientReader (patients, A2).
const APPOINTMENTS_RELATIONS = [
  "clinic_services",
  "provider_schedules",
  "provider_time_off",
  "appointments",
];

// ADR-0026 §11: appointments imports patients only through patients/index.ts, and only in its module
// file (the adapter binding); nothing else in patients is reachable.
const patientsImports = (): string[] =>
  sourceFiles(join(modulesDir, "appointments")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/patients\/[^"']*)["']/g)]
      .map(([, target = ""]) => target)
      .filter(
        (target) =>
          !(/\/patients\/index\.ts$/.test(target) && file.endsWith("appointments.module.ts")),
      )
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );
const appointmentsSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "appointments")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !APPOINTMENTS_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );

// ADR-0026 A3: the patients module names its own relations (the files, the file-number counter and the
// jsonb set function its scope filter reads; idempotency and audit go through shared/), plus
// `appointments` read-only in the one `own` predicate of queries/own-patients.ts. A port implemented by
// appointments would close an import cycle (appointments already binds patients' PgBookingPatients).
const PATIENTS_RELATIONS = ["patients", "clinic_counters", "jsonb_array_elements_text"];
const OWN_PREDICATE_FILE = join("patients", "queries", "own-patients.ts");
// P2 (ADR-0029): the same predicate reads `visits` (own = an appointment or a visit with the caller).
const OWN_PREDICATE_RELATIONS = ["appointments", "visits"];

// ADR-0029: the medical module names only its own tables (and the jsonb set function its batch reads use;
// audit rows go through shared/); patients, appointments, members, branches and the clinic's names come
// through its ports, bound in medical.module.ts to the adapters their owners export from index.ts.
const MEDICAL_RELATIONS = [
  "visits",
  "visit_notes",
  "visit_addenda",
  "patient_medical_profiles",
  "visit_diagnoses",
  "visit_prescription_items",
  "clinic_medicines",
  "icd10_codes",
  "patient_attachments",
  "jsonb_array_elements_text",
];
const medicalSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "medical")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !MEDICAL_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );
const medicalOwnerImports = (): string[] =>
  sourceFiles(join(modulesDir, "medical")).flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /from\s+["']([^"']*\/(?:patients|appointments)\/[^"']*)["']/g,
      ),
    ]
      .map(([, target = ""]) => target)
      .filter(
        (target) =>
          !(
            /\/(?:patients|appointments)\/index\.ts$/.test(target) &&
            file.endsWith("medical.module.ts")
          ),
      )
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );
const importsOfMedical = (module: string): string[] =>
  sourceFiles(join(modulesDir, module)).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/medical\/[^"']*)["']/g)].map(
      ([, target = ""]) => `${file.slice(modulesDir.length)}: ${target}`,
    ),
  );
// Finance F1 and F2 (plan Task 8): billing names its own tables, the price column of clinic_services, and
// branches and clinics for the invoice prefix and the currency; patients, appointments, visits and members
// come through its ports, bound in billing.module.ts to the adapters their owners export from index.ts.
const BILLING_RELATIONS = [
  "clinic_services",
  "service_provider_prices",
  "invoices",
  "invoice_lines",
  "invoice_sequences",
  "used_invoice_prefixes",
  "invoice_links",
  // 0062: the patient link lookup, SECURITY DEFINER over invoice_links.
  "invoice_link_lookup",
  // Finance F2 (0064): the payment tables billing owns (spec §4.2).
  "clinic_payment_methods",
  "receipt_sequences",
  "payments",
  "payment_allocations",
  "patient_credits",
  "refunds",
  "refund_sources",
  "branch_cash_drawers",
  // Finance F2 slice 5: the daily cash closings.
  "cash_closings",
  // The jsonb set function its id lists read.
  "jsonb_array_elements_text",
  "branches",
  "clinics",
];
const billingSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "billing")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !BILLING_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );
const billingOwnerImports = (): string[] =>
  sourceFiles(join(modulesDir, "billing")).flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /from\s+["']([^"']*\/(?:patients|appointments|medical|notifications)\/[^"']*)["']/g,
      ),
    ]
      .map(([, target = ""]) => target)
      .filter(
        (target) =>
          !(
            /\/(?:patients|appointments|medical|notifications)\/index\.ts$/.test(target) &&
            file.endsWith("billing.module.ts")
          ),
      )
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );
// ADR-0031: the notifications module names only its three tables (N2 added the WhatsApp channel; the
// outbox goes through shared/); appointments and medical reach it only through notifications/index.ts,
// bound in their module file.
const NOTIFICATIONS_RELATIONS = [
  "clinic_notification_settings",
  "patient_notifications",
  "clinic_whatsapp_channels",
];
const notificationsSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "notifications")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !NOTIFICATIONS_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );
const notificationsImports = (module: string): string[] =>
  sourceFiles(join(modulesDir, module)).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/notifications\/[^"']*)["']/g)]
      .map(([, target = ""]) => target)
      .filter(
        (target) =>
          !(/\/notifications\/index\.ts$/.test(target) && file.endsWith(`${module}.module.ts`)),
      )
      .map((target) => `${file.slice(modulesDir.length)}: ${target}`),
  );
const patientsSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "patients")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)]
      .map(([, relation = ""]) => relation)
      .filter(
        (relation) =>
          !PATIENTS_RELATIONS.includes(relation) &&
          !(OWN_PREDICATE_RELATIONS.includes(relation) && file.endsWith(OWN_PREDICATE_FILE)),
      )
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );

describe("module boundaries", () => {
  it("the patients module's SQL names its own relations, and appointments and visits only in the own predicate", () => {
    expect(existsSync(join(modulesDir, OWN_PREDICATE_FILE))).toBe(true);
    expect(patientsSqlRelations()).toEqual([]);
  });

  it("the patients module imports nothing of appointments", () => {
    const imports = sourceFiles(join(modulesDir, "patients")).flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']*\/appointments\/[^"']*)["']/g),
      ].map(([, target = ""]) => `${file.slice(modulesDir.length)}: ${target}`),
    );
    expect(imports).toEqual([]);
  });

  it("the appointments module's SQL names only its own tables; the rest comes through its ports", () => {
    expect(existsSync(join(modulesDir, "appointments", "appointments.module.ts"))).toBe(true);
    expect(appointmentsSqlRelations()).toEqual([]);
  });

  it("appointments reaches patients only through patients/index.ts, bound in its module file", () => {
    expect(patientsImports()).toEqual([]);
  });

  it("the medical module's SQL names only its own tables; the rest comes through its ports", () => {
    expect(existsSync(join(modulesDir, "medical", "medical.module.ts"))).toBe(true);
    expect(medicalSqlRelations()).toEqual([]);
  });

  it("medical reaches patients and appointments only through their index.ts, bound in its module file", () => {
    expect(medicalOwnerImports()).toEqual([]);
  });

  it("the billing module's SQL names only its own tables; the rest comes through its ports", () => {
    expect(existsSync(join(modulesDir, "billing", "billing.module.ts"))).toBe(true);
    expect(billingSqlRelations()).toEqual([]);
  });

  it("billing reaches patients, appointments, medical and notifications only through their index.ts", () => {
    expect(billingOwnerImports()).toEqual([]);
  });

  it("patients and appointments import nothing of medical (its adapters live with their owners)", () => {
    expect([...importsOfMedical("patients"), ...importsOfMedical("appointments")]).toEqual([]);
  });

  it("the notifications module's SQL names only its own three tables", () => {
    expect(existsSync(join(modulesDir, "notifications", "notifications.module.ts"))).toBe(true);
    expect(notificationsSqlRelations()).toEqual([]);
  });

  it("appointments and medical reach notifications only through its index.ts, bound in their module file", () => {
    expect([...notificationsImports("appointments"), ...notificationsImports("medical")]).toEqual(
      [],
    );
  });

  it("the audit module's SQL names only the audit relations; other tables come through its ports", () => {
    expect(auditSqlRelations()).toEqual([]);
  });

  it("no module other than identity imports identity except through identity/index.ts", () => {
    const others = readdirSync(modulesDir).filter((name) => name !== "identity");
    expect(others).toEqual(expect.arrayContaining(["platform", "settings", "tenancy"]));
    expect(others.flatMap(identityDeepImports)).toEqual([]);
  });

  it("no controller imports or builds a Pg adapter; the module binds it and injects the port", () => {
    const modules = readdirSync(modulesDir).filter((name) =>
      existsSync(join(modulesDir, name, "http")),
    );
    expect(modules).toEqual(expect.arrayContaining(["identity", "platform", "settings"]));
    expect(modules.flatMap(adapterUses)).toEqual([]);
  });
});
