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

const signIn = async (h: Harness, email: string) =>
  jar(
    setCookies(await call(h, { url: "/auth/sign-in/email", host: PLATFORM, body: { email, password } })),
  );

/** A platform account with a verified second factor, and one signed in without it. */
export async function platformStaff(h: Harness) {
  const user = await createUser(h, h.areaAuth.of("platform"), "staff");
  const pre = await signIn(h, user.email);
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
  if (verify.statusCode !== 200) throw new Error(`totp verify failed: ${verify.statusCode}`);
  const plain = await createUser(h, h.areaAuth.of("platform"), "no-totp");
  return {
    actorId: user.userId,
    cookie: jar(setCookies(verify)),
    noTotpCookie: await signIn(h, plain.email),
  };
}
