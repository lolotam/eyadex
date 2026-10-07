import { Controller, Get, HttpException, Inject } from "@nestjs/common";

export const READINESS = Symbol("READINESS");
/** Each pool's ping; a rejected one is reported "down". */
export type ReadinessChecks = Readonly<Record<string, () => Promise<void>>>;

/**
 * Readiness: pings each pool (eyadex_app, eyadex_dispatcher). Separate from `/health`, which stays a pure
 * liveness probe so a database outage never becomes a restart loop.
 */
@Controller("health")
export class ReadyController {
  readonly #checks: ReadinessChecks;

  constructor(@Inject(READINESS) checks: ReadinessChecks) {
    this.#checks = checks;
  }

  @Get("ready")
  async ready(): Promise<{ status: "ok"; pools: Record<string, "up"> }> {
    const entries = await Promise.all(
      Object.entries(this.#checks).map(async ([name, ping]) => {
        try {
          await ping();
          return [name, "up"] as const;
        } catch {
          return [name, "down"] as const;
        }
      }),
    );
    const pools = Object.fromEntries(entries);
    if (entries.some(([, state]) => state === "down")) {
      throw new HttpException({ status: "unavailable", pools }, 503);
    }
    return { status: "ok", pools: pools as Record<string, "up"> };
  }
}
