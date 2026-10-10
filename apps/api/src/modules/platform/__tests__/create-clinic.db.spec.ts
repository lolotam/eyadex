import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CreateClinicWithAdmin, CLOCK, FIRST_ADMIN_PROVISIONER } from "../../tenancy/index.ts";
import {
  APP,
  call,
  closeHarness,
  createUser,
  jar,
  openHarness,
  password,
  PLATFORM,
  setCookies,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { totpFromUri } from "../../identity/auth/__tests__/totp.ts";
import { joinPlatformTeam } from "./platform-staff.ts";
import { PLATFORM_DATABASE } from "../../../shared/platform-database.ts";
import { SecretSealer } from "@eyadex/secrets";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

// ONB-01 over HTTP on real PostgreSQL: one transaction, nothing behind on failure, no raw token.
let h: Harness;
let cookie: string;
let actorId: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  const user = await createUser(h, h.areaAuth.of("platform"), "onboarder");
  await joinPlatformTeam(h, user);
  actorId = user.userId;
  const signIn = await call(h, {
    url: "/auth/sign-in/email",
    host: PLATFORM,
    body: { email: user.email, password },
  });
  const pre = jar(setCookies(signIn));
  const enable = await call(h, {
    url: "/auth/two-factor/enable",
    host: PLATFORM,
    cookie: pre,
    body: { password },
  });
  const verify = await call(h, {
    url: "/auth/two-factor/verify-totp",
    host: PLATFORM,
    cookie: pre,
    body: { code: totpFromUri(enable.json().totpURI) },
  });
  expect(verify.statusCode).toBe(200);
  cookie = jar(setCookies(verify));
});

afterAll(async () => {
  await closeHarness(h);
});

const tag = () => randomUUID().slice(0, 8);
const body = (t = tag()) => ({
  nameAr: "عيادة تجربة",
  nameEn: "Test Clinic",
  slug: `onb-${t}`,
  specialty: "general",
  defaultLanguage: "ar",
  timezone: "Asia/Kuwait",
  status: "trial",
  expiresAt: "2099-01-01T00:00:00Z",
  maxUsers: 5,
  maxBranches: 2,
  modules: { patients: true, appointments: true, medical: false },
  admin: { fullName: "Test Admin", email: `admin-${t}@example.test` },
});
const create = (b: unknown, key: string | null = randomUUID(), host = PLATFORM, c = cookie) =>
  call(h, {
    url: "/v1/platform/clinics",
    host,
    cookie: c,
    body: b,
    headers: key === null ? {} : { "idempotency-key": key },
  });
const count = async (table: string, where: string, value: string) =>
  Number(
    (
      await h.owner.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where} = $1`, [value])
    )[0]?.["n"],
  );

describe("POST /v1/platform/clinics (ONB-01)", () => {
  it("D-9: writes one flag per module, each as the request sent it", async () => {
    const flags = async (clinicId: string) =>
      Object.fromEntries(
        (
          await h.owner`SELECT module, enabled FROM clinic_features WHERE clinic_id = ${clinicId}`
        ).map((r) => [r["module"], r["enabled"]]),
      );
    const off = await create({
      ...body(),
      modules: { patients: true, appointments: false, medical: false },
    });
    expect(off.statusCode).toBe(201);
    expect(await flags(off.json().clinicId)).toEqual({
      patients: true,
      appointments: false,
      medical: false,
    });
    const on = await create({
      ...body(),
      modules: { patients: false, appointments: true, medical: false },
    });
    expect(on.statusCode).toBe(201);
    expect(await flags(on.json().clinicId)).toEqual({
      patients: false,
      appointments: true,
      medical: false,
    });
  });

  it("writes clinic, roles, invitation (hash only), hold, audit and outbox together", async () => {
    const b = body();
    const res = await create(b);
    expect(res.statusCode).toBe(201);
    const { clinicId, invitation } = res.json();
    expect(await count("clinics", "id::text", clinicId)).toBe(1);
    expect(await count("roles", "clinic_id::text", clinicId)).toBe(4);
    expect(await count("clinic_features", "clinic_id::text", clinicId)).toBe(2);
    const [inv] = await h.owner`SELECT * FROM invitations WHERE id = ${invitation.id}`;
    expect(inv?.["token_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(inv?.["status"]).toBe("pending");
    const days =
      (new Date(inv!["expires_at"]).getTime() - new Date(inv!["created_at"]).getTime()) / 864e5;
    expect(days).toBe(7);
    expect(await count("email_reservations", "lower(email)", b.admin.email)).toBe(1);
    expect(await count("platform_audit_log", "clinic_id::text", clinicId)).toBe(1);
    const [event] = await h.owner`SELECT * FROM outbox_events WHERE clinic_id = ${clinicId}`;
    expect(event?.["event_type"]).toBe("clinic.admin_invited");
    expect(event?.["payload"].sealedToken).toEqual(expect.any(String));
  });

  it("NEGATIVE: the raw token is in no table, audit, outbox payload or log line", async () => {
    // Recover the raw token through the worker's own path: unseal the outbox payload.
    const res = await create(body());
    const { clinicId } = res.json();
    const [event] =
      await h.owner`SELECT id, payload FROM outbox_events WHERE clinic_id = ${clinicId}`;
    const sealer = new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!);
    const token = sealer.open(event!["payload"].sealedToken, event!["id"]);
    expect(token.length).toBeGreaterThan(30);
    const dump = await h.owner`
      SELECT (SELECT json_agg(i) FROM invitations i WHERE clinic_id = ${clinicId})::text
        || (SELECT json_agg(a) FROM platform_audit_log a WHERE clinic_id = ${clinicId})::text
        || (SELECT json_agg(o) FROM outbox_events o WHERE clinic_id = ${clinicId})::text
        || (SELECT json_agg(k) FROM idempotency_keys k)::text AS all`;
    expect(dump[0]!["all"]).not.toContain(token);
    expect(h.logs.join("\n")).not.toContain(token);
    expect(JSON.stringify(res.json())).not.toContain(token);
  });

  it("replays the same key + body and conflicts on a changed body", async () => {
    const b = body();
    const key = randomUUID();
    const first = await create(b, key);
    const again = await create(b, key);
    expect(again.statusCode).toBe(201);
    expect(again.json().clinicId).toBe(first.json().clinicId);
    expect(await count("clinics", "slug", b.slug)).toBe(1);
    const changed = await create({ ...b, nameEn: "Other" }, key);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe("idempotency_conflict");
  });

  it("NEGATIVE: reserved slug, taken slug and taken email write nothing", async () => {
    const reserved = await create({ ...body(), slug: "admin" });
    expect(reserved.json().code).toBe("reserved_slug");
    const first = body();
    await create(first);
    const slug = body();
    const takenSlug = await create({ ...slug, slug: first.slug });
    expect(takenSlug.json().code).toBe("slug_taken");
    expect(await count("email_reservations", "lower(email)", slug.admin.email)).toBe(0);
    const email = body();
    const takenEmail = await create({ ...email, admin: first.admin });
    expect(takenEmail.statusCode).toBe(409);
    expect(takenEmail.json().code).toBe("email_taken");
    expect(await count("clinics", "slug", email.slug)).toBe(0);
  });

  it("trialDays: the server ends the trial at local midnight on the injected clock", async () => {
    const clock = h.app.get<{ now: () => Date }>(CLOCK);
    const real = clock.now;
    clock.now = () => new Date("2031-01-31T22:00:00Z"); // already 1 February in Kuwait
    try {
      const { expiresAt: _drop, ...rest } = body();
      void _drop;
      const res = await create({ ...rest, trialDays: 14 });
      expect(res.statusCode).toBe(201);
      const [row] = await h.owner`SELECT expires_at FROM clinics WHERE id = ${res.json().clinicId}`;
      expect(new Date(row!["expires_at"]).toISOString()).toBe("2031-02-15T20:59:59.000Z");
    } finally {
      clock.now = real;
    }
  });

  it("NEGATIVE: both expiresAt and trialDays are 400 and write nothing", async () => {
    const both = body();
    expect((await create({ ...both, trialDays: 14 })).statusCode).toBe(400);
    expect(await count("clinics", "slug", both.slug)).toBe(0);
  });

  it("neither: the trial takes the platform's default trial days, read when the clinic is made", async () => {
    const clock = h.app.get<{ now: () => Date }>(CLOCK);
    const real = clock.now;
    clock.now = () => new Date("2031-01-31T22:00:00Z"); // already 1 February in Kuwait
    await h.owner`UPDATE platform_settings SET default_trial_days = 21`;
    try {
      const { expiresAt: _drop, ...neither } = body();
      void _drop;
      const res = await create(neither);
      expect(res.statusCode).toBe(201);
      const [row] = await h.owner`SELECT expires_at FROM clinics WHERE id = ${res.json().clinicId}`;
      expect(new Date(row!["expires_at"]).toISOString()).toBe("2031-02-22T20:59:59.000Z");
    } finally {
      clock.now = real;
      await h.owner`UPDATE platform_settings SET default_trial_days = 14`;
    }
  });

  it("limits and modules are the request's, never the platform defaults (ADR-0020 amendment)", async () => {
    await h.owner`UPDATE platform_settings SET default_max_users = 50, default_max_branches = 9,
      default_module_patients = false, default_module_appointments = false`;
    try {
      const b = {
        ...body(),
        maxUsers: 7,
        maxBranches: 4,
        modules: { patients: true, appointments: true, medical: false },
      };
      const res = await create(b);
      expect(res.statusCode).toBe(201);
      const { clinicId } = res.json();
      const [row] =
        await h.owner`SELECT max_users, max_branches FROM clinics WHERE id = ${clinicId}`;
      expect(row).toEqual({ max_users: 7, max_branches: 4 });
      const [feature] = await h.owner`SELECT enabled FROM clinic_features
        WHERE clinic_id = ${clinicId} AND module = 'patients'`;
      expect(feature?.["enabled"]).toBe(true);
      for (const field of ["maxUsers", "maxBranches", "modules"] as const) {
        const { [field]: _drop, ...missing } = body();
        void _drop;
        expect((await create(missing)).statusCode).toBe(400);
        expect(await count("clinics", "slug", missing.slug)).toBe(0);
      }
    } finally {
      await h.owner`UPDATE platform_settings SET default_max_users = 10, default_max_branches = 3,
        default_module_patients = true, default_module_appointments = true`;
    }
  });

  it("NEGATIVE: a missing Idempotency-Key is rejected", async () => {
    const b = body();
    const res = await create(b, null);
    expect(res.statusCode).toBe(400);
    expect(await count("clinics", "slug", b.slug)).toBe(0);
  });

  it("NEGATIVE: the clinic host answers 404 and an unverified platform session 403", async () => {
    expect((await create(body(), randomUUID(), APP)).statusCode).toBe(404);
    const user = await createUser(h, h.areaAuth.of("platform"), "no-totp");
    const signIn = await call(h, {
      url: "/auth/sign-in/email",
      host: PLATFORM,
      body: { email: user.email, password },
    });
    const res = await create(body(), randomUUID(), PLATFORM, jar(setCookies(signIn)));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("two_factor_required");
  });

  it("NEGATIVE: a failure after the clinic insert leaves nothing behind", async () => {
    const b = body();
    const failing = new CreateClinicWithAdmin({
      db: h.app.get<Database>(PLATFORM_DATABASE),
      clock: h.app.get(CLOCK),
      ids: systemUuidV7(),
      provisioner: {
        provision: async (tx, request) => {
          await h.app.get(FIRST_ADMIN_PROVISIONER).provision(tx, request);
          throw new Error("forced failure");
        },
      },
      sealer: new SecretSealer(process.env["OUTBOX_SEAL_KEY"]!),
    });
    await expect(
      failing.execute({ actorUserId: actorId, idempotencyKey: randomUUID(), input: b as never }),
    ).rejects.toThrow("forced failure");
    expect(await count("clinics", "slug", b.slug)).toBe(0);
    expect(await count("email_reservations", "lower(email)", b.admin.email)).toBe(0);
    expect(await count("invitations", "email", b.admin.email)).toBe(0);
  });
});
