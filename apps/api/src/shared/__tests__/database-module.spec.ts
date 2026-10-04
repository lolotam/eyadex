import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { DatabaseModule } from "../database.module.ts";
import { DATABASE } from "../database.provider.ts";

// The pool must close with the app: app.close() in tests and a signal in a deploy both run Nest's
// shutdown lifecycle (Codex on PR #25).
describe("DatabaseModule", () => {
  it("closes the one Database when the application shuts down", async () => {
    const close = vi.fn(() => Promise.resolve());
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule] })
      .overrideProvider(DATABASE)
      .useValue({ close })
      .compile();
    // A module context runs the same shutdown lifecycle as the HTTP app (onApplicationShutdown).
    await moduleRef.init();
    expect(close).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
