// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Kleiner, sicherer Ausdrucks-Evaluator für benutzerdefinierte Senken-Formeln.
//
// Bewusst OHNE eval / Function-Konstruktor und ohne externe Abhängigkeit:
// Ausdrücke werden per Shunting-Yard in RPN übersetzt und dann ausgewertet.
// Unterstützt:
//   - Zahlen (auch Dezimal mit . )
//   - Variablen (Bezeichner aus Buchstaben, Ziffern, _), Werte per Kontext
//   - Operatoren + - * / % und unäres Minus, Klammern ( )
//   - Funktionen: min, max, abs, clamp(x,lo,hi), round
//
// Rückgabe von evalFormula: { ok, value } oder { ok:false, error }.
// validateFormula prüft nur die Syntax (mit Dummy-Werten für alle Variablen).

type Token =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: string }
  | { t: "func"; v: string }
  | { t: "comma" }
  | { t: "lpar" }
  | { t: "rpar" };

const FUNCS = new Set(["min", "max", "abs", "clamp", "round"]);
const OPS: Record<string, { prec: number; assoc: "l" | "r"; args: 2 }> = {
  "+": { prec: 1, assoc: "l", args: 2 },
  "-": { prec: 1, assoc: "l", args: 2 },
  "*": { prec: 2, assoc: "l", args: 2 },
  "/": { prec: 2, assoc: "l", args: 2 },
  "%": { prec: 2, assoc: "l", args: 2 },
};

function tokenize(expr: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr;
  // Zum Erkennen von unärem Minus: merken, ob der letzte Token ein Wert/rpar war.
  const prevIsValue = () => {
    const p = tokens[tokens.length - 1];
    return p && (p.t === "num" || p.t === "var" || p.t === "rpar");
  };
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c >= "0" && c <= "9" || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let j = i + 1;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      const num = Number(s.slice(i, j));
      if (!isFinite(num)) return { error: `ungültige Zahl bei Position ${i}` };
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i, j);
      // Funktion, wenn direkt eine Klammer folgt
      let k = j;
      while (k < s.length && s[k] === " ") k++;
      if (s[k] === "(" && FUNCS.has(name)) tokens.push({ t: "func", v: name });
      else tokens.push({ t: "var", v: name });
      i = j;
      continue;
    }
    if (c === "(") { tokens.push({ t: "lpar" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rpar" }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }
    if ("+-*/%".includes(c)) {
      // Unäres Minus/Plus -> als (0 - x) bzw. neutral behandeln
      if ((c === "-" || c === "+") && !prevIsValue()) {
        // unäres Vorzeichen: 0 voranstellen
        tokens.push({ t: "num", v: 0 });
      }
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    return { error: `unerwartetes Zeichen „${c}" bei Position ${i}` };
  }
  return tokens;
}

function toRPN(tokens: Token[]): Token[] | { error: string } {
  const out: Token[] = [];
  const stack: Token[] = [];
  for (const tk of tokens) {
    if (tk.t === "num" || tk.t === "var") out.push(tk);
    else if (tk.t === "func") stack.push(tk);
    else if (tk.t === "comma") {
      while (stack.length && stack[stack.length - 1].t !== "lpar") out.push(stack.pop()!);
      if (!stack.length) return { error: "Komma außerhalb einer Funktion" };
    } else if (tk.t === "op") {
      const o1 = OPS[tk.v];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "op") {
          const o2 = OPS[top.v];
          if ((o1.assoc === "l" && o1.prec <= o2.prec) || (o1.assoc === "r" && o1.prec < o2.prec)) {
            out.push(stack.pop()!);
            continue;
          }
        }
        break;
      }
      stack.push(tk);
    } else if (tk.t === "lpar") stack.push(tk);
    else if (tk.t === "rpar") {
      while (stack.length && stack[stack.length - 1].t !== "lpar") out.push(stack.pop()!);
      if (!stack.length) return { error: "unbalancierte Klammern" };
      stack.pop(); // lpar entfernen
      if (stack.length && stack[stack.length - 1].t === "func") out.push(stack.pop()!);
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lpar" || top.t === "rpar") return { error: "unbalancierte Klammern" };
    out.push(top);
  }
  return out;
}

function evalRPN(rpn: Token[], vars: Record<string, number>): { ok: true; value: number } | { ok: false; error: string } {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.t === "num") st.push(tk.v);
    else if (tk.t === "var") {
      if (!(tk.v in vars)) return { ok: false, error: `unbekannte Variable „${tk.v}"` };
      st.push(vars[tk.v]);
    } else if (tk.t === "op") {
      if (st.length < 2) return { ok: false, error: "Formel unvollständig" };
      const b = st.pop()!, a = st.pop()!;
      let r: number;
      switch (tk.v) {
        case "+": r = a + b; break;
        case "-": r = a - b; break;
        case "*": r = a * b; break;
        case "/": r = b === 0 ? 0 : a / b; break;
        case "%": r = b === 0 ? 0 : a % b; break;
        default: return { ok: false, error: `unbekannter Operator ${tk.v}` };
      }
      st.push(r);
    } else if (tk.t === "func") {
      switch (tk.v) {
        case "abs": {
          if (st.length < 1) return { ok: false, error: "abs() erwartet 1 Argument" };
          st.push(Math.abs(st.pop()!));
          break;
        }
        case "round": {
          if (st.length < 1) return { ok: false, error: "round() erwartet 1 Argument" };
          st.push(Math.round(st.pop()!));
          break;
        }
        case "min": {
          if (st.length < 2) return { ok: false, error: "min() erwartet 2 Argumente" };
          const b = st.pop()!, a = st.pop()!;
          st.push(Math.min(a, b));
          break;
        }
        case "max": {
          if (st.length < 2) return { ok: false, error: "max() erwartet 2 Argumente" };
          const b = st.pop()!, a = st.pop()!;
          st.push(Math.max(a, b));
          break;
        }
        case "clamp": {
          if (st.length < 3) return { ok: false, error: "clamp() erwartet 3 Argumente" };
          const hi = st.pop()!, lo = st.pop()!, x = st.pop()!;
          st.push(Math.min(hi, Math.max(lo, x)));
          break;
        }
        default:
          return { ok: false, error: `unbekannte Funktion ${tk.v}` };
      }
    }
  }
  if (st.length !== 1) return { ok: false, error: "Formel unvollständig oder fehlerhaft" };
  const v = st[0];
  if (!isFinite(v)) return { ok: false, error: "Ergebnis ist keine gültige Zahl" };
  return { ok: true, value: v };
}

// Wertet eine Formel mit gegebenen Variablenwerten aus.
export function evalFormula(expr: string, vars: Record<string, number>): { ok: true; value: number } | { ok: false; error: string } {
  if (!expr || !expr.trim()) return { ok: false, error: "leere Formel" };
  const toks = tokenize(expr);
  if ("error" in toks) return { ok: false, error: toks.error };
  const rpn = toRPN(toks);
  if ("error" in rpn) return { ok: false, error: rpn.error };
  return evalRPN(rpn, vars);
}

// Prüft nur die Syntax (alle bekannten Variablen mit 0 belegt). Liefert die Liste
// der in der Formel verwendeten Variablennamen zurück (für Validierung gegen die
// erlaubten Namen).
export function validateFormula(
  expr: string,
  knownVars: string[]
): { ok: true; usedVars: string[] } | { ok: false; error: string } {
  if (!expr || !expr.trim()) return { ok: false, error: "leere Formel" };
  const toks = tokenize(expr);
  if ("error" in toks) return { ok: false, error: toks.error };
  const used = new Set<string>();
  for (const t of toks) if (t.t === "var") used.add(t.v);
  // Unbekannte Variablen melden
  const unknown = [...used].filter((v) => !knownVars.includes(v));
  if (unknown.length) return { ok: false, error: `unbekannte Variable(n): ${unknown.join(", ")}` };
  // Testauswertung mit Dummy-Werten
  const dummy: Record<string, number> = {};
  for (const v of knownVars) dummy[v] = 1;
  const rpn = toRPN(toks);
  if ("error" in rpn) return { ok: false, error: rpn.error };
  const res = evalRPN(rpn, dummy);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, usedVars: [...used] };
}
