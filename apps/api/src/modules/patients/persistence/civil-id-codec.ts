import { civilIdHmac, type FieldCipher } from "@eyadex/secrets";

/** What the codec needs of `FieldCipher`: one value sealed to, and opened from, its own row. */
export type CivilIdCipher = Pick<FieldCipher, "seal" | "open">;

/** The three stored columns of one civil ID (SQL 0045): all set, or all null. */
export interface CivilIdColumns {
  readonly enc: string | null;
  readonly hmac: string | null;
  readonly last4: string | null;
}

const NO_CIVIL_ID: CivilIdColumns = { enc: null, hmac: null, last4: null };

// Bound to its own row (ADR-0028): an envelope copied to another file, column or clinic never opens.
const refOf = (patientId: string) => ({
  table: "patients",
  column: "civil_id_enc",
  rowId: patientId,
});

/**
 * The civil ID as stored from SQL 0045 (ADR-0028, R1-5): sealed with the clinic's field key, indexed with
 * the clinic's never-rotated index key, and its last four digits for lists. The only place the patients
 * module turns a number into columns and back, so a plain number never reaches SQL text, a log or an audit
 * row.
 */
export class CivilIdCodec {
  constructor(
    private readonly cipher: CivilIdCipher,
    private readonly indexKey: Buffer,
  ) {}

  /** The blind index of a 12-digit number in this clinic (exact match only, P2-F5). */
  index(clinicId: string, digits: string): string {
    return civilIdHmac(this.indexKey, clinicId, digits);
  }

  /** The columns a write stores for this file's number; no number = three nulls. */
  columns(clinicId: string, patientId: string, digits: string | null): CivilIdColumns {
    if (digits === null) return NO_CIVIL_ID;
    return {
      enc: this.cipher.seal(clinicId, refOf(patientId), digits),
      hmac: this.index(clinicId, digits),
      last4: digits.slice(-4),
    };
  }

  /**
   * The number of one stored file: the envelope when it is set, else the legacy plain column a file
   * written before 0045 still holds until the backfill converts it (R1-5).
   */
  read(clinicId: string, patientId: string, enc: string | null, legacy: string | null) {
    return enc === null ? legacy : this.cipher.open(clinicId, refOf(patientId), enc);
  }
}
