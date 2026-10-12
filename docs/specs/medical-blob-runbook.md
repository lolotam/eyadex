# Medical attachments storage — runbook (spec §6, ADR-0029 §13)

Attachments (lab PDFs, images) are encrypted inside the API and stored as ciphertext in a **private
S3-compatible bucket on MinIO**, on the same Dokploy server as the API, reachable only on the internal
`dokploy-network`. This page is for the owner, who is the only person who ever generates, sees or pastes
the MinIO passwords and keys. Agents never type, read, copy or print one, and no value goes in chat.

Do it twice, **once for staging and once for production**, with different passwords and keys each time.
Staging's API never points at production's MinIO, and the other way round.

## 0. The image

MinIO now publishes its community edition as source code only: `minio/minio` on Docker Hub and
`quay.io/minio/minio` no longer serve images, so a Dokploy MinIO template that names them will fail to pull.
Eyadex uses the community-maintained build that CI tests against:

```
pgsty/minio:RELEASE.2026-08-04T00-00-00Z
```

Use exactly that tag (CI pins the same tag by digest in `.github/workflows/ci.yml`); upgrade it in CI first,
then here. Alternatives, if you prefer another source: Chainguard's `cgr.dev/chainguard/minio` (only a
`latest` tag is free, so pin it by digest) or an image you build from MinIO's source. The API speaks plain
S3, so the choice changes nothing in Eyadex itself.

## 1. The MinIO service

In the Dokploy project `Eyadex.com` (staging in its `staging` environment):

| Environment | Service name           |
| ----------- | ---------------------- |
| Production  | `eyadex-minio`         |
| Staging     | `eyadex-minio-staging` |

1. Create an **Application**, provider **Docker**, image as in §0.
2. Command (Advanced → Run Command): `minio server /data`. Dokploy's Command replaces the image's
   entrypoint, so it must name the `minio` program itself (`server /data` alone fails with "exec: server:
   executable file not found"); left empty, the image runs `minio` with no server and exits. This field is
   set on the MinIO service only: the API's Command stays empty.
3. Volume (Advanced → Volumes): a named volume mounted at `/data`. The files live there.
4. Environment: `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`. Generate both on your own computer (below);
   the root pair is for you only and **never** goes to the API.
5. **No domain and no external port.** Do not add a domain, do not publish 9000, and never publish the web
   console. The service is internal on `dokploy-network` only.
6. Resources: memory limit 512 MB. Restart policy: always. Deploy and wait until it is running.
7. Write down the internal host name Dokploy gives the service ("App Name"); it is `<minio-host>` below.

Generating a value (Windows PowerShell, once per value per environment; it prints 40 hex characters):

```powershell
$b = New-Object byte[] 20; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

Paste it straight into Dokploy (or the terminal prompt in §2), then clear your terminal. Keep an offline
copy of the root pair with the medical keys (`docs/specs/medical-keys-runbook.md`).

## 2. The bucket and the API's own user

Open the MinIO service's terminal in Dokploy (the image includes the `mc` client) and run:

```sh
export MC_HOST_local="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@127.0.0.1:9000"
mc mb local/eyadex-medical
mc version enable local/eyadex-medical
cat > /tmp/eyadex-medical-rw.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::eyadex-medical/clinic/*"]
    }
  ]
}
EOF
mc admin policy create local eyadex-medical-rw /tmp/eyadex-medical-rw.json
printf 'API secret key: '; read -rs SECRET; echo
mc admin user add local eyadex-api "$SECRET"
mc admin policy attach local eyadex-medical-rw --user eyadex-api
```

At the prompt, paste a freshly generated value (§1): it is the API's secret key. It never appears on the
command line or in the shell history. The prompt needs an interactive terminal (Dokploy's terminal or an SSH
session you type in). Save the value in your password manager first: §4 needs exactly the same value. If it
is lost, run the `export MC_HOST_local=…`, `read`, `mc admin user add` and `mc admin policy attach` lines
again with a new value (the cleanup below unsets the `local` alias, so the export comes first; adding an
existing user replaces its key; "already attached" from the last line is fine) and update §4.

Why the policy is this small:

- **Get and Put only, under `clinic/*`.** The API stores every file at `clinic/<clinic>/<attachment>` and
  reads it back; nothing else.
- **No `s3:DeleteObject`.** The API never deletes: archiving an attachment is a status in the database.
- **No `s3:ListBucket`.** The API never lists. Without it, a store may answer a missing file with 403
  instead of 404; the API treats both as an error, so do not add it "to be safe".

Check the user, then remove the check file and the variables:

```sh
export MC_HOST_api="http://eyadex-api:$SECRET@127.0.0.1:9000"
echo check | mc pipe api/eyadex-medical/clinic/runbook/check && mc cat api/eyadex-medical/clinic/runbook/check
mc ls api/eyadex-medical            # must answer Access Denied
mc rm --versions --force local/eyadex-medical/clinic/runbook/check   # every version (versioning is on)
unset SECRET MC_HOST_api MC_HOST_local; rm /tmp/eyadex-medical-rw.json
```

## 3. Versioning and backups

- **Versioning** (enabled above) keeps the previous content if a key is ever written twice. The API writes
  each key once (the attachment id is new), so it costs nothing in normal use.
- **Back up the `/data` volume** with Dokploy's volume backups, daily, to the same destination as the
  Postgres backups, keeping 7. A database backup without the volume loses every attachment's content; the
  volume without the database is useless (the rows hold the name, the type and the SHA-256).
- Both are useless without the medical keys: the files are AES-256-GCM ciphertext bound to their clinic
  and attachment id. Restore the database, the volume and the keys of the **same** environment together.

## 4. The API's variables

Paste these five on the API service only — `Eyadex-API` for production, `eyadex-api-staging` for staging
(never the worker or the web), then redeploy the API:

| Variable                     | Value                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `MEDICAL_BLOB_S3_ENDPOINT`   | `http://<minio-host>:9000` (internal network: plain http) |
| `MEDICAL_BLOB_S3_BUCKET`     | `eyadex-medical`                                          |
| `MEDICAL_BLOB_S3_ACCESS_KEY` | `eyadex-api`                                              |
| `MEDICAL_BLOB_S3_SECRET_KEY` | the secret key you typed at the prompt in §2              |
| `MEDICAL_BLOB_S3_REGION`     | `us-east-1` (optional; it is the default)                 |

The first four go together: with none of them the API starts and only an attachment upload or download
answers 503; with some but not all, or a malformed endpoint or bucket name, the API refuses to start (its
log says only `api failed to start`, because startup errors are never logged with their text: check the
five names and values against this table). The API starts with a wrong secret key too, so check the key
from inside the API container after the redeploy (`<api-service>` is the API's App Name; it reads a key that
does not exist, so it writes nothing and prints no secret):

```sh
docker exec $(docker ps -q --filter name=<api-service> | head -1) node -e 'const {S3Client,GetObjectCommand}=require("@aws-sdk/client-s3");const e=process.env;const s=new S3Client({endpoint:e.MEDICAL_BLOB_S3_ENDPOINT,region:e.MEDICAL_BLOB_S3_REGION||"us-east-1",forcePathStyle:true,credentials:{accessKeyId:e.MEDICAL_BLOB_S3_ACCESS_KEY,secretAccessKey:e.MEDICAL_BLOB_S3_SECRET_KEY}});s.send(new GetObjectCommand({Bucket:e.MEDICAL_BLOB_S3_BUCKET,Key:"clinic/smoke/does-not-exist"})).then(()=>console.log("found")).catch(x=>console.log("answer:",x.name,(x.$metadata||{}).httpStatusCode))'
```

`NoSuchKey 404` (or `AccessDenied 403`) means the key is right; `SignatureDoesNotMatch` means the secret
differs from §2, `InvalidAccessKeyId` the access key. Then upload and download one test attachment on
staging before production.
