// Synthetic Typst fixture transformer only; never imported by the API or worker.
export function correct(document) {
  const objects = document.qpdf[1];
  const resolve = (reference) =>
    typeof reference === "string" ? objects[`obj:${reference}`]?.value : reference;
  const streamText = (reference) =>
    Buffer.from(objects[`obj:${reference}`].stream.data, "base64").toString("latin1");
  const fonts = new Map();
  for (const object of Object.values(objects)) {
    const resources = resolve(object.value?.["/Resources"]);
    const dictionary = resolve(resources?.["/Font"]);
    for (const [tag, reference] of Object.entries(dictionary ?? {})) {
      const font = resolve(reference);
      if (font["/Encoding"] !== "/Identity-H") throw new Error("probe supports Identity-H only");
      const cmap = streamText(font["/ToUnicode"]);
      const map = new Map();
      const zeroWidth = new Set();
      const descendant = resolve(font["/DescendantFonts"][0]);
      const declaredWidths = new Map();
      const widths = descendant["/W"];
      for (let i = 0; i < widths.length;) {
        const first = widths[i++],
          next = widths[i++];
        if (Array.isArray(next))
          next.forEach((width, offset) => declaredWidths.set(first + offset, width));
        else {
          const width = widths[i++];
          for (let id = first; id <= next; id++) declaredWidths.set(id, width);
        }
      }
      for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const entry of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]*)>/gi)) {
          const value = Buffer.from(entry[2], "hex");
          map.set(Number.parseInt(entry[1], 16), value.swap16().toString("utf16le"));
        }
      }
      for (let id = 1; id <= Math.max(...map.keys()); id++)
        if ((declaredWidths.get(id) ?? descendant["/DW"]) === 0) zeroWidth.add(id);
      if (fonts.has(tag) && fonts.get(tag).reference !== reference)
        throw new Error("page-local font ids need a page-specific implementation");
      fonts.set(tag, { reference, map, zeroWidth, cmapReference: font["/ToUnicode"] });
    }
  }
  function literalBytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "(") continue;
      let depth = 1;
      while (++i < text.length && depth) {
        let ch = text[i];
        if (ch === "\\") {
          ch = text[++i];
          if (/[0-7]/.test(ch)) {
            let octal = ch;
            for (let n = 0; n < 2 && /[0-7]/.test(text[i + 1] ?? ""); n++) octal += text[++i];
            bytes.push(Number.parseInt(octal, 8));
          } else if (ch === "\r" || ch === "\n") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
          } else bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[ch] ?? ch.charCodeAt(0));
        } else if (ch === "(") {
          depth++;
          bytes.push(40);
        } else if (ch === ")") {
          if (--depth) bytes.push(41);
        } else bytes.push(ch.charCodeAt(0));
      }
      if (depth) throw new Error("unterminated string");
    }
    return Buffer.from(bytes);
  }
  let spans = 0;
  const decodedWords = [];
  for (const object of Object.values(objects)) {
    if (!object.stream) continue;
    const content = Buffer.from(object.stream.data, "base64").toString("latin1");
    if (!content.includes("BT")) continue;
    if (content.includes("/ActualText")) throw new Error("unsupported_marked_text");
    let currentFont;
    const patched = content.replace(/BT([\s\S]*?)ET/g, (whole, body) => {
      const matches = [...body.matchAll(/(\/\w+)\s+[\d.]+\s+Tf/g)];
      if (new Set(matches.map((match) => match[1])).size > 1)
        throw new Error("probe requires one font per text object");
      if (matches.length) currentFont = fonts.get(matches.at(-1)[1]);
      const font = currentFont;
      if (!font) throw new Error("unknown font");
      const bytes = literalBytes(body);
      if (bytes.length % 2) throw new Error("odd Identity-H byte count");
      let visual = "";
      for (let i = 0; i < bytes.length; i += 2) {
        const id = bytes.readUInt16BE(i);
        const value = font.map.get(id) ?? (font.zeroWidth.has(id) ? "" : undefined);
        if (value === undefined) throw new Error("missing glyph mapping");
        visual += value;
      }
      const hasArabicLetter = /(?=\p{Script=Arabic})\p{Letter}/u.test(visual);
      if (
        /\p{Mark}/u.test(visual) &&
        (hasArabicLetter || /^[\p{Script=Arabic}\p{Mark}]+$/u.test(visual))
      )
        throw new Error("unsupported_marked_text");
      // Script=Arabic also includes digits and numeric separators: never reverse those runs.
      if (!hasArabicLetter) return whole;
      if (!/^(?:(?=\p{Script=Arabic})\p{Letter})+$/u.test(visual))
        throw new Error("unsupported_mixed_run");
      const clusters = [
        ...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(visual),
      ].map((item) => item.segment);
      const logical = clusters.reverse().join("");
      const actual = Buffer.from([...logical].reverse().join(""), "utf16le")
        .swap16()
        .toString("hex");
      decodedWords.push(logical);
      spans++;
      return `/Span <</ActualText <feff${actual}>>> BDC\n${whole}\nEMC`;
    });
    if (patched !== content) object.stream.data = Buffer.from(patched, "latin1").toString("base64");
  }
  return { document, spans, decodedWords };
}
