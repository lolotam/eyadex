import type {
  EvolutionApi,
  EvolutionConnectionState,
  EvolutionConnectResult,
} from "../ports/evolution-api.ts";

/** A PNG data URL shaped like Evolution's QR (a placeholder image, not a real link). */
export const FAKE_QR =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

interface FakeInstance {
  readonly integration: { readonly kind: "baileys" };
  state: "close" | "connecting" | "open";
}

/**
 * The Evolution boundary for the HTTP specs: an in-memory server that records every instance it was
 * asked to create. `scan` plays the phone scanning the QR.
 */
export class FakeEvolution implements EvolutionApi {
  configured = true;
  readonly instances = new Map<string, FakeInstance>();
  readonly created: {
    readonly name: string;
    readonly integration: { readonly kind: "baileys" };
  }[] = [];
  readonly deleted: string[] = [];

  createInstance(name: string): Promise<"created" | "exists"> {
    if (this.instances.has(name)) return Promise.resolve("exists");
    const integration = { kind: "baileys" } as const;
    this.instances.set(name, { integration, state: "close" });
    this.created.push({ name, integration });
    return Promise.resolve("created");
  }

  readonly webhooks: string[] = [];
  setWebhook(name: string): Promise<void> {
    this.webhooks.push(name);
    return Promise.resolve();
  }

  connect(name: string): Promise<EvolutionConnectResult> {
    const instance = this.instances.get(name);
    if (instance === undefined) return Promise.resolve({ state: "missing" });
    if (instance.state === "open") return Promise.resolve({ state: "open" });
    instance.state = "connecting";
    return Promise.resolve({ state: "pending", qrDataUrl: FAKE_QR });
  }

  connectionState(name: string): Promise<EvolutionConnectionState> {
    return Promise.resolve(this.instances.get(name)?.state ?? "missing");
  }

  ownerLast4(name: string): Promise<string | null> {
    return Promise.resolve(this.instances.get(name)?.state === "open" ? "4321" : null);
  }

  logout(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (instance !== undefined) instance.state = "close";
    return Promise.resolve();
  }

  deleteInstance(name: string): Promise<void> {
    if (this.instances.delete(name)) this.deleted.push(name);
    return Promise.resolve();
  }

  /** The phone scans the QR of this instance. */
  scan(name: string): void {
    const instance = this.instances.get(name);
    if (instance === undefined) throw new Error(`no instance ${name}`);
    instance.state = "open";
  }

  /** How many instances were created under this name. */
  createdCount(name: string): number {
    return this.created.filter((entry) => entry.name === name).length;
  }
}
