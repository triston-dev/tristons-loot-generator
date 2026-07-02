const TOKEN = /\s*(\d+d\d+|\d+\.?\d*|@[a-zA-Z_]\w*|[()+\-*/])/y;

function tokenize(formula) {
  const tokens = [];
  let pos = 0;
  while (pos < formula.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(formula);
    if (!m) {
      if (/^\s*$/.test(formula.slice(pos))) break;
      throw new Error("TLG.Dice.Invalid");
    }
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  if (!tokens.length) throw new Error("TLG.Dice.Invalid");
  return tokens;
}

export function evaluateDice(formula, data = {}, rng = Math.random) {
  const tokens = tokenize(String(formula));
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary() {
    const t = next();
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Error("TLG.Dice.Invalid"); return v; }
    if (t === "-") return -primary();
    if (/^\d+d\d+$/.test(t)) {
      const [n, m] = t.split("d").map(Number);
      if (n < 1 || n > 100 || m < 1 || m > 1000) throw new Error("TLG.Dice.Invalid");
      let sum = 0;
      for (let k = 0; k < n; k++) sum += 1 + Math.floor(rng() * m);
      return sum;
    }
    if (/^@/.test(t)) return Number(data[t.slice(1)]) || 0;
    if (/^\d/.test(t)) return Number(t);
    throw new Error("TLG.Dice.Invalid");
  }
  function term() {
    let v = primary();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * primary() : v / primary();
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
    return v;
  }
  const out = expr();
  if (i !== tokens.length || Number.isNaN(out)) throw new Error("TLG.Dice.Invalid");
  return Math.max(0, Math.floor(out));
}

export function validateDice(formula) {
  try { evaluateDice(formula, {}, () => 0.5); return true; } catch { return false; }
}
