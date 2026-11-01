# F3 bounded export implementation

Owner-approved direction: ADR-0036. Runtime integration is implemented locally; staging acceptance
is incomplete and exports remain disabled. This document narrows the resource correction, without
new finance behavior or a business row cap.

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

## Runtime integration

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

## Runtime local acceptance evidence

- Worker unit tests: 777/44 files. API unit tests: 821/80 files. Secrets tests: 44/3 files.
  Typecheck and lint pass for the API, worker, database and secrets packages. Changed-file Prettier
  and `git diff --check` pass.
- Full worker finance-export PostgreSQL suite: 102/9 files. API export PostgreSQL/Redis suite:
  21/4 files, including the separate worker process and signed storage transport. Migration 0074
  and its forward-only index correction 0075 were applied only to the local PostgreSQL 18 instance
  through the migration runner. All 30 SQL check files and the migration-runner self-test pass on
  a fresh scratch database, which was removed afterwards. The database suite passes 208/21 files.
  The initial fresh-schema FK-index check caught the missing non-partial attempt index; 0075 fixes
  it without changing applied 0074.
- The incremental workbook continuation test writes 1,048,576 data rows through the production
  writer, with 1,048,575 data rows plus the header on sheet 1 and a repeated header plus the final
  data row on sheet 2. Independent streaming ZIP parsing verifies both complete entries.
- A PostgreSQL test captures 1,001 own patients in SQL while emitting one monthly row, and renews
  the lease with the read transaction still open. Lost own reach during finalization rolls back the
  capture/marker; lost reach during upload refuses publication.
- HTTP tests cover late corruption/truncation with no attachment bytes, two active slots and
  immediate refusal of a third request, release after completion, ledger reach purge and shutdown
  cancellation of a source stalled after its first chunk.
- Guard-removal checks fail when the expected ciphertext-length bound, final read authorization,
  current own reach at publication, or post-storage download authorization is removed. Stopping
  whole-object verification after the first record makes the corrupt-final HTTP test fail with an
  interrupted response instead of its required safe 503. All mutated sources and built secrets
  output were restored; all 44 secrets and five download-stream tests then passed.
- Independent local review of `e4c75453` found the missing complete foreign-key index and a ZIP
  destination-failure deadlock. The latter is reproduced with a rejecting encrypted destination:
  the original sheet write and disposal both stall. ZIP rejection now errors the TransformStream
  controller, so pending writes reject and disposal completes even after cancellation. The new
  regression fails on the original code and passes with the fix; the 38 affected writer tests pass.
- The second independent local review of `2ff97579` found no further reproducible defect and
  confirmed both fixes. It ran 66 writer/runner/continuation/S3 tests and 44 secrets tests. Subsequent
  test-fixture and CI scheduling changes preserve all assertions and deadlines.
- A later hosted review found that the new ledger cleanup cleared a purged winner before its original
  expiry. The PostgreSQL regression fails on the old query. The correction retains the winning
  done/purged attempt until expiry, still redacts a deleted losing attempt immediately, then redacts
  the winner at expiry without deleting its opaque rows/marker. All 11 sweeper database cases and
  all 777 worker unit cases pass. This runtime correction requires current-head hosted review.

These are local checks, not actual staging storage policy or deployment resource acceptance.

## Local image artifact resource diagnostic

On production worker image `2ff97579`, `docker/finance-export-capacity.mjs` builds two concurrent
synthetic outstanding reports, receives their ciphertext into separate encrypted spools, verifies
both complete objects and decrypts them to a discard sink. All files are disposed. The containers
have `--memory 384m --memory-swap 384m`, with no server credentials, database or network storage.

| Format | Rows per file | Plain bytes per file | Stored bytes per file | Maximum RSS, MiB | Cgroup peak, MiB |
| ------ | ------------- | -------------------- | --------------------- | ---------------- | ---------------- |
| CSV    | 10,000        | 3,370,075            | 4,496,180             | 93               | 122              |
| CSV    | 100,000       | 33,700,075           | 44,959,639            | 102              | 218              |
| XLSX   | 10,000        | 942,590              | 1,257,659             | 119              | 111              |
| XLSX   | 100,000       | 9,460,510            | 12,621,472            | 133              | 116              |

Reproduce with the corresponding built worker image and the committed diagnostic mounted read-only:

```sh
docker run --rm --memory 384m --memory-swap 384m \
  -v "$PWD/docker/finance-export-capacity.mjs:/tmp/f3-capacity.mjs:ro" \
  eyadex-f3-worker:2ff97579 node --conditions=eyadex-runtime /tmp/f3-capacity.mjs csv 100000 2
```

Repeat with `xlsx` and the smaller row count. This measures the actual image's artifact path, including
encrypted disk I/O and full verification, but excludes Nest, SQL reading, SDK transport and actual
HTTP responses. It is not full-pipeline or staging-capacity acceptance. Node-server `build:all` and
both production Dockerfile builds, including frozen-lockfile installation, also pass at `2ff97579`.
