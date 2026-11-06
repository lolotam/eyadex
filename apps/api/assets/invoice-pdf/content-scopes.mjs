import assert from "node:assert/strict";
export const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function inverse(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  assert(Math.abs(d) > 1e-12);
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export function markedScopes(s, kind = "marked") {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/[\s\0]/.test(s[i])) {
      i++;
      continue;
    }
    let start = i;
    if (s[i] === "%") {
      while (i < s.length && !/[\r\n]/.test(s[i])) i++;
      continue;
    }
    if (s[i] === "(") {
      let depth = 1;
      i++;
      while (i < s.length && depth) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === "(") depth++;
        if (s[i] === ")") depth--;
        i++;
      }
      assert.equal(depth, 0);
      tokens.push({ v: "string", start, end: i });
      continue;
    }
    if (s.slice(i, i + 2) === "<<" || s.slice(i, i + 2) === ">>") {
      i += 2;
      tokens.push({ v: s.slice(start, i), start, end: i });
      continue;
    }
    if (s[i] === "<") {
      i = s.indexOf(">", i) + 1;
      assert(i > 0);
      tokens.push({ v: "hex", start, end: i });
      continue;
    }
    if (s[i] === "/") {
      i++;
      while (i < s.length && !/[\s\0()[\]<>/%]/.test(s[i])) i++;
    } else if (/[\[\]]/.test(s[i])) i++;
    else {
      while (i < s.length && !/[\s\0()[\]<>/%]/.test(s[i])) i++;
      assert(i > start);
    }
    tokens.push({ v: s.slice(start, i), start, end: i });
  }
  const stack = [],
    scopes = [];
  const graphicsStack = [],
    graphics = [],
    textScopes = [];
  let textScope;
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n];
    if (t.v === "q") graphicsStack.push({ start: t.start, matrix: [...matrix], text: false });
    else if (t.v === "cm") {
      const values = tokens.slice(n - 6, n).map((t) => Number(t.v));
      assert(values.length === 6 && values.every(Number.isFinite));
      matrix = multiply(matrix, values);
    } else if (t.v === "BT") {
      assert(graphicsStack.length);
      graphicsStack.at(-1).text = true;
      graphicsStack.at(-1).origin = point(matrix, 0, 0);
      assert(!textScope);
      textScope = {
        start: t.start,
        matrix: [...matrix],
        origin: point(matrix, 0, 0),
        positioned: false,
      };
    } else if (t.v === "Tm" && textScope && !textScope.positioned) {
      const values = tokens.slice(n - 6, n).map((t) => Number(t.v));
      assert(values.length === 6 && values.every(Number.isFinite));
      textScope.origin = point(matrix, values[4], values[5]);
      textScope.positioned = true;
    } else if (t.v === "ET") {
      assert(textScope);
      textScopes.push({ ...textScope, end: t.end, body: s.slice(textScope.start, t.end) });
      textScope = undefined;
    } else if (t.v === "Q") {
      const g = graphicsStack.pop();
      assert(g);
      if (g.text) graphics.push({ ...g, end: t.end, body: s.slice(g.start, t.end) });
      matrix = g.matrix;
    }
    if (t.v === "BDC" || t.v === "BMC") {
      let item = null;
      if (t.v === "BDC" && tokens[n - 1]?.v === ">>") {
        let k = n - 2,
          depth = 1;
        for (; k >= 0; k--) {
          if (tokens[k].v === ">>") depth++;
          if (tokens[k].v === "<<" && !--depth) break;
        }
        const p = tokens.slice(k + 1, n - 1);
        if (p.length === 2 && p[0].v === "/MCID" && /^\d+$/.test(p[1].v)) {
          item = {
            id: Number(p[1].v),
            start: tokens[k - 1].start,
            inner: t.end,
            matrix: [...matrix],
          };
        }
      }
      stack.push(item);
    } else if (t.v === "EMC") {
      assert(stack.length);
      const item = stack.pop();
      if (item) scopes.push({ ...item, end: t.end, body: s.slice(item.inner, t.start) });
    }
  }
  assert.equal(stack.length, 0);
  assert.equal(graphicsStack.length, 0);
  return (kind === "graphics" ? textScopes : scopes).sort((a, b) => a.start - b.start);
}
