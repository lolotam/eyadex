import { randomUUID } from "node:crypto";
import { afterAll, beforeAll } from "vitest";

import {
  createDatabase,
  createDispatcherOutbox,
  type Database,
  type DispatcherOutbox,
} from "@eyadex/db";

import { PgExportStore } from "../persistence/pg-export-store.ts";
import { bindFence } from "./export-fence-bind.ts";
import { urls } from "./export-fixtures.ts";
import "./export-fence-claim.db.ts";
import "./export-fence-isolation.db.ts";
import "./export-fence-wait.db.ts";
import "./export-fence-write.db.ts";

let app: Database;
let outbox: DispatcherOutbox;

beforeAll(() => {
  app = createDatabase({
    url: urls().app,
    role: "eyadex_app",
    ids: { newId: randomUUID },
    transactionTimeoutMs: 20_000,
  });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
  bindFence({ app, store: new PgExportStore(app, { newId: randomUUID }), outbox });
});

afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});
