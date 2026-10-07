import { meResponseSchema } from "@eyadex/contracts/access";
import type { Transport } from "./http-transport";

/**
 * What the adapter remembers between calls: the signed-in clinic's id, which the web `Branch`
 * carries but the API's branch answers leave out (the cookie already names the clinic).
 */
export type HttpContext = {
  transport: Transport;
  clinicId: string | null;
  /** Injected so tests can pin "today". */
  now: () => Date;
};

export async function clinicIdOf(ctx: HttpContext): Promise<string> {
  if (ctx.clinicId) return ctx.clinicId;
  const me = await ctx.transport.send("GET", "/v1/me", { schema: meResponseSchema });
  ctx.clinicId = me.clinic.id;
  return me.clinic.id;
}
