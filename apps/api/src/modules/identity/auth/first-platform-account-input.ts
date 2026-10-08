import { z } from "zod";

// ADR-0021: what the one-off bootstrap reads. The connection, secret and origin are the API container's
// own; the email and name come as BOOTSTRAP_* variables; the password only on stdin, never an argument
// (a process's arguments are visible to every user of the host).
const schema = z.object({
  AUTH_DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  PLATFORM_URL: z.string().url(),
  AUTH_COOKIE_PREFIX: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  BOOTSTRAP_EMAIL: z.string().trim().min(3),
  BOOTSTRAP_NAME: z.string().trim().min(1),
});

/** What the bootstrap needs, read from the environment and stdin. */
export interface FirstPlatformAccountInput {
  readonly databaseUrl: string;
  readonly secret: string;
  readonly baseUrl: string;
  readonly cookiePrefix: string | undefined;
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/**
 * Parses the bootstrap's input. Errors name the keys, never a value. The password is everything on
 * stdin minus one trailing line break (what `printf '%s\n'` or a here-string adds); a second line is
 * refused rather than guessed at.
 *
 * @param env the process environment
 * @param stdin everything read from stdin
 * @returns the validated input
 */
export function readFirstPlatformAccountInput(
  env: NodeJS.ProcessEnv,
  stdin: string,
): FirstPlatformAccountInput {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new TypeError(`Invalid bootstrap configuration: ${keys.join(", ")}`);
  }
  const password = stdin.replace(/\r?\n$/, "");
  if (password === "" || /[\r\n]/.test(password)) {
    throw new TypeError("the password must be one line on stdin");
  }
  const config = result.data;
  return {
    databaseUrl: config.AUTH_DATABASE_URL,
    secret: config.BETTER_AUTH_SECRET,
    baseUrl: config.PLATFORM_URL,
    cookiePrefix: config.AUTH_COOKIE_PREFIX,
    email: config.BOOTSTRAP_EMAIL,
    name: config.BOOTSTRAP_NAME,
    password,
  };
}
