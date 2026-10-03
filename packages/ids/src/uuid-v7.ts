/**
 * أي حاجة بتولّد ids — نفس شكل IdGenerator في packages/db (المرحلة ب)، فالـ generator ده بيتربط بيه مباشرة.
 */
export interface IdGenerator {
  newId(): string;
}

/**
 * مصادر الوقت والعشوائية — متحقنة عشان الاختبارات تبقى deterministic.
 */
export interface UuidV7Sources {
  /** الوقت بالـ milliseconds من الـ Unix epoch. */
  now(): number;
  /** بيملى الـ bytes بعشوائية آمنة (crypto.getRandomValues أو ما يعادلها). */
  fillRandom(bytes: Uint8Array): void;
}

const MAX_TIMESTAMP = 2 ** 48;
const MAX_COUNTER = 0xfff;
const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

const format = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes, (byte) => HEX[byte] ?? "00").join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * بيعمل مولّد UUID v7 (RFC 9562): أول 48 bit وقت بالـ ms، وبعدها عدّاد 12 bit وعشوائية 62 bit.
 * الـ ids اللي بتطلع من نفس المولّد مترتبة دايماً — حتى جوه نفس الـ ms، وحتى لو الساعة رجعت لورا —
 * لأن الـ outbox وسجل التدقيق بيعتمدوا على إن الترتيب بالـ id هو ترتيب الإنشاء (CLAUDE.md §5).
 *
 * @param sources الوقت والعشوائية
 * @returns مولّد بيرجّع UUID v7 بالشكل النصي lowercase
 */
export function createUuidV7(sources: UuidV7Sources): IdGenerator {
  let lastMs = -1;
  let counter = 0;
  const bytes = new Uint8Array(16);

  return {
    newId(): string {
      const now = sources.now();
      if (!Number.isInteger(now) || now < 0 || now >= MAX_TIMESTAMP) {
        throw new RangeError("UUID v7 needs a whole, non-negative 48-bit millisecond timestamp");
      }
      sources.fillRandom(bytes);
      if (now > lastMs) {
        lastMs = now;
        // العدّاد بيبدأ من قيمة عشوائية في النص الأول بس، عشان يفضل مكان لزيادات كتير في نفس الـ ms.
        counter = (((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0)) & 0x7ff;
      } else if (counter < MAX_COUNTER) {
        counter += 1;
      } else {
        // العدّاد خلص: بنقدّم الوقت ms واحدة بدل ما نكرر ترتيب (RFC 9562 §6.2).
        lastMs += 1;
        counter = 0;
      }
      if (lastMs >= MAX_TIMESTAMP) {
        throw new RangeError("UUID v7 timestamp overflow");
      }
      let ms = lastMs;
      for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = ms % 256;
        ms = Math.floor(ms / 256);
      }
      bytes[6] = 0x70 | (counter >> 8);
      bytes[7] = counter & 0xff;
      bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
      return format(bytes);
    },
  };
}

interface WebCrypto {
  getRandomValues(bytes: Uint8Array): Uint8Array;
}

/**
 * المولّد الحقيقي: ساعة النظام و Web Crypto — موجودين في Node 24، فنفس الكود بيشتغل في الـ api
 * والـ worker. بيتربط مرة واحدة في الـ composition root بتاع كل app.
 *
 * @returns مولّد UUID v7 على ساعة النظام وعشوائية آمنة
 */
export function systemUuidV7(): IdGenerator {
  const { crypto } = globalThis as unknown as { crypto?: WebCrypto };
  if (crypto === undefined) {
    throw new Error("Web Crypto is not available — UUID v7 needs a secure random source");
  }
  return createUuidV7({
    now: () => Date.now(),
    fillRandom: (bytes) => {
      crypto.getRandomValues(bytes);
    },
  });
}
