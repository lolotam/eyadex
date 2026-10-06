import { Controller, Get } from "@nestjs/common";

import { Public } from "../modules/identity/access/access-rules.ts";

/**
 * Process liveness — the only route this skeleton serves, and it touches no dependency, so nothing that
 * comes later (the database, Redis) can turn an outage into a restart loop.
 */
@Controller("health")
export class HealthController {
  @Get()
  @Public()
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
