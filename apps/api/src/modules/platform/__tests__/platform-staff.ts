import {
  call,
  createUser,
  jar,
  password,
  PLATFORM,
  setCookies,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { totpFromUri } from "../../identity/auth/__tests__/totp.ts";

const signIn = async (h: Harness, email: string, secret = password) =>
  jar(
    setCookies(
      await call(h, {
        url: "/auth/sign-in/email",
        host: PLATFORM,
        body: { email, password: secret },
      }),
    ),
  );

/**
 * The platform-team row the API's gate requires (0037, ADR-0020), written by the owner the way the
 * migration's backfill writes an account that predates the team table.
 */
export async function joinPlatformTeam(
  h: Harness,
  user: { userId: string; email: string },
  status: "active" | "deactivated" = "active",
) {
  await h.owner`INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash,
      token_expires_at, invited_by, joined_at, created_at, updated_at)
    VALUES (${user.userId}, ${user.userId}, ${user.email.toLowerCase()}, 'Staff', ${status}, NULL,
      NULL, NULL, now(), now(), now())`;
}

/**
 * Signs a platform account in and enrols TOTP, like its first visit (PRD stories 1–2).
 *
 * @returns the cookie of the session the verified code minted
 */
export async function enrolledCookie(h: Harness, email: string, secret = password) {
  const pre = await signIn(h, email, secret);
  const enable = await call(h, {
    url: "/auth/two-factor/enable",
    host: PLATFORM,
    cookie: pre,
    body: { password: secret },
  });
  const verify = await call(h, {
    url: "/auth/two-factor/verify-totp",
    host: PLATFORM,
    cookie: pre,
    body: { code: totpFromUri(enable.json().totpURI) },
  });
  if (verify.statusCode !== 200) throw new Error(`totp verify failed: ${verify.statusCode}`);
  return jar(setCookies(verify));
}

/** A platform account with a verified second factor, and one signed in without it. */
export async function platformStaff(h: Harness) {
  const user = await createUser(h, h.areaAuth.of("platform"), "staff");
  await joinPlatformTeam(h, user);
  const cookie = await enrolledCookie(h, user.email);
  const plain = await createUser(h, h.areaAuth.of("platform"), "no-totp");
  await joinPlatformTeam(h, plain);
  return { actorId: user.userId, cookie, noTotpCookie: await signIn(h, plain.email) };
}
