/**
 * Arithmetic for the assistant. Language models add and divide unreliably, so
 * any figure the answer derives (a difference, a share, a margin, a total of
 * several tool results) is computed here instead.
 *
 * A small recursive-descent parser: numbers, + - * / %, parentheses, unary
 * minus, and sum/avg/min/max/abs/round. Never eval. Thousands separators and
 * an "LKR"/"Rs" prefix are tolerated so tool output can be pasted in as-is.
 */

type Token = { t: "num"; v: number } | { t: "op"; v: string } | { t: "id"; v: string };

const FUNCS: Record<string, (args: number[]) => number> = {
  sum: (a) => a.reduce((s, x) => s + x, 0),
  avg: (a) => {
    if (a.length === 0) throw new Error("avg() needs at least one value");
    return a.reduce((s, x) => s + x, 0) / a.length;
  },
  min: (a) => {
    if (a.length === 0) throw new Error("min() needs at least one value");
    return Math.min(...a);
  },
  max: (a) => {
    if (a.length === 0) throw new Error("max() needs at least one value");
    return Math.max(...a);
  },
  abs: (a) => Math.abs(one("abs", a)),
  round: (a) => {
    if (a.length < 1 || a.length > 2) throw new Error("round(x, places) takes one or two values");
    const places = a[1] ?? 0;
    const f = 10 ** places;
    return Math.round((a[0] ?? 0) * f + Number.EPSILON * Math.sign(a[0] ?? 0)) / f;
  },
};

function one(name: string, a: number[]): number {
  if (a.length !== 1) throw new Error(`${name}() takes one value`);
  return a[0] ?? 0;
}

const MONEY = "¤";

/**
 * A comma is both a thousands separator ("1,234.50") and the argument
 * separator in sum(100,200). Outside a function call it can only be a
 * thousands separator. Inside a call a grouped number is read as one number
 * only with a currency prefix ("LKR 1,234.50" pasted from a tool); otherwise
 * it is refused rather than guessed — silently reading sum(100,200) as
 * 100200 would be a wrong figure stated as fact.
 */
function tokenize(src: string): Token[] {
  const s = src.replace(/\b(LKR|Rs\.?)\s*/gi, MONEY);
  const out: Token[] = [];
  const calls: boolean[] = [];
  let money = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === MONEY) {
      money = true;
      i++;
      continue;
    }
    const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/.exec(s.slice(i));
    if (grouped) {
      if (calls.includes(true) && !money)
        throw new Error(
          `"${grouped[0]}" is ambiguous inside a function: write amounts without thousands separators (1234.50) and separate arguments with ", "`
        );
      out.push({ t: "num", v: Number(grouped[0].replace(/,/g, "")) });
      i += grouped[0].length;
      money = false;
      continue;
    }
    if (ch !== "-") money = false; // "LKR -1,234.50" keeps its prefix
    const num = /^\d+(?:\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (num) {
      money = false;
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (ch === "(") calls.push(out[out.length - 1]?.t === "id");
    if (ch === ")") calls.pop();
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ("+-*/%(),".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return out;
}

export function evaluate(expression: string): number {
  if (expression.length > 2000) throw new Error("Expression is too long");
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    pos++;
  };

  function expr(): number {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as Token).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as Token).v;
      const r = unary();
      if ((op === "/" || op === "%") && r === 0) throw new Error("Division by zero");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function unary(): number {
    if (isOp("-")) {
      pos++;
      return -unary();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return primary();
  }
  function primary(): number {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") {
      pos++;
      return t.v;
    }
    if (t.t === "op" && t.v === "(") {
      pos++;
      const v = expr();
      expect(")");
      return v;
    }
    if (t.t === "id") {
      const fn = FUNCS[t.v];
      if (!fn) throw new Error(`Unknown function "${t.v}"`);
      pos++;
      expect("(");
      const args: number[] = [];
      if (!isOp(")")) {
        args.push(expr());
        while (isOp(",")) {
          pos++;
          args.push(expr());
        }
      }
      expect(")");
      return fn(args);
    }
    throw new Error(`Unexpected "${t.v}"`);
  }

  const v = expr();
  if (pos !== tokens.length) throw new Error(`Unexpected "${(tokens[pos] as Token).v}"`);
  if (!Number.isFinite(v)) throw new Error("Result is not a finite number");
  // Float noise (0.1 + 0.2) never reaches an answer about money.
  return Math.round(v * 1e8) / 1e8;
}
