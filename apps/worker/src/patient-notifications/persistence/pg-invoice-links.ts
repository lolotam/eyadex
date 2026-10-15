import { randomBytes } from "node:crypto";

import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";
import { SealOpenError, type SecretSealer } from "@eyadex/secrets";

import {
  INVOICE_LINK_TTL_MS,
  invoiceLinkContext,
  invoiceTokenHash,
} from "../domain/invoice-link.ts";
import type { InvoiceLinkStore, PreparedInvoiceLink } from "../ports/invoice-links.ts";

type LinkRow = { id: string; token_hash: Buffer; token_sealed: string; expires_at: Date | string };

/**
 * Tx 1 of an invoice send (C1, spec §8c.1). Lock order: the ledger row, the invoice (FOR SHARE), then the
 * live link — the void takes the invoice before it revokes the links, so the reverse order would deadlock.
 */
export class PgInvoiceLinks implements InvoiceLinkStore {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  prepare(
    clinicId: string,
    notificationId: string,
    sealer: SecretSealer | null,
    now: Date,
  ): Promise<PreparedInvoiceLink> {
    return this.db.withTenant(clinicId, async (tx) => {
      const [ledger] = (await tx.execute(
        sql`SELECT kind, status, subject_id FROM patient_notifications
            WHERE clinic_id = ${clinicId} AND id = ${notificationId} FOR UPDATE`,
      )) as unknown as { kind: string; status: string; subject_id: string }[];
      if (ledger === undefined || ledger.kind !== "invoice" || ledger.status !== "queued") {
        return { kind: "not_invoice" };
      }
      const [invoice] = (await tx.execute(
        sql`SELECT status FROM invoices WHERE clinic_id = ${clinicId} AND id = ${ledger.subject_id}
            FOR SHARE`,
      )) as unknown as { status: string }[];
      // A missing invoice is the send path's to report (subject_missing), like a missing appointment.
      if (invoice === undefined) return { kind: "not_invoice" };
      if (invoice.status === "void") {
        await tx.execute(
          sql`UPDATE patient_notifications SET status = 'skipped', skip_reason = 'invoice_void',
                updated_at = ${now.toISOString()}::timestamptz
              WHERE clinic_id = ${clinicId} AND id = ${notificationId}`,
        );
        return { kind: "void" };
      }
      if (sealer === null) return { kind: "no_key" };
      const token = await this.liveToken(tx, clinicId, notificationId, sealer, now);
      return {
        kind: "ready",
        token:
          token ??
          (await this.mint(tx, { clinicId, notificationId, sealer, now }, ledger.subject_id)),
      };
    });
  }

  // The live link's token when its seal still opens and matches its hash and it has not expired; otherwise
  // the link is revoked here and null tells the caller to mint a fresh one.
  private async liveToken(
    tx: Tx,
    clinicId: string,
    notificationId: string,
    sealer: SecretSealer,
    now: Date,
  ): Promise<string | null> {
    const [link] = (await tx.execute(
      sql`SELECT id, token_hash, token_sealed, expires_at FROM invoice_links
          WHERE clinic_id = ${clinicId} AND notification_id = ${notificationId} AND revoked_at IS NULL
          FOR UPDATE`,
    )) as unknown as LinkRow[];
    if (link === undefined) return null;
    if (new Date(link.expires_at).getTime() > now.getTime()) {
      try {
        const token = sealer.open(
          link.token_sealed,
          invoiceLinkContext(clinicId, link.id, notificationId),
        );
        if (invoiceTokenHash(token).equals(Buffer.from(link.token_hash))) return token;
      } catch (error) {
        // A rotated INVOICE_LINK_SEAL_KEY: the old link cannot be re-sent, so it gives way to a new one.
        if (!(error instanceof SealOpenError)) throw error;
      }
    }
    await tx.execute(
      sql`UPDATE invoice_links SET revoked_at = ${now.toISOString()}::timestamptz
          WHERE clinic_id = ${clinicId} AND id = ${link.id}`,
    );
    return null;
  }

  private async mint(
    tx: Tx,
    at: { clinicId: string; notificationId: string; sealer: SecretSealer; now: Date },
    invoiceId: string,
  ): Promise<string> {
    const id = this.ids.newId();
    const token = randomBytes(32).toString("base64url");
    const sealed = at.sealer.seal(token, invoiceLinkContext(at.clinicId, id, at.notificationId));
    const expires = new Date(at.now.getTime() + INVOICE_LINK_TTL_MS);
    await tx.execute(
      sql`INSERT INTO invoice_links (clinic_id, id, invoice_id, notification_id, token_hash, token_sealed,
            expires_at, revoked_at, created_at)
          VALUES (${at.clinicId}, ${id}, ${invoiceId}, ${at.notificationId}, ${invoiceTokenHash(token)},
            ${sealed}, ${expires.toISOString()}::timestamptz, NULL, ${at.now.toISOString()}::timestamptz)`,
    );
    return token;
  }
}
