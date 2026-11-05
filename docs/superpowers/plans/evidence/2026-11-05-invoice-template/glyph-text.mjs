// Used only to exclude unrelated text whose origin touches a link rectangle.
export function compatibleGlyphText(body, word, objects, page) {
  const resolve = (v) => (typeof v === "string" ? objects["obj:" + v]?.value : v);
  const resources = resolve(page["/Resources"]),
    fonts = resolve(resources["/Font"]);
  const tag = body.match(/(\/\w+)\s+[\d.]+\s+Tf/)?.[1];
  const font = resolve(fonts?.[tag]);
  if (!font?.["/ToUnicode"]) return false;
  const map = new Map(),
    cmap = Buffer.from(objects["obj:" + font["/ToUnicode"]].stream.data, "base64").toString(
      "latin1",
    );
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const entry of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]*)>/gi))
      map.set(parseInt(entry[1], 16), Buffer.from(entry[2], "hex").swap16().toString("utf16le"));
  const text = body.replace(/\/ActualText\s*<[\da-f]*>/gi, "");
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<" && text[i + 1] !== "<") {
      const end = text.indexOf(">", i + 1);
      let hex = text.slice(i + 1, end).replace(/\s/g, "");
      if (hex.length % 2) hex += "0";
      bytes.push(...Buffer.from(hex, "hex"));
      i = end;
      continue;
    }
    if (text[i] !== "(") continue;
    let depth = 1;
    while (++i < text.length && depth) {
      let ch = text[i];
      if (ch === "\\") {
        ch = text[++i];
        if (/[0-7]/.test(ch)) {
          let oct = ch;
          for (let n = 0; n < 2 && /[0-7]/.test(text[i + 1] ?? ""); n++) oct += text[++i];
          bytes.push(parseInt(oct, 8));
        } else if (ch !== "\n" && ch !== "\r")
          bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[ch] ?? ch.charCodeAt(0));
      } else if (ch === "(") {
        depth++;
        bytes.push(40);
      } else if (ch === ")") {
        if (--depth) bytes.push(41);
      } else bytes.push(ch.charCodeAt(0));
    }
  }
  let known = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    known += map.get(bytes[i] * 256 + bytes[i + 1]) ?? "";
  if (known && !known.trim()) return false;
  const expected = word.normalize("NFD");
  return [...known.normalize("NFD")].every((c) => /[\s\p{Cf}]/u.test(c) || expected.includes(c));
}
