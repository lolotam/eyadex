// Test-only process boundary: the real export poller/runner, without starting mail dispatchers.
import {
  createDatabase,
  createDispatcherOutbox,
} from "../apps/worker/node_modules/@eyadex/db/dist/index.js";
import { systemUuidV7 } from "../apps/worker/node_modules/@eyadex/ids/dist/index.js";
import { createLogger } from "../apps/worker/node_modules/@eyadex/observability/dist/index.js";
import { createFinanceExports } from "../apps/worker/dist/finance-exports/finance-exports.js";

const ids = systemUuidV7();
const app = createDatabase({ url: process.env.EYADEX_TEST_APP_URL, role: "eyadex_app", ids });
const platform = createDatabase({
  url: process.env.EYADEX_TEST_PLATFORM_URL,
  role: "eyadex_platform",
  ids,
});
const outbox = createDispatcherOutbox({ url: process.env.EYADEX_TEST_DISPATCHER_URL });
const runtime = createFinanceExports({
  env: process.env,
  app,
  platform,
  outbox,
  ids,
  clock: { now: () => new Date() },
  intervalMs: 100,
  logger: createLogger("error"),
});
if (runtime === null) throw new Error("export_runtime_not_enabled");
await runtime.start();
process.send?.("ready");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.stop();
  runtime.close();
  await Promise.all([app.close(), platform.close(), outbox.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("message", (message) => {
  if (message === "stop") void stop();
});
