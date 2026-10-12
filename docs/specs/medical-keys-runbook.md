# Medical keys — runbook (ADR-0028)

The API encrypts every clinical value and the civil ID with keys that live only in the API's environment
(Dokploy). This page is for the owner, who is the only person who ever generates, sees or pastes them.
Agents never type, read, copy or print a key.

## The three variables

| Variable                | What it is                                                                                     | Rotated?                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `MEDICAL_MASTER_KEY_V1` | Master key, version 1: each clinic's field key is derived from it (HKDF, info `eyadex-field`). | Yes, by adding `V2`, `V3`… (below)            |
| `MEDICAL_KEY_VERSION`   | The version every new write uses. Not a secret. `1` to start.                                  | Changes when a new master version is added    |
| `MEDICAL_INDEX_KEY`     | The civil ID search key (HMAC blind index, info `eyadex-civil-id`). Separate from the master.  | **Never.** Rotating it breaks civil ID search |

The API refuses to start when `MEDICAL_KEY_VERSION` is set but not a positive integer (unset means 1), when
`MEDICAL_MASTER_KEY_V<MEDICAL_KEY_VERSION>` or `MEDICAL_INDEX_KEY` is missing, or when any of these keys is
not exactly 32 bytes in standard base64 (44 characters ending in `=`). The error names the variable, never
the value. The worker does not need these keys.

## Generating a key

Run this on your own computer, once per variable per environment, in Windows PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

It prints one value. Paste it straight into the Dokploy variable, then clear the terminal. Never put a
key in chat, a ticket, a commit, a screenshot or a shared document.

- **One value per variable per environment.** Staging and production get different values for
  `MEDICAL_MASTER_KEY_V1` and for `MEDICAL_INDEX_KEY`; the master and index keys are never the same value.
  Never copy a production value to staging or the other way round.
- Set them on each environment's **API** service only (never the worker or the web), with
  `MEDICAL_KEY_VERSION=1`.

## Offline copies — losing a key loses the data

Keep an offline copy of every master key version and of the index key for each environment (for
example on paper or an encrypted USB stick kept in two separate places). A database backup is useless
without them:

- Losing a `MEDICAL_MASTER_KEY_V<n>` loses every clinical value and civil ID written under that version.
  Nobody, including the Eyadex team, can recover it.
- Losing `MEDICAL_INDEX_KEY` loses civil ID search and the duplicate-civil-ID check until every number is
  re-indexed under a new key (a re-index job that does not exist yet).

## Rotating the master key

1. Generate a new value and add it as `MEDICAL_MASTER_KEY_V2` (keep `V1`). Redeploy: reads accept both.
2. Set `MEDICAL_KEY_VERSION=2` and redeploy: new writes use version 2.
3. Re-encrypt the old rows to version 2 (a job written when the first rotation is needed).
4. Only after that job reports zero version-1 values, remove `MEDICAL_MASTER_KEY_V1`.

`MEDICAL_INDEX_KEY` does not change during a rotation.

## The civil ID backfill (plan Task 3, R1-5/R1-6) — done

SQL 0045 added the encrypted civil ID columns, and a one-off backfill command converted the files saved
before it. Once no plain number was left on staging or production, SQL 0052 dropped the plain `civil_id`
column and the command was removed. Apply 0052 on an environment only after the release that no longer
names `civil_id` is deployed there: the older API reads and writes the column. 0052 refuses to run on a
database that still holds a plain number; such a database needs the backfill of an earlier release first.
