import { randomBytes } from "node:crypto";

import { fieldCipherFromEnv } from "@eyadex/secrets";

import {
  APP,
  MEDICAL_KEYS,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";

/** One part of a hand-built multipart body: a field, or a file with its name and declared type. */
export type Part =
  | { readonly name: string; readonly value: string }
  | {
      readonly name: string;
      readonly filename: string;
      readonly type: string;
      readonly bytes: Buffer;
    };

const BOUNDARY = "----eyadex-test-boundary";

/** A real `multipart/form-data` body, byte for byte what a browser would send. */
export function multipartBody(parts: readonly Part[]): { payload: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const head =
      "bytes" in part
        ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
          `Content-Type: ${part.type}\r\n`
        : `Content-Disposition: form-data; name="${part.name}"\r\n`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${head}\r\n`, "utf8"));
    chunks.push("bytes" in part ? part.bytes : Buffer.from(part.value, "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

/** POSTs a multipart body as `cookie` (the session of the app area). */
export function postMultipart(h: Harness, cookie: string, url: string, parts: readonly Part[]) {
  const { payload, contentType } = multipartBody(parts);
  return h.app.inject({
    method: "POST",
    url,
    headers: { host: new URL(APP).host, origin: APP, cookie, "content-type": contentType },
    payload,
  });
}

/** POST /v1/patients/:id/attachments as `cookie`. */
export const uploadParts = (
  h: Harness,
  cookie: string,
  patientId: string,
  parts: readonly Part[],
) => postMultipart(h, cookie, `/v1/patients/${patientId}/attachments`, parts);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `size` bytes that start like a PNG (the API checks the first bytes, not the whole image). */
export const pngBytes = (size: number): Buffer =>
  Buffer.concat([Buffer.from(PNG_SIGNATURE), randomBytes(size - PNG_SIGNATURE.length)]);

/** A file part named `file`. */
export const filePart = (filename: string, type: string, bytes: Buffer): Part => ({
  name: "file",
  filename,
  type,
  bytes,
});

/** The run's FieldCipher, built from the keys the harness generated (never constants in source). */
export const testCipher = () => fieldCipherFromEnv(MEDICAL_KEYS);

/** An uploaded attachment's id (the call must succeed). */
export async function uploaded(
  h: Harness,
  cookie: string,
  patientId: string,
  parts: readonly Part[],
): Promise<string> {
  const res = await uploadParts(h, cookie, patientId, parts);
  if (res.statusCode !== 201) throw new Error(`upload ${res.statusCode} ${res.body}`);
  return (res.json() as { attachment: { id: string } }).attachment.id;
}
