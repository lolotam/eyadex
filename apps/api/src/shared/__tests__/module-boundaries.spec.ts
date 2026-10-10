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
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/g)]
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
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !APPOINTMENTS_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );

describe("module boundaries", () => {
  it("the appointments module's SQL names only its own tables; the rest comes through its ports", () => {
    expect(existsSync(join(modulesDir, "appointments", "appointments.module.ts"))).toBe(true);
    expect(appointmentsSqlRelations()).toEqual([]);
  });

  it("appointments reaches patients only through patients/index.ts, bound in its module file", () => {
    expect(patientsImports()).toEqual([]);
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
