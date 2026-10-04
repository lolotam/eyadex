import { Controller, Get } from "@nestjs/common";

/**
 * Process liveness — the worker's only route. It touches no dependency, so nothing that comes later (the
 * database, Redis, the queue) turns an outage into a restart loop; readiness arrives with the first job.
 */
@Controller("health")
export class HealthController {
  @Get()
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
