import assert from "node:assert/strict";
import { prepareArtifacts } from "./artifacts.mjs";
import { markedScopes, multiply, inverse, point } from "./content-scopes.mjs";
import { extractionSequences } from "./unicode-order.mjs";
import { wordId } from "./word-id.mjs";
export function bind(document, words) {
  const objects = document.qpdf[1],
    resolve = (v) => (typeof v === "string" ? objects["obj:" + v]?.value : v);
  const root = Object.values(objects).find((o) => o.value?.["/Type"] === "/StructTreeRoot").value;
  const parentPairs = new Map();
  function readParents(v) {
    const n = resolve(v);
    for (let i = 0; i < (n["/Nums"] ?? []).length; i += 2)
      parentPairs.set(n["/Nums"][i], n["/Nums"][i + 1]);
    for (const k of n["/Kids"] ?? []) readParents(k);
  }
  readParents(root["/ParentTree"]);
  let next =
    Math.max(...Object.keys(objects).map((k) => Number(k.match(/^obj:(\d+)/)?.[1] ?? 0))) + 1;
  const streams = new Map();
  const add = (o) => {
      const r = `${next++} 0 R`;
      objects["obj:" + r] = o;
      return r;
    },
    stream = (s, share = true) => {
      if (share && streams.has(s)) return streams.get(s);
      const ref = add({ stream: { dict: {}, data: Buffer.from(s, "latin1").toString("base64") } });
      if (share) streams.set(s, ref);
      return ref;
    };
  const hex = (s) => Buffer.from(s, "utf16le").swap16().toString("hex");
  let corrected = 0;
  const boundIds = new Set();
  for (const [pageRef, pageObj] of Object.entries(objects).filter(
    ([k, o]) => o.value?.["/Type"] === "/Page",
  )) {
    const page = pageObj.value;
    const refs = [page["/Contents"]].flat();
    assert.equal(refs.length, 1);
    const target = objects["obj:" + refs[0]];
    let text = Buffer.from(target.stream.data, "base64").toString("latin1");
    const pageParents = resolve(parentPairs.get(page["/StructParents"]));
    assert(Array.isArray(pageParents));
    const artifacts = prepareArtifacts({
      objects,
      page,
      pageRef: pageRef.slice(4),
      text,
      marked: markedScopes(text),
      graphics: markedScopes(text, "graphics"),
      parents: pageParents,
      add,
      words,
    });
    text = artifacts.text;
    const scopes = markedScopes(text),
      byId = new Map(scopes.map((s) => [s.id, s]));
    assert.equal(byId.size, scopes.length);
    const originalResources = structuredClone(resolve(page["/Resources"]));
    originalResources["/Font"] = structuredClone(resolve(originalResources["/Font"]));
    const resources = structuredClone(originalResources);
    page["/Resources"] = resources;
    const changes = [],
      removedAnnots = new Set();
    for (const [key, o] of Object.entries(objects).filter(
      ([k, o]) => o.value?.["/S"] === "/Link" && o.value?.["/Pg"] === pageRef.slice(4),
    )) {
      const node = o.value,
        children = [node["/K"]].flat();
      const objrs = children.filter((v) => v?.["/Type"] === "/OBJR");
      assert(objrs.length);
      const annotations = objrs.map((r) => resolve(r["/Obj"]));
      const annot = annotations[0];
      const uri = annot?.["/A"]?.["/URI"];
      if (!uri?.startsWith("u:urn:e:")) continue;
      const id = wordId(uri),
        word = words[id];
      assert(annotations.every((a) => a["/A"]["/URI"] === uri));
      assert(word);
      const encoded = extractionSequences(word);
      boundIds.add(id);
      const ids = children.filter(Number.isInteger);
      assert(ids.length);
      for (const objr of objrs) {
        removedAnnots.add(objr["/Obj"]);
        parentPairs.delete(resolve(objr["/Obj"])["/StructParent"]);
      }
      node["/S"] = "/Span";
      node["/K"] = ids;
      const wrapped = new Set(annotations.map((a) => a["/Rect"][1])).size > 1;
      // Preserve already-correct simple ASCII text. Punctuation-rich tokens and
      // wrapped words need one binding so extractors cannot split their text.
      if (!wrapped && /^[A-Za-z0-9.,:/-]+$/.test(word)) {
        for (const id of ids)
          if (artifacts.syntheticIds.has(id)) {
            const p = byId.get(id);
            changes.push({ start: p.start, end: p.end, value: p.body });
          }
        continue;
      }
      const parts = ids
        .map((id) => {
          assert(byId.has(id));
          return byId.get(id);
        })
        .sort((a, b) => a.start - b.start);
      assert(
        !scopes.some(
          (scope) =>
            scope.start >= parts[0].start &&
            scope.end <= parts.at(-1).end &&
            !ids.includes(scope.id),
        ),
        "interleaved word scope:" + id,
      );
      const rect = [
          Math.min(...annotations.map((a) => a["/Rect"][0])),
          Math.min(...annotations.map((a) => a["/Rect"][1])),
          Math.max(...annotations.map((a) => a["/Rect"][2])),
          Math.max(...annotations.map((a) => a["/Rect"][3])),
        ],
        parent = parts[0].matrix,
        unparent = inverse(parent);
      assert(
        parent[1] === 0 && parent[2] === 0 && parent[0] > 0 && parent[3] !== 0,
        "unsupported transformed word",
      );
      const [x, y] = point(unparent, rect[0], rect[1]);
      const [right, top] = point(unparent, rect[2], rect[3]),
        width = right - x;
      const flip = Math.sign(parent[3]);
      const originalDrawing = parts
        .map((p) => `q ${multiply(unparent, p.matrix).join(" ")} cm\n${p.body}\nQ`)
        .join("\n");
      const actual = encoded.actual;
      let points = encoded.points;
      if (points.length > 255) {
        const groups = [];
        let group = "";
        for (const point of points) {
          if ((group.length + point.length) * 2 > 512) {
            groups.push(group);
            group = "";
          }
          group += point;
        }
        if (group) groups.push(group);
        points = groups;
      }
      assert(
        points.every((point) => point.length * 2 <= 512),
        "ToUnicode destination too long",
      );
      const procs = {},
        widths = [],
        differences = [1];
      let assigned = false;
      for (let n = 0; n < points.length; n++) {
        let w = !assigned && /[^\p{M}\p{Cf}]/u.test(points[n]) ? width : 0;
        if (w) assigned = true;
        const name = "/g" + n;
        procs[name] = stream(
          `${w} 0 d0\n${n === 0 ? `1 0 0 ${flip} 0 0 cm\n1 0 0 1 ${-x} ${-y} cm\n` + originalDrawing : ""}`,
        );
        widths.push(w);
        differences.push(name);
      }
      const code = (n) => (n + 1).toString(16).padStart(2, "0");
      assert(points.length < 256);
      const cmap = stream(
        `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /BoundWord def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${points.length} beginbfchar\n${points.map((p, n) => `<${code(n)}> <${hex(p)}>`).join("\n")}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`,
      );
      const bbox = [0, 0, width, Math.abs(top - y)],
        descriptor = add({
          value: {
            "/Type": "/FontDescriptor",
            "/FontName": "/BoundWord",
            "/Flags": 4,
            "/FontBBox": bbox,
            "/ItalicAngle": 0,
            "/Ascent": bbox[3],
            "/Descent": bbox[1],
            "/CapHeight": bbox[3],
            "/StemV": 1,
          },
        });
      const font = add({
          value: {
            "/Type": "/Font",
            "/Subtype": "/Type3",
            "/FontBBox": bbox,
            "/FontMatrix": [1, 0, 0, 1, 0, 0],
            "/FontDescriptor": descriptor,
            "/CharProcs": procs,
            "/Encoding": { "/Type": "/Encoding", "/Differences": differences },
            "/FirstChar": 1,
            "/LastChar": points.length,
            "/Widths": widths,
            "/Resources": originalResources,
            "/ToUnicode": cmap,
          },
        }),
        tag = "/bound" + corrected++;
      resources["/Font"][tag] = font;
      const form = stream(
        `BT ${tag} 1 Tf 1 0 0 ${flip} ${x} ${y} Tm <${points.map((_, n) => code(n)).join("")}> Tj ET`,
        false,
      );
      objects["obj:" + form].stream.dict = {
        "/Type": "/XObject",
        "/Subtype": "/Form",
        "/FormType": 1,
        "/BBox": [-10000, -10000, 10000, 10000],
        "/Resources": { "/Font": { [tag]: font } },
      };
      resources["/XObject"] ??= {};
      resources["/XObject"][tag] = form;
      const mcid = artifacts.syntheticIds.has(parts[0].id) ? "" : `/MCID ${parts[0].id} `;
      const replacement = `/Span <<${mcid}/ActualText <feff${hex(actual)}>>> BDC\n${tag} Do\nEMC`;
      changes.push({ start: parts[0].start, end: parts[0].end, value: replacement });
      for (const part of parts.slice(1))
        changes.push({ start: part.start, end: part.end, value: "" });
      node["/K"] = parts[0].id;
      const parents = resolve(parentPairs.get(page["/StructParents"]));
      assert(Array.isArray(parents));
      for (const part of parts.slice(1)) parents[part.id] = null;
    }
    let output = text;
    for (const c of changes.sort((a, b) => b.start - a.start))
      output = output.slice(0, c.start) + c.value + output.slice(c.end);
    target.stream.data = Buffer.from(output, "latin1").toString("base64");
    page["/Annots"] = (page["/Annots"] ?? []).filter((r) => !removedAnnots.has(r));
    for (const ref of removedAnnots) delete objects["obj:" + ref];
    for (const ref of artifacts.nodes) delete objects["obj:" + ref];
    pageParents.length = artifacts.originalLength;
  }
  root["/ParentTree"] = { "/Nums": [...parentPairs].sort((a, b) => a[0] - b[0]).flat() };
  assert.deepEqual(
    [...boundIds].sort(),
    Object.keys(words).sort(),
    "allocated word missing from PDF",
  );
  return { document, corrected };
}
