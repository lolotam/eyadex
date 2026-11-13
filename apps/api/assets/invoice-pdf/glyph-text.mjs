import { shownText } from "./text-operands.mjs";

// Used only to exclude unrelated text whose origin touches a link rectangle.
export function compatibleGlyphText(body, word, objects, page) {
  const resolve = (v) => (typeof v === "string" ? objects["obj:" + v]?.value : v);
  const resources = resolve(page["/Resources"]),
    fonts = resolve(resources["/Font"]);
  const shown = shownText(body);
  if (!shown) return false;
  const tag = shown.font;
  const font = resolve(fonts?.[tag]);
  if (!font?.["/ToUnicode"]) return false;
  const map = new Map(),
    cmap = Buffer.from(objects["obj:" + font["/ToUnicode"]].stream.data, "base64").toString(
      "latin1",
    );
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const entry of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]*)>/gi)) {
      if (entry[1].length !== 4 || entry[2].length % 4) return false;
      const key = entry[1].toLowerCase();
      if (map.has(key)) return false;
      map.set(key, Buffer.from(entry[2], "hex").swap16().toString("utf16le"));
    }
  const bytes = Buffer.concat(shown.strings);
  if (!bytes.length) return false;
  let known = "";
  for (let i = 0; i < bytes.length; i += 2) {
    const code = bytes.subarray(i, i + 2).toString("hex");
    if (!map.has(code) || !map.get(code).length) return false;
    known += map.get(code);
  }
  if (!known.trim()) return false;
  const expected = word.normalize("NFD");
  return [...known.normalize("NFD")].every((c) => /[\s\p{Cf}]/u.test(c) || expected.includes(c));
}
