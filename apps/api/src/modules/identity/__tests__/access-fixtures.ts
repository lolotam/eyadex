import { APP, call, jar, setCookies, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { accept, branchInvite, clinicWithInvite, strongPassword } from "./invitation-fixtures.ts";

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;

export interface Member {
  readonly clinicId: string;
  readonly userId: string;
  readonly email: string;
  readonly cookie: string;
}

export async function signedIn(h: Harness, clinicId: string, email: string, password: string) {
  const res = await call(h, {
    url: "/auth/sign-in/email",
    host: APP,
    body: { email, password },
    ip: randomIp(),
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode}`);
  const [row] = await h.owner`SELECT user_id FROM memberships WHERE email = ${email}`;
  return { clinicId, email, userId: row!["user_id"] as string, cookie: jar(setCookies(res)) };
}

/** A clinic made by slice 3a, its admin accepted (slice 3b) and signed in, plus a branch doctor. */
export async function clinicWithMembers(h: Harness): Promise<{
  admin: Member;
  doctor: Member & { branchId: string; roleId: string };
}> {
  const invite = await clinicWithInvite(h);
  const adminPassword = strongPassword();
  if ((await accept(h, invite.token, adminPassword)).statusCode !== 200) throw new Error("accept");
  const admin = await signedIn(h, invite.clinicId, invite.email, adminPassword);
  const doc = await branchInvite(h, invite.clinicId);
  const doctorPassword = strongPassword();
  if ((await accept(h, doc.token, doctorPassword)).statusCode !== 200) throw new Error("accept");
  const doctor = await signedIn(h, invite.clinicId, doc.email, doctorPassword);
  return { admin, doctor: { ...doctor, branchId: doc.branchId, roleId: doc.roleId } };
}

/** A GET on the clinic host (or another), with the member's cookie when given. */
export const get = (h: Harness, url: string, cookie?: string, host = APP) =>
  call(h, { method: "GET", url, host, ...(cookie === undefined ? {} : { cookie }) });

/** Until the request answers or a session waits on an advisory lock (db files never run in parallel). */
export async function settledOrBlocked(h: Harness, request: Promise<unknown>): Promise<void> {
  let settled = false;
  void request.finally(() => (settled = true));
  for (let i = 0; i < 100 && !settled; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype = 'advisory' AND NOT granted`;
    if (row!["n"] !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
