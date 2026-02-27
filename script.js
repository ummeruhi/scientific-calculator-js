const screen = document.getElementById("screen");
const historyLine = document.getElementById("historyLine");
const errorLine = document.getElementById("errorLine");

const angleBtn = document.getElementById("angleBtn");
const secondBtn = document.getElementById("secondBtn");
const themeBtn = document.getElementById("themeBtn");

const memBadge = document.getElementById("memBadge");
const modeBadge = document.getElementById("modeBadge");
const secondBadge = document.getElementById("secondBadge");

const pad = document.querySelector(".pad");
const historyList = document.getElementById("historyList");
const historyClearBtn = document.getElementById("historyClearBtn");

let mode = "DEG";        // DEG / RAD
let second = false;      // 2nd toggle
let memory = 0;
let ans = 0;

const HISTORY_KEY = "sci_calc_history_v1";
const THEME_KEY = "sci_calc_theme_v1";

screen.value = "";

/* =========================
   UI helpers
========================= */
function setHistoryLine(text = "") { historyLine.textContent = text; }
function setError(text = "") { errorLine.textContent = text; }

function setMemBadge() {
  if (memory !== 0) memBadge.classList.remove("hidden");
  else memBadge.classList.add("hidden");
}

function insertAtCursor(text, cursorOffsetFromEnd = 0) {
  const start = screen.selectionStart ?? screen.value.length;
  const end = screen.selectionEnd ?? screen.value.length;
  const before = screen.value.slice(0, start);
  const after = screen.value.slice(end);

  screen.value = before + text + after;

  const pos = before.length + text.length - cursorOffsetFromEnd;
  screen.setSelectionRange(pos, pos);
  screen.focus();
}

function insertFunctionCall(name) {
  // Inserts name() and places cursor inside
  insertAtCursor(`${name}()`, 1);
}

function insertTwoArgFunction(name) {
  // Inserts name( , ) and places cursor at first slot
  insertAtCursor(`${name}( , )`, 4);
}

function autoCloseParens(expr) {
  const opens = (expr.match(/\(/g) || []).length;
  const closes = (expr.match(/\)/g) || []).length;
  return expr + ")".repeat(Math.max(0, opens - closes));
}

/* =========================
   Formatting
========================= */
function formatNumber(n) {
  if (typeof n !== "number") return String(n);
  if (!Number.isFinite(n)) return String(n);

  // reduce float noise
  const rounded = Math.round((n + Number.EPSILON) * 1e12) / 1e12;

  // format with commas (but keep decimals)
  const parts = rounded.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/* =========================
   Math core (safe-ish eval)
========================= */
function factorial(x) {
  if (!Number.isFinite(x)) return NaN;
  if (x < 0) return NaN;
  if (!Number.isInteger(x)) return NaN;
  if (x > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return r;
}

function toRad(x) { return mode === "DEG" ? (x * Math.PI) / 180 : x; }
function fromRad(x) { return mode === "DEG" ? (x * 180) / Math.PI : x; }

function normalizePercent(expr) {
  // 200 + 10% => 200 + (200*10/100)
  expr = expr.replace(/(\d+(\.\d+)?)\s*([+\-])\s*(\d+(\.\d+)?)%/g, (_, A, _a2, op, B) => {
    return `${A} ${op} (${A}*(${B}/100))`;
  });
  // 200 * 10% => 200 * (10/100)
  expr = expr.replace(/(\d+(\.\d+)?)\s*([*/])\s*(\d+(\.\d+)?)%/g, (_, A, _a2, op, B) => {
    return `${A} ${op} (${B}/100)`;
  });
  // standalone 10% => 10/100
  expr = expr.replace(/(\d+(\.\d+)?)%/g, "($1/100)");
  return expr;
}

function normalizeFactorial(expr) {
  // number! => fact(number)
  return expr.replace(/(\d+(\.\d+)?)!/g, (_, n) => `fact(${n})`);
}

function isSafeExpression(expr) {
  // allow digits, operators, parentheses, decimals, commas, %, !, identifiers, constants
  return /^[0-9+\-*/().,%!\sA-Za-z_πe×÷−^]+$/.test(expr);
}

function tokenize(expr) {
  return expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/\be\b/g, "E")
    .replace(/\^/g, "**"); // allow caret as power
}

function safeEval(rawExpr) {
  let expr = rawExpr.trim();
  if (!expr) return 0;

  if (!isSafeExpression(expr)) {
    throw new Error("Invalid characters");
  }

  expr = tokenize(expr);
  expr = normalizePercent(expr);
  expr = normalizeFactorial(expr);

  const scope = {
    pi: Math.PI,
    E: Math.E,
    ans: ans,

    sin: (x) => Math.sin(toRad(x)),
    cos: (x) => Math.cos(toRad(x)),
    tan: (x) => Math.tan(toRad(x)),

    asin: (x) => fromRad(Math.asin(x)),
    acos: (x) => fromRad(Math.acos(x)),
    atan: (x) => fromRad(Math.atan(x)),

    ln: (x) => Math.log(x),
    log: (x) => Math.log10(x),

    exp: (x) => Math.exp(x),         // e^x
    pow10: (x) => Math.pow(10, x),    // 10^x

    sqrt: (x) => Math.sqrt(x),
    inv: (x) => 1 / x,

    pow: (a, b) => Math.pow(a, b),
    fact: (x) => factorial(x),
  };

  const fn = Function("scope", `"use strict";
    const {pi,E,ans,sin,cos,tan,asin,acos,atan,ln,log,exp,pow10,sqrt,inv,pow,fact} = scope;
    return (${expr});
  `);

  const result = fn(scope);
  return result;
}

/* =========================
   Smart errors
========================= */
function smartError(expr, err) {
  const e = (err && err.message) ? err.message : "Error";

  if (e.includes("Invalid characters")) return "Invalid characters";
  if (/\/\s*0(?!\d)/.test(expr) || expr.includes("/0")) return "Division by zero";
  if (expr.includes("fact(") && expr.match(/fact\(([^)]+)\)/)) {
    // factorial invalid cases
    const m = expr.match(/fact\(([^)]+)\)/);
    if (m && m[1] && m[1].includes(".")) return "Factorial needs an integer";
  }
  return "Invalid expression";
}

/* =========================
   History storage + render
========================= */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 40)));
}

function renderHistory() {
  const items = loadHistory();
  historyList.innerHTML = "";

  if (!items.length) {
    historyList.innerHTML = `<div class="muted">No history yet.</div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="expr">${escapeHtml(it.expr)}</div>
      <div class="res">${escapeHtml(it.res)}</div>
    `;
    div.addEventListener("click", () => {
      setError("");
      setHistoryLine(it.expr + " =");
      screen.value = it.res.replace(/,/g, ""); // keep editable
      screen.focus();
    });
    historyList.appendChild(div);
  }
}

function addToHistory(expr, res) {
  const items = loadHistory();
  items.unshift({ expr, res, t: Date.now() });
  saveHistory(items);
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   Actions
========================= */
function doEquals() {
  setError("");

  const raw = screen.value;
  const expr = autoCloseParens(raw);
  screen.value = expr;

  try {
    const result = safeEval(expr);

    // Detect NaN & infinities cleanly
    if (Number.isNaN(result)) throw new Error("NaN");
    if (!Number.isFinite(result)) {
      if (String(result) === "Infinity" || String(result) === "-Infinity") {
        throw new Error("Infinity");
      }
    }

    ans = Number.isFinite(result) ? result : ans;

    const formatted = formatNumber(result);
    setHistoryLine(expr + " =");
    screen.value = formatted;

    addToHistory(expr, formatted);
  } catch (err) {
    setError(smartError(expr, err));
  }
}

function replaceLastNumber(transformFn) {
  const v = screen.value;
  const m = v.match(/(-?\d+(\.\d+)?)(?!.*\d)/);
  if (!m) return false;
  const num = parseFloat(m[1]);
  const out = transformFn(num);
  screen.value = v.slice(0, m.index) + String(out) + v.slice(m.index + m[1].length);
  return true;
}

function safeTryReadNumberFromScreen() {
  const txt = screen.value.trim();
  if (!txt) return null;
  try {
    const val = safeEval(txt);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

function toggleAngle() {
  mode = mode === "DEG" ? "RAD" : "DEG";
  angleBtn.textContent = mode;
  modeBadge.textContent = mode;
}

function toggleSecond() {
  second = !second;
  secondBtn.textContent = second ? "2nd: ON" : "2nd: OFF";
  secondBadge.textContent = second ? "2nd ON" : "2nd OFF";

  document.querySelectorAll("[data-alt]").forEach(btn => {
    const primary = btn.getAttribute("data-action");
    const alt = btn.getAttribute("data-alt");
    btn.textContent = second ? alt : primary;
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  themeBtn.textContent = (theme === "light") ? "☀️ Light" : "🌙 Dark";
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
}

async function doCopy() {
  try {
    await navigator.clipboard.writeText(screen.value);
    setHistoryLine("Copied!");
    setTimeout(() => setHistoryLine(""), 500);
  } catch {
    setError("Clipboard blocked by browser");
  }
}

async function doPaste() {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt) {
      screen.value = txt.replace(/\s+/g, "");
      setError("");
    }
  } catch {
    setError("Paste blocked by browser");
  }
}

function showHelp() {
  alert(
`Keyboard Shortcuts:
- Enter: =
- Backspace: delete
- Esc: AC
- p: π     e: e
- s: sin(   c: cos(   t: tan(
- l: log(   n: ln(    r: sqrt(
- i: 1/x(   f: factorial (!)
- d: toggle DEG/RAD
- x: toggle 2nd
Tip: For power use pow(a,b) via xʸ button.`
  );
}

function handleAction(action) {
  setError("");

  switch (action) {
    case "clear":
      screen.value = "";
      setHistoryLine("");
      return;

    case "back": {
      const start = screen.selectionStart ?? screen.value.length;
      const end = screen.selectionEnd ?? screen.value.length;

      if (start !== end) {
        screen.value = screen.value.slice(0, start) + screen.value.slice(end);
        screen.setSelectionRange(start, start);
      } else if (start > 0) {
        screen.value = screen.value.slice(0, start - 1) + screen.value.slice(start);
        screen.setSelectionRange(start - 1, start - 1);
      }
      screen.focus();
      return;
    }

    case "equals": doEquals(); return;

    case "percent": insertAtCursor("%"); return;

    case "sign": {
      const v = screen.value.trim();
      if (!v) { insertAtCursor("-"); return; }
      const ok = replaceLastNumber(n => -n);
      if (!ok) insertAtCursor("-(");
      return;
    }

    case "ans": insertAtCursor("ans"); return;
    case "pi": insertAtCursor("π"); return;
    case "e": insertAtCursor("e"); return;

    // Memory
    case "mc":
      memory = 0;
      setMemBadge();
      setHistoryLine("Memory cleared");
      setTimeout(() => setHistoryLine(""), 600);
      return;

    case "mr":
      insertAtCursor(formatNumber(memory).replace(/,/g, ""));
      return;

    case "mplus": {
      const cur = safeTryReadNumberFromScreen();
      if (cur != null) memory += cur;
      setMemBadge();
      setHistoryLine("M = " + formatNumber(memory));
      setTimeout(() => setHistoryLine(""), 700);
      return;
    }

    case "mminus": {
      const cur = safeTryReadNumberFromScreen();
      if (cur != null) memory -= cur;
      setMemBadge();
      setHistoryLine("M = " + formatNumber(memory));
      setTimeout(() => setHistoryLine(""), 700);
      return;
    }

    // Functions
    case "sin":
    case "cos":
    case "tan":
    case "asin":
    case "acos":
    case "atan":
    case "log":
    case "ln":
    case "exp":
    case "pow10":
    case "sqrt":
    case "inv":
      insertFunctionCall(action);
      return;

    case "square":
      // Square last number, else insert square()
      if (!replaceLastNumber(n => n * n)) insertFunctionCall("pow"); // fallback
      return;

    case "pow":
      insertTwoArgFunction("pow");
      return;

    case "fact":
      insertAtCursor("!");
      return;

    // utility
    case "clearHistory":
      clearHistory();
      setHistoryLine("History cleared");
      setTimeout(() => setHistoryLine(""), 700);
      return;

    case "copy": doCopy(); return;
    case "paste": doPaste(); return;
    case "help": showHelp(); return;

    default:
      return;
  }
}

/* =========================
   Ripple effect
========================= */
function addRipple(btn, event) {
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (event.clientX ?? (rect.left + rect.width / 2)) - rect.left - size / 2;
  const y = (event.clientY ?? (rect.top + rect.height / 2)) - rect.top - size / 2;

  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = span.style.height = size + "px";
  span.style.left = x + "px";
  span.style.top = y + "px";

  btn.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

/* =========================
   Events
========================= */
pad.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  addRipple(btn, e);

  if (btn.hasAttribute("data-action")) {
    const primary = btn.getAttribute("data-action");
    const alt = btn.getAttribute("data-alt");
    const action = (second && alt) ? alt : primary;
    handleAction(action);
    return;
  }

  if (btn.hasAttribute("data-insert")) {
    insertAtCursor(btn.getAttribute("data-insert"));
  }
});

angleBtn.addEventListener("click", toggleAngle);
secondBtn.addEventListener("click", toggleSecond);
themeBtn.addEventListener("click", toggleTheme);
historyClearBtn.addEventListener("click", clearHistory);

/* =========================
   Keyboard shortcuts
========================= */
window.addEventListener("keydown", (e) => {
  const k = e.key;

  if (k === "Enter") { e.preventDefault(); doEquals(); return; }
  if (k === "Backspace") { e.preventDefault(); handleAction("back"); return; }
  if (k === "Escape") { e.preventDefault(); handleAction("clear"); return; }

  const allowed = "0123456789+-*/().,%";
  if (allowed.includes(k)) {
    e.preventDefault();
    insertAtCursor(k);
    return;
  }

  // quick shortcuts (single-key)
  const key = k.toLowerCase();

  if (key === "p") { insertAtCursor("π"); return; }
  if (key === "e") { insertAtCursor("e"); return; }

  if (key === "s") { insertFunctionCall(second ? "asin" : "sin"); return; }
  if (key === "c") { insertFunctionCall(second ? "acos" : "cos"); return; }
  if (key === "t") { insertFunctionCall(second ? "atan" : "tan"); return; }

  if (key === "l") { insertFunctionCall(second ? "pow10" : "log"); return; }
  if (key === "n") { insertFunctionCall(second ? "exp" : "ln"); return; }

  if (key === "r") { insertFunctionCall("sqrt"); return; }
  if (key === "i") { insertFunctionCall("inv"); return; }
  if (key === "f") { insertAtCursor("!"); return; }

  if (key === "d") { toggleAngle(); return; }
  if (key === "x") { toggleSecond(); return; }
});

/* =========================
   Init
========================= */
(function init() {
  // theme
  const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
  setTheme(savedTheme);

  // mode badge
  modeBadge.textContent = mode;
  secondBadge.textContent = "2nd OFF";

  // history
  renderHistory();

  // memory
  setMemBadge();
})();