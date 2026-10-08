import { createFirstPlatformAccount } from "@eyadex/auth";
import { systemUuidV7 } from "@eyadex/ids";

import { readFirstPlatformAccountInput } from "./modules/identity/index.ts";

// ADR-0021: creates the first platform account on a fresh database, once. Run inside the API container
// (it already holds AUTH_DATABASE_URL, BETTER_AUTH_SECRET, PLATFORM_URL and AUTH_COOKIE_PREFIX):
//   printf '%s\n' "$PASSWORD" | docker exec -i -e BOOTSTRAP_EMAIL -e BOOTSTRAP_NAME <api container> \
//     node --conditions=eyadex-runtime dist/bootstrap-platform-account.js
// The password is read from stdin only. Output names the outcome and the user id, never an input.

const fail = (message: string, code = 1): never => {
  process.stderr.write(`bootstrap: ${message}\n`);
  process.exit(code);
};

if (process.stdin.isTTY) fail("pipe the password on stdin; a terminal would echo it", 2);

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  const input = readFirstPlatformAccountInput(process.env, Buffer.concat(chunks).toString("utf8"));
  const result = await createFirstPlatformAccount(
    {
      databaseUrl: input.databaseUrl,
      secret: input.secret,
      baseUrl: input.baseUrl,
      ids: systemUuidV7(),
      ...(input.cookiePrefix === undefined ? {} : { cookiePrefix: input.cookiePrefix }),
    },
    { email: input.email, name: input.name, password: input.password },
  );
  if (!result.created) fail(`refused (${result.reason}); nothing was written`);
  else {
    process.stdout.write(`bootstrap: platform account created (user ${result.userId}); `);
    process.stdout.write("sign in on the platform host to enroll TOTP\n");
  }
} catch (error) {
  // Our own TypeError/RangeError messages name keys and limits only. Anything else — or a message that
  // looks like it carries a URL or an address — may hold a connection string or an input, so only the
  // error's class and code are printed.
  const message = (error as Error).message ?? "";
  const ours =
    (error instanceof TypeError || error instanceof RangeError) && !/:\/\/|@/.test(message);
  const code = (error as { code?: unknown }).code;
  fail(
    ours
      ? message
      : `failed (${(error as Error).name ?? "Error"}${typeof code === "string" ? ` ${code}` : ""})`,
  );
}
