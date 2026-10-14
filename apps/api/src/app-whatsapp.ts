import type { DynamicModule } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import {
  NotificationsModule,
  registerMetaWebhookBody,
  type EvolutionApi,
  type MetaApi,
} from "./modules/notifications/index.ts";

/**
 * WhatsApp reads EVOLUTION_API_URL and EVOLUTION_API_KEY
 * (both or neither; without them linking a number answers 503), and the Meta app's META_APP_ID,
 * META_APP_SECRET, META_WHATSAPP_CONFIG_ID and META_WEBHOOK_VERIFY_TOKEN (all four or none).
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

/**
 * Meta's status webhook signs its raw bytes (spec §7.2): that one route keeps them, every other route is
 * untouched. Registered before Nest adds its routes, like the attachment upload's parser.
 *
 * @param fastify the application's Fastify instance
 */
export function whatsappHooks(fastify: FastifyInstance): void {
  registerMetaWebhookBody(fastify);
}
