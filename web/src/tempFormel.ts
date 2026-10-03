// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Minimaler, sicherer Auswerter für die Warmwasser-Wärmeformel im Frontend.
// Unterstützt Zahlen, die Variablen T_u und T_o, die Operatoren + - * /,
// unäres Minus und Klammern. Kein eval, keine sonstigen Bezeichner.
//
// Der Server bleibt die maßgebliche Instanz (validiert und berechnet die
// KPI-Kachel); dieser Auswerter dient nur der Live-Anzeige im Chart-Tooltip.

type Tok = { t: "num"; v: number } | { t: "var"; v: string } | { t: "op"; v: string } | { t: "("; } | { t: ")"; };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/") { out.push({ t: "op", v: c }); i++; continue; }
    if (isDigit(c) || c === ".") {
      let j = i + 1;
      while (j < src.length && (isDigit(src[j]) || src[j] === ".")) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) return null;
      out.push({ t: "num", v: num }); i = j; continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < src.length && (isAlpha(src[j]) || isDigit(src[j]))) j++;
      out.push({ t: "var", v: src.slice(i, j) }); i = j; continue;
    }
    return null; // unbekanntes Zeichen
  }
  return out;
}

// Auswertung per rekursivem Abstieg (Punkt- vor Strichrechnung, unäres Minus).
export function evalTempFormel(src: string, vars: Record<string, number>): number | null {
  const toks = tokenize(src);
  if (!toks) return null;
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (peek() && peek().t === "op" && ((peek() as any).v === "+" || (peek() as any).v === "-")) {
      const op = (eat() as any).v;
      const right = parseTerm();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left == null) return null;
    while (peek() && peek().t === "op" && ((peek() as any).v === "*" || (peek() as any).v === "/")) {
      const op = (eat() as any).v;
      const right = parseFactor();
      if (right == null) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parseFactor(): number | null {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === "op" && (tk as any).v === "-") { eat(); const f = parseFactor(); return f == null ? null : -f; }
    if (tk.t === "op" && (tk as any).v === "+") { eat(); return parseFactor(); }
    if (tk.t === "(") {
      eat();
      const e = parseExpr();
      if (e == null || !peek() || peek().t !== ")") return null;
      eat();
      return e;
    }
    if (tk.t === "num") { eat(); return (tk as any).v; }
    if (tk.t === "var") {
      eat();
      const name = (tk as any).v as string;
      if (name in vars && Number.isFinite(vars[name])) return vars[name];
      return null; // unbekannte Variable
    }
    return null;
  }

  const result = parseExpr();
  if (result == null || pos !== toks.length || !Number.isFinite(result)) return null;
  return result;
}
