import type { IdGenerator } from "@eyadex/ids";
import type { InvoicePdfRenderer, ReportExportRuntime } from "./modules/billing/index.ts";
import type { WhatsappDependencies } from "./app-whatsapp.ts";
import type { BlobStore } from "./shared/blob/blob-store.ts";

export interface AppDependencies extends WhatsappDependencies {
  readonly financeExports?: ReportExportRuntime | undefined;
  /** UUID v7 for rows the use cases create; the system clock and Web Crypto unless a test injects its own. */
  readonly ids?: IdGenerator;
  /** Releases what main.ts opened. Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
  /**
   * What a signal-triggered shutdown whose release failed or timed out does once it is logged. Nest swallows
   * an error thrown from onApplicationShutdown and then exits 0 (useProcessExit), so the hook cannot throw
   * its way to a non-zero exit: production exits 1 here, a test records the call.
   */
  readonly onUncleanShutdown?: (signal: string) => void;
  /**
   * Mounts Better Auth at `/auth/*` and provides `SessionGuard` (ADR-0004). Reads APP_URL, PLATFORM_URL,
   * AUTH_DATABASE_URL, BETTER_AUTH_SECRET and TRUST_PROXY_HOPS from the environment.
   */
  readonly mountAuth?: boolean;
  /**
   * Mounts the platform area (`POST /v1/platform/clinics`, ADR-0006; `GET /v1/platform/audit`, ADR-0019). Needs auth mounted too, plus
   * DATABASE_URL, PLATFORM_DATABASE_URL and OUTBOX_SEAL_KEY.
   */
  readonly mountPlatform?: boolean;
  /** Mounts `POST /v1/invitations/{inspect,accept}` (ADR-0008). Needs auth mounted and DATABASE_URL. */
  readonly mountInvitations?: boolean;
  /**
   * Mounts the clinic request context behind the global access guard and `GET /v1/me`, `/v1/roles`,
   * `/v1/permissions/catalogue`, `/v1/branches`, `/v1/users`, `/v1/invitations`, `/v1/clinic/mail-provider`,
   * `/v1/patients`, `/v1/clinic/audit`, `/v1/services`, `/v1/schedules`, and finance F1's `/v1/prices`
   * (ADR-0009, 0011, 0012, 0014, 0018, 0019, 0026; docs/specs/finance-design.md). Needs auth mounted,
   * DATABASE_URL, REDIS_URL, OUTBOX_SEAL_KEY,
   * MAIL_PROVIDER_SEAL_KEY, MEDICAL_MASTER_KEY_V<MEDICAL_KEY_VERSION> and MEDICAL_INDEX_KEY (ADR-0028,
   * docs/specs/medical-keys-runbook.md). Attachments also read MEDICAL_BLOB_S3_ENDPOINT,
   * MEDICAL_BLOB_S3_BUCKET, MEDICAL_BLOB_S3_ACCESS_KEY, MEDICAL_BLOB_S3_SECRET_KEY and the optional
   * MEDICAL_BLOB_S3_REGION (docs/specs/medical-blob-runbook.md); without them the API still starts and
   * only an upload or a download answers 503.
   */
  readonly mountClinic?: boolean;
  /** Test-only: the private bucket (attachments, the clinic logo) instead of the environment's. */
  readonly blobStore?: BlobStore;
  /** Test-only: the invoice PDF renderer; until plan Task 8g the API has none and answers 503. */
  readonly invoicePdf?: InvoicePdfRenderer;
}
