import { BlockList, isIP } from "node:net";

/** منافذ SMTP المعروفة بس: عيادة ماتقدرش توجّه الـ worker لأي منفذ داخلي تاني. */
export const SMTP_PORTS: readonly number[] = [25, 465, 587, 2525];

// Every range that is not the public internet: this host, private networks, shared address space,
// link-local (cloud metadata), documentation and benchmarking, multicast and reserved (RFC 6890).
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

// `::ffff:10.0.0.1` reaches 10.0.0.1, but an IPv4 subnet never matches it as IPv6: unwrap it first.
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * هل العنوان على الإنترنت العام؟ أي عنوان داخلي أو محلي أو محجوز مرفوض، عشان إعدادات SMTP بتاعة عيادة
 * ماتبقاش وسيلة للوصول لشبكة السيرفر (SSRF).
 *
 * @param address عنوان IP كما رجع من الـ DNS
 * @returns `true` لو عام ومسموح الاتصال بيه
 */
export function isPublicAddress(address: string): boolean {
  const mapped = MAPPED.exec(address);
  const ip = mapped?.[1] ?? address;
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}
