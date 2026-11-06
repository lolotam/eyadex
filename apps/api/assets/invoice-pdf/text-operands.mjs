// Deliberately limited to the text operators emitted by the pinned Typst probe.
// Unsupported syntax is refused, not interpreted as a source-word association.
export function shownText(body) {
  const tokens = [];
  const space = (c) => c !== undefined && /[\0\t\n\f\r ]/.test(c);
  const delimiter = (c) => c === undefined || space(c) || /[()[\]<>/%]/.test(c);
  let i = 0;
  while (i < body.length) {
    if (space(body[i])) {
      i++;
      continue;
    }
    if (body[i] === "%") {
      while (i < body.length && !/[\r\n]/.test(body[i])) i++;
      continue;
    }
    if (body.slice(i, i + 2) === "<<" || body.slice(i, i + 2) === ">>") {
      tokens.push(body.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (body[i] === "<") {
      const end = body.indexOf(">", i + 1);
      if (end < 0) return null;
      let hex = body.slice(i + 1, end).replace(/[\0\t\n\f\r ]/g, "");
      if (!/^[\da-f]*$/i.test(hex)) return null;
      if (hex.length % 2) hex += "0";
      if (hex.length % 4) return null;
      tokens.push(Buffer.from(hex, "hex"));
      i = end + 1;
      continue;
    }
    if (body[i] === "(") {
      const bytes = [];
      let depth = 1;
      i++;
      while (i < body.length && depth) {
        let c = body[i++];
        if (c === "\\") {
          if (i === body.length) return null;
          c = body[i++];
          if (c === "\r" || c === "\n") {
            if (c === "\r" && body[i] === "\n") i++;
            continue;
          }
          if (/[0-7]/.test(c)) {
            let oct = c;
            for (let n = 0; n < 2 && /[0-7]/.test(body[i] ?? ""); n++) oct += body[i++];
            bytes.push(parseInt(oct, 8) & 255);
          } else bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[c] ?? c.charCodeAt(0));
        } else if (c === "(") {
          depth++;
          bytes.push(40);
        } else if (c === ")") {
          if (--depth) bytes.push(41);
        } else if (c === "\r") {
          if (body[i] === "\n") i++;
          bytes.push(10);
        } else bytes.push(c.charCodeAt(0));
      }
      if (depth || bytes.length % 2 || bytes.some((b) => b > 255)) return null;
      tokens.push(Buffer.from(bytes));
      continue;
    }
    if (body[i] === "[" || body[i] === "]") {
      tokens.push(body[i++]);
      continue;
    }
    if (body[i] === ")" || body[i] === ">") return null;
    const start = i++;
    while (i < body.length && !delimiter(body[i])) i++;
    const token = body.slice(start, i);
    tokens.push(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token) ? Number(token) : token);
  }
  const operands = [],
    strings = [],
    operations = [];
  let marked = 0,
    font,
    inside = false,
    seenText = false;
  const numeric = { Tr: 1, Tm: 6, Td: 2, TD: 2, TL: 1, Tc: 1, Tw: 1, Tz: 1, Ts: 1 };
  for (const token of tokens) {
    if (Buffer.isBuffer(token) || typeof token === "number" || token.startsWith("/")) {
      operands.push(token);
      continue;
    }
    if (token === "[") {
      operands.push(token);
      continue;
    }
    if (token === "<<") {
      operands.push(token);
      continue;
    }
    if (token === ">>") {
      const start = operands.lastIndexOf("<<");
      if (start < 0) return null;
      const entries = operands.splice(start + 1);
      operands.pop();
      if (entries.length % 2) return null;
      for (let n = 0; n < entries.length; n += 2)
        if (
          !(entries[n] === "/ActualText" && Buffer.isBuffer(entries[n + 1])) &&
          !(entries[n] === "/MCID" && Number.isInteger(entries[n + 1]))
        )
          return null;
      operands.push({ dictionary: entries });
      continue;
    }
    if (token === "]") {
      const start = operands.lastIndexOf("[");
      if (start < 0) return null;
      const values = operands.splice(start);
      values.shift();
      if (!values.every((v) => Buffer.isBuffer(v) || typeof v === "number")) return null;
      operands.push(values);
      continue;
    }
    if (token === "BMC") {
      if (operands.length !== 1 || operands[0] !== "/ReversedChars") return null;
      marked++;
    } else if (token === "BDC") {
      if (operands.length !== 2 || operands[0] !== "/Span" || !operands[1]?.dictionary) return null;
      marked++;
    } else if (token === "EMC") {
      if (operands.length || !marked) return null;
      marked--;
    } else if (token === "BT" || token === "ET") {
      if (operands.length || (token === "BT" ? inside || seenText : !inside)) return null;
      inside = token === "BT";
      seenText = true;
    } else if (token === "Tf") {
      if (!inside) return null;
      if (
        operands.length !== 2 ||
        typeof operands[0] !== "string" ||
        !operands[0].startsWith("/") ||
        typeof operands[1] !== "number"
      )
        return null;
      if (font && font !== operands[0]) return null;
      font = operands[0];
    } else if (token === "Tj" || token === "'" || token === '"') {
      if (!inside) return null;
      const count = token === '"' ? 3 : 1;
      if (
        !font ||
        operands.length !== count ||
        !Buffer.isBuffer(operands.at(-1)) ||
        !operands.slice(0, -1).every((v) => typeof v === "number")
      )
        return null;
      strings.push(operands.at(-1));
    } else if (token === "TJ") {
      if (!inside) return null;
      if (!font || operands.length !== 1 || !Array.isArray(operands[0])) return null;
      strings.push(...operands[0].filter(Buffer.isBuffer));
    } else if (token === "T*") {
      if (!inside || operands.length) return null;
    } else if (Object.hasOwn(numeric, token)) {
      if (!inside) return null;
      if (operands.length !== numeric[token] || !operands.every((v) => typeof v === "number"))
        return null;
    } else return null;
    operations.push({ operator: token, operands: [...operands] });
    operands.length = 0;
  }
  if (!seenText || inside || marked || operands.length || !font || !strings.length) return null;
  return { font, strings, operations };
}
