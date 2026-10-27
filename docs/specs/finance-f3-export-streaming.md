# F3 bounded export implementation

Owner-approved direction: ADR-0036. Runtime remains disabled; implementation and staging acceptance
are incomplete. This document narrows the resource correction, without new finance behavior or a
business row cap.

## Increment 1: bounded primitives

`Tx.cursor(SELECT)` remains inside `withTenant`. It renders and checks SQL once, declares a
non-holdable NO SCROLL server cursor and transfers 500 rows per read. No raw driver, cursor name,
transaction setting or cursor-control SQL reaches the application. Every operation is lifetime
tracked and expires with its tenant transaction/savepoint. Completed observed tracking entries are
pruned, while all unobserved work remains a rollback reason. The SELECT retains one PostgreSQL
snapshot; ordinary SELECT checks between pages see current authority under READ COMMITTED.
No export-row lock may span the cursor read, local file work or network storage I/O.

`SealedFile` writes ciphertext only to a private random temporary directory (0600 file). Plaintext
working chunks are at most 65,536 bytes. The file starts with `EYADEXE1`, followed by length-prefixed
UTF-8 FieldCipher f1 envelopes, each bounded to 90,000 bytes. Each envelope uses the existing
versioned per-clinic AES-256-GCM key derivation. Its AAD is the original table/column/clinic binding
with rowId `<export>:<attempt>:chunk:<index>`. Data records contain type byte 0 and plaintext bytes.
The mandatory final record contains type byte 1, an unsigned 64-bit plaintext length and SHA-256 of
the ordered complete plaintext. This prevents truncation, reordering, splicing and trailing data.
The final record and every data record are authenticated before any download plaintext is exposed.

Downloads spool the existing ciphertext, verify all records while discarding decrypted bytes,
repeat current authorization, and only then open a second bounded decryption pass for the HTTP
response. The descriptor stays private and the finalized file cannot be appended. Each second-pass
record is authenticated again. Success, failure, abort and shutdown dispose the file. The runtime
must hold a bounded download slot until response completion, with no waiting queue.

## Subsequent integration increments

- Allocate the attempt blob before reading. Derive the frozen request from the live fence inside the
  read transaction and recheck current authority/fencing before and after every page, using plain
  SELECTs so the heartbeat can renew. No SQL timeout is increased.
- Stream normalized rows into an encrypted artifact. CSV retains exact precision and formula rules.
  XLSX uses incremental inline strings/money text, bounded ZIP output with ZIP64, and continuation
  worksheets after the format's per-sheet row limit, repeating headers without dropping rows.
- Replace the own JSON aggregate/JS array with per-attempt forced-RLS bookkeeping. Capture patients
  from exactly the same SELECT as their amounts; record completion only after the entire read.
  Publish only the winning attempt and completed set. Download reach is a SQL boolean over that set.
  Use a new forward-only migration and negative isolation/platform-grant tests; never edit 0068.
- Upload the encrypted artifact from a stream with known ciphertext length; retain all existing
  allocated/uploaded/published fences and recovery. Encrypt all new export artifacts, including
  aggregate reports, so the temporary and persisted representation are identical.
- Wire bounded download transport and response lifetime cleanup. Keep the public API shape and
  private attachment filenames; return no public links, storage keys or patient identifiers.

Acceptance includes growing datasets under deployment resource limits, responsive heartbeats,
revocation during reads/downloads, no response bytes on late integrity failure, complete XLSX
continuation, own-reach purge and least-privilege MinIO deletion. Server setup and SQL application
remain a separate owner operational gate.

## Increment 1 local verification

- Database unit tests: 236/14 files. Full PostgreSQL 18 database tests: 207/21 files, runtime roles.
- Secrets tests: 42/3 files, including 19 encrypted-file cases. A source stalled after its first
  chunk is destroyed on cancellation; reception rejects and the temporary directory disappears.
  Reception requires a cancellable Node Readable and checks cancellation before file creation.
- Mutations: removing completed-observed pruning fails the 10,000-page tracking test; FETCH ALL
  fails the 500-row bound; removing source destruction fails the stalled-source cancellation case.
  Sources were restored exactly and tests passed.
- Synthetic spool diagnostic (single process, 64 KiB reused input): 16 MiB plaintext produced
  22,382,704 ciphertext bytes at 68 MiB observed write RSS; 128 MiB produced 179,060,848 bytes at
  70 MiB observed write RSS. Both verified and were removed. These are primitive measurements,
  not full-pipeline deployment-capacity acceptance.
