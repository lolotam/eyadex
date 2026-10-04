import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * بيفك base32 (RFC 4648) — للاختبار بس، عشان نحسب كود TOTP زي تطبيق الموبايل.
 *
 * @param input النص المشفّر
 * @returns البايتات
 */
function base32Decode(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("invalid base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * كود TOTP (RFC 6238، SHA-1، 6 أرقام، 30 ثانية) من `otpauth://` URI — بيلعب دور تطبيق المستخدم.
 *
 * @param totpUri الـ URI اللي Better Auth رجّعه
 * @param now الوقت بالـ ms
 * @returns الكود 6 أرقام
 */
export function totpFromUri(totpUri: string, now = Date.now()): string {
  const secret = new URL(totpUri).searchParams.get("secret");
  if (secret === null) throw new Error("totp URI has no secret");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
