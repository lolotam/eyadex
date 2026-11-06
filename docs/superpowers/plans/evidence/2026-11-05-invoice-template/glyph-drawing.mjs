import assert from "node:assert/strict";
import { markedScopes, multiply, point } from "./content-scopes.mjs";
import { orderedPages } from "./page-order.mjs";
import { shownText } from "./text-operands.mjs";
import { wordId } from "./word-id.mjs";

// Preserve drawing glyph IDs and coordinates without reading ToUnicode/ActualText.
export function glyphDrawings(document, words, records) {
  const objects = document.qpdf[1];
  const resolve = (v) => (typeof v === "string" ? objects["obj:" + v]?.value : v);
  const fonts = {},
    result = [];
  const fontWidths = new Map();
  const weights = Object.fromEntries(records.flatMap((r) => r.ids.map((id) => [id, r.weight])));
  const languages = Object.fromEntries(records.flatMap((r) => r.ids.map((id) => [id, r.lang])));
  function draw(scope, resources) {
    const parsed = shownText(scope.body);
    assert(parsed, "unsupported drawing text");
    const fontRef = resolve(resources["/Font"])[parsed.font],
      font = resolve(fontRef);
    const cid = resolve(font["/DescendantFonts"]?.[0]);
    assert(
      cid?.["/Subtype"] === "/CIDFontType2" && cid["/CIDToGIDMap"] === "/Identity",
      "unsupported glyph font",
    );
    const descriptor = resolve(cid["/FontDescriptor"]);
    fonts[fontRef] = objects["obj:" + descriptor["/FontFile2"]].stream.data;
    if (!fontWidths.has(fontRef)) {
      const widths = new Map(),
        ranges = cid["/W"] ?? [];
      for (let i = 0; i < ranges.length;) {
        const first = ranges[i++],
          next = ranges[i++];
        if (Array.isArray(next)) next.forEach((width, index) => widths.set(first + index, width));
        else {
          const width = ranges[i++];
          for (let code = first; code <= next; code++) widths.set(code, width);
        }
      }
      fontWidths.set(fontRef, widths);
    }
    const widths = fontWidths.get(fontRef);
    let size,
      matrix,
      cursor = 0;
    const glyphs = [];
    const show = (bytes) => {
      assert(size > 0 && matrix && bytes.length % 2 === 0, "invalid glyph position");
      const transform = multiply(scope.matrix, matrix);
      assert(
        transform.slice(0, 4).every((v, i) => Math.abs(v - [1, 0, 0, 1][i]) < 1e-6),
        "unsupported glyph transform",
      );
      for (let offset = 0; offset < bytes.length; offset += 2) {
        const gid = bytes.readUInt16BE(offset),
          [x, y] = point(transform, cursor, 0);
        glyphs.push({ font: fontRef, gid, x, y, size });
        cursor += ((widths.get(gid) ?? cid["/DW"] ?? 1000) * size) / 1000;
      }
    };
    for (const op of parsed.operations) {
      const a = op.operands;
      if (op.operator === "Tf") size = a[1];
      else if (op.operator === "Tm") {
        matrix = a;
        cursor = 0;
      } else if (op.operator === "Tj") show(a[0]);
      else if (op.operator === "TJ")
        for (const value of a[0]) {
          if (typeof value === "number") cursor -= (value * size) / 1000;
          else show(value);
        }
      else if (op.operator === "Tr") assert(a[0] === 0, "unsupported glyph rendering mode");
      else
        assert(
          ["BT", "ET", "Tr", "BDC", "BMC", "EMC"].includes(op.operator),
          "unsupported glyph positioning",
        );
    }
    return glyphs;
  }
  const pages = orderedPages(document);
  for (const [pageIndex, [pageRef, { value: page }]] of pages.entries()) {
    const refs = [page["/Contents"]].flat();
    assert(refs.length === 1);
    const text = Buffer.from(objects["obj:" + refs[0]].stream.data, "base64").toString("latin1");
    const marked = markedScopes(text),
      graphics = markedScopes(text, "graphics");
    const resources = resolve(page["/Resources"]),
      owned = new Set();
    const groups = new Map();
    for (const ref of page["/Annots"] ?? []) {
      const annotation = resolve(ref),
        uri = annotation?.["/A"]?.["/URI"];
      if (!uri?.startsWith("u:urn:e:")) continue;
      const id = wordId(uri),
        group = groups.get(id) ?? [];
      group.push({ ref, annotation });
      groups.set(id, group);
    }
    const byAnnotation = new Map();
    for (const object of Object.values(objects)) {
      const node = object.value;
      if (node?.["/S"] !== "/Link" || node["/Pg"] !== pageRef.slice(4)) continue;
      const children = [node["/K"]].flat();
      for (const child of children)
        if (child?.["/Type"] === "/OBJR")
          byAnnotation.set(child["/Obj"], children.filter(Number.isInteger));
    }
    const byId = new Map(marked.map((scope) => [scope.id, scope]));
    const inSpan = (span) => {
      let lo = 0,
        hi = graphics.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (graphics[mid].start < span.start) lo = mid + 1;
        else hi = mid;
      }
      const found = [];
      while (lo < graphics.length && graphics[lo].start < span.end) {
        if (graphics[lo].end <= span.end) found.push(graphics[lo]);
        lo++;
      }
      return found;
    };
    const structured = new Set(marked.flatMap(inSpan).map((scope) => scope.start));
    const unmarked = graphics.filter((scope) => !structured.has(scope.start));
    for (const [id, annotations] of groups) {
      const ids = [...new Set(annotations.flatMap((a) => byAnnotation.get(a.ref) ?? []))];
      const spans = ids.map((id) => byId.get(id));
      assert(spans.every(Boolean), "missing word scope");
      const selected = spans.length
        ? spans.flatMap(inSpan)
        : unmarked.filter((g) =>
            annotations.some(({ annotation: a }) => {
              const [l, b, r, t] = a["/Rect"],
                [x, y] = g.origin;
              return x >= l - 0.001 && x <= r + 0.001 && y >= b - 0.001 && y <= t + 0.001;
            }),
          );
      assert(selected.length, "missing word drawing");
      for (const scope of selected) {
        assert(!owned.has(scope.start), "ambiguous word drawing");
        owned.add(scope.start);
      }
      result.push({
        id,
        word: words[id],
        weight: weights[id],
        lang: languages[id],
        rects: annotations.map(({ annotation }) => annotation["/Rect"]),
        glyphs: selected.flatMap((s) => draw(s, resources)),
      });
    }
    // The page counter is the only visible text outside allocated word fields.
    const counter = graphics.filter((scope) => !owned.has(scope.start));
    assert(counter.length, "missing page counter drawing");
    result.push({
      id: `counter-${pageIndex + 1}`,
      word: `${pageIndex + 1} / ${pages.length}`,
      weight: "regular",
      lang: "en",
      rects: [page["/MediaBox"]],
      glyphs: counter.flatMap((scope) => draw(scope, resources)),
    });
  }
  return { fonts, words: result };
}
