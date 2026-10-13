import type { DynamicModule } from "@nestjs/common";
import {
  NotificationsModule,
  type EvolutionApi,
  type MetaApi,
} from "./modules/notifications/index.ts";

/**
 * WhatsApp reads EVOLUTION_API_URL and EVOLUTION_API_KEY
 * (both or neither; without them linking a number answers 503).
 */
export interface WhatsappDependencies {
  /** Test-only: Evolution API (WhatsApp, spec §7.1) instead of the one EVOLUTION_API_URL/KEY configure. */
  readonly evolutionApi?: EvolutionApi;
  /** Test-only: Meta Graph verification boundary. */
  readonly metaApi?: MetaApi;
}

export function whatsappModule(deps: WhatsappDependencies): DynamicModule {
  return NotificationsModule.forRoot(deps.evolutionApi, deps.metaApi);
}
