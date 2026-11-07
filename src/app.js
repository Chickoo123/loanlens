import { emi, compareStrategies, prepayVsInvest, STRATEGIES } from "./engine.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
const compact = n => { const a = Math.abs(n); return a >= 1e7 ? "₹" + (a / 1e7).toFixed(2) + " Cr" : a >= 1e5 ? "₹" + (a / 1e5).toFixed(1) + " L" : a >= 1e3 ? "₹" + (a / 1e3).toFixed(0) + "k" : "₹" + Math.round(a); };
const dur = m => { const y = Math.floor(m / 12), mo = m % 12; return [y && `${y} yr${y > 1 ? "s" : ""}`, mo && `${mo} mo`].filter(Boolean).join(" ") || "0 mo"; };
const START = new Date();
const monthName = m => new Date(START.getFullYear(), START.getMonth() + m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const COLORS = ["#8b5cf6", "#ec4899", "#22d3ee", "#f59e0b", "#22c55e", "#f43f5e", "#a3e635", "#38bdf8"];
const TYPES = { home: "Home", car: "Car", personal: "Personal", education: "Education", card: "Credit card", gold: "Gold", other: "Other" };

const PRESETS = {
  pro: [
    { name: "Car loan", type: "car", principal: 650000, rate: 9.4, years: 5, penalty: 0 },
    { name: "Personal loan", type: "personal", principal: 300000, rate: 13.5, years: 3, penalty: 3 },
    { name: "Credit card EMI", type: "card", principal: 75000, rate: 18, years: 1, penalty: 0 },
    { name: "Education loan", type: "education", principal: 900000, rate: 10.5, years: 7, penalty: 0 },
  ],
  home: [
    { name: "Home loan", type: "home", principal: 4500000, rate: 8.5, years: 20, penalty: 0 },
    { name: "Car loan", type: "car", principal: 700000, rate: 9.2, years: 5, penalty: 0 },
    { name: "Personal loan", type: "personal", principal: 200000, rate: 14, years: 3, penalty: 4 },
  ],
};

let uid = 0;
const withId = l => ({ id: ++uid, ...l });
const defaults = () => ({ loans: PRESETS.home.map(withId), extra: 15000, lump: 0, lumpMonth: 12, mode: "tenure", rollover: true, tax: 0, ret: 12, selected: null });

function loadState() {
  try {
    if (location.hash.length > 1) {
      const s = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
      if (Array.isArray(s.loans)) { s.loans = s.loans.map(withId); return { ...defaults(), ...s }; }
    }
  } catch { /* ignore malformed links */ }
  return defaults();
}
const state = loadState();

// ---------- Theme ----------
try { const t = localStorage.getItem("ll-theme"); if (t) document.documentElement.dataset.theme = t; } catch { }
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("ll-theme", next); } catch { }
});

// ---------- Inputs ----------
function renderLoans() {
  const host = $("#loans");
  host.innerHTML = state.loans.map((l, i) => `
    <div class="loan" data-id="${l.id}">
      <div class="loan-top">
        <input type="text" data-k="name" value="${h(l.name)}" aria-label="Loan name" maxlength="40">
        <button class="remove" data-remove="${l.id}" aria-label="Remove ${h(l.name)}" title="Remove">×</button>
      </div>
      <div class="grid">
        <label class="mini">Type<select data-k="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === l.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="mini">Outstanding (₹)<input type="number" data-k="principal" min="1000" step="1000" value="${l.principal}" inputmode="numeric"></label>
        <label class="mini">Interest (% p.a.)<input type="number" data-k="rate" min="0" max="60" step="0.05" value="${l.rate}" inputmode="decimal"></label>
        <label class="mini">Years left<input type="number" data-k="years" min="0.5" max="30" step="0.5" value="${l.years}" inputmode="decimal"></label>
        <label class="mini">Prepay penalty (%)<input type="number" data-k="penalty" min="0" max="10" step="0.5" value="${l.penalty || 0}" inputmode="decimal"></label>
        <div class="mini">EMI<div class="emi-note" data-emi></div></div>
      </div>
    </div>`).join("");
  [...host.children].forEach((el, i) => el.style.setProperty("--c", COLORS[i % COLORS.length]));
  updateEmiNotes();
}
function updateEmiNotes() {
  document.querySelectorAll(".loan").forEach(el => {
    const l = state.loans.find(x => x.id === Number(el.dataset.id));
    el.querySelector("[data-emi]").innerHTML = `<b>${inr(emi(l.principal, l.rate, Math.round(l.years * 12)))}</b>/mo`;
  });
}

$("#loans").addEventListener("input", e => {
  const el = e.target.closest(".loan"); if (!el || !e.target.dataset.k) return;
  const l = state.loans.find(x => x.id === Number(el.dataset.id));
  const k = e.target.dataset.k;
  l[k] = ["name", "type"].includes(k) ? e.target.value : Math.max(0, Number(e.target.value) || 0);
  updateEmiNotes(); schedule();
});
$("#loans").addEventListener("click", e => {
  const id = e.target.dataset.remove; if (!id) return;
  state.loans = state.loans.filter(l => l.id !== Number(id)); renderLoans(); schedule();
});
$("#add").addEventListener("click", () => {
  if (state.loans.length >= 8) return toast("Up to 8 loans supported");
  state.loans.push(withId({ name: `Loan ${state.loans.length + 1}`, type: "personal", principal: 200000, rate: 12, years: 3, penalty: 0 }));
  renderLoans(); schedule();
});
document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { state.loans = PRESETS[b.dataset.preset].map(withId); state.selected = null; renderLoans(); schedule(); }));

const extra = $("#extra"), lump = $("#lump"), lumpMonth = $("#lump-month");
function syncPlanInputs() {
  extra.value = state.extra; $("#extra-out").textContent = inr(state.extra);
  lump.value = state.lump || ""; lumpMonth.value = state.lumpMonth;
  $("#rollover").checked = state.rollover; $("#tax").value = String(state.tax); $("#ret").value = String(state.ret);
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.mode === state.mode)));
}
extra.addEventListener("input", () => { state.extra = Number(extra.value); $("#extra-out").textContent = inr(state.extra); schedule(); });
lump.addEventListener("input", () => { state.lump = Math.max(0, Number(lump.value) || 0); schedule(); });
lumpMonth.addEventListener("input", () => { state.lumpMonth = Math.max(1, Math.round(Number(lumpMonth.value) || 1)); schedule(); });
$("#rollover").addEventListener("change", e => { state.rollover = e.target.checked; schedule(); });
$("#tax").addEventListener("change", e => { state.tax = Number(e.target.value); schedule(); });
$("#ret").addEventListener("change", e => { state.ret = Number(e.target.value); schedule(); });
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { state.mode = b.dataset.mode; syncPlanInputs(); schedule(); }));

$("#share").addEventListener("click", async () => {
  const url = location.href.split("#")[0] + "#" + encodeState();
  try { await navigator.clipboard.writeText(url); toast("Share link copied"); } catch { prompt("Copy this link", url); }
});
function encodeState() {
  const { loans, extra, lump, lumpMonth, mode, rollover, tax, ret } = state;
  return btoa(unescape(encodeURIComponent(JSON.stringify({ loans: loans.map(({ id, ...l }) => l), extra, lump, lumpMonth, mode, rollover, tax, ret }))));
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800); }

// ---------- Compute & render ----------
let pending = false;
function schedule() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; compute(); }); } }

function compute() {
  const loans = state.loans.filter(l => l.principal > 0 && l.years > 0).map(l => ({ id: l.id, name: l.name || "Loan", type: l.type, principal: l.principal, rate: l.rate, tenure: Math.max(1, Math.round(l.years * 12)), penalty: l.penalty }));
  const err = $("#error");
  if (!loans.length) { err.hidden = false; err.textContent = "Add at least one loan with an outstanding amount."; return; }
  const plan = { extra: state.extra, lumpSums: state.lump ? [{ month: state.lumpMonth, amount: state.lump }] : [], mode: state.mode, rollover: state.rollover, taxSlab: state.tax };
  let cmp;
  try { cmp = compareStrategies(loans, plan); err.hidden = true; }
  catch (e) { err.hidden = false; err.textContent = e.message; return; }
  const noExtra = !state.extra && !state.lump;
  const sel = state.selected && state.selected !== "none" ? state.selected : cmp.best;
  const r = cmp.results[sel], base = cmp.results.none;
  history.replaceState(null, "", "#" + encodeState());

  // Hero
  $("#hero").innerHTML = noExtra
    ? `<div class="eyebrow">Current path</div><h1>You'll be debt-free in <em>${monthName(base.months)}</em>.<br>Add an extra amount to see how much sooner.</h1>${stats(base, base)}`
    : `<div class="eyebrow">${h(STRATEGIES[sel].label)} strategy · ${state.mode === "tenure" ? "reduce tenure" : "reduce EMI"}</div>
       <h1>Debt-free by <em>${monthName(r.months)}</em>, ${r.monthsSaved > 0 ? `<em>${dur(r.monthsSaved)}</em> sooner` : "same timeline"}, saving <em>${compact(r.interestSaved)}</em> in interest.</h1>${stats(r, base)}`;

  // Strategy cards
  $("#strategies").innerHTML = Object.entries(STRATEGIES).map(([k, s]) => {
    const x = cmp.results[k];
    return `<button class="strat" data-s="${k}" aria-pressed="${k === sel}" title="${h(s.blurb)}">
      ${k === cmp.best && !noExtra ? `<span class="best">BEST</span>` : ""}
      <div class="name">${h(s.label)}</div>
      <div class="cost">${compact(x.totalCost)}</div>
      <div class="meta">${k === "none" ? "total interest" : x.interestSaved > 0 ? `<span class="saved">saves ${compact(x.interestSaved)}</span> · ${dur(x.months)}` : dur(x.months)}</div>
    </button>`;
  }).join("");
  document.querySelectorAll(".strat").forEach(b => b.addEventListener("click", () => { state.selected = b.dataset.s; compute(); }));
  $("#legend-sel").textContent = STRATEGIES[sel].label;

  renderChart(base, r);
  renderGantt(loans, base, r);
  renderVerdict(loans, plan, sel, noExtra);
  renderBreakdown(loans, base, r);
}

const stats = (r, base) => `<div class="stats">
  <div class="stat"><div class="k">Total interest</div><div class="v">${compact(r.totalInterest)}</div></div>
  <div class="stat"><div class="k">Interest saved</div><div class="v">${compact(Math.max(0, base.totalCost - r.totalCost))}</div></div>
  <div class="stat"><div class="k">Debt-free in</div><div class="v">${dur(r.months)}</div></div>
  <div class="stat"><div class="k">${r.totalPenalty > 0 ? "Penalties paid" : "Monthly EMIs now"}</div><div class="v">${r.totalPenalty > 0 ? compact(r.totalPenalty) : inr(state.loans.reduce((a, l) => a + emi(l.principal, l.rate, Math.round(l.years * 12)), 0))}</div></div>
</div>`;

function renderChart(base, r) {
  const W = 760, H = 280, p = { l: 56, r: 12, t: 12, b: 28 };
  const months = base.months, max = Math.max(1, base.timeline[0]?.total ?? 1, r.timeline[0]?.total ?? 1) * 1.05;
  const x = m => p.l + (m / months) * (W - p.l - p.r), y = v => p.t + (1 - v / max) * (H - p.t - p.b);
  const start = state.loans.filter(l => l.principal > 0 && l.years > 0).reduce((a, l) => a + l.principal, 0);
  const path = tl => `M${x(0)},${y(start)} ` + tl.map(t => `L${x(t.month).toFixed(1)},${y(t.total).toFixed(1)}`).join(" ");
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outstanding balance over time"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; svg += `<line class="grid-line" x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${p.l - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`; }
  const step = Math.max(12, Math.ceil(months / 8 / 12) * 12);
  for (let m = 0; m <= months; m += step) svg += `<text x="${x(m)}" y="${H - 8}" text-anchor="middle">${m === 0 ? "Now" : `Y${m / 12}`}</text>`;
  svg += `<path d="${path(r.timeline)} L${x(r.months)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#g)"/>`;
  svg += `<path d="${path(base.timeline)}" fill="none" stroke="var(--base)" stroke-width="2" stroke-dasharray="5 4"/>`;
  svg += `<path d="${path(r.timeline)}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>`;
  if (r.months < base.months) svg += `<circle cx="${x(r.months)}" cy="${y(0)}" r="5" fill="var(--accent)"/><text x="${x(r.months) + 10}" y="${y(0) - 14}" text-anchor="start" font-weight="700" fill="var(--text)" paint-order="stroke" stroke="var(--card-solid)" stroke-width="5" stroke-linejoin="round">Debt-free · ${monthName(r.months)}</text>`;
  $("#chart").innerHTML = svg + "</svg>";
}

function renderGantt(loans, base, r) {
  const max = base.months;
  const host = $("#gantt");
  host.innerHTML = loans.map((l, i) => {
    const b = base.loans.find(x => x.id === l.id), s = r.loans.find(x => x.id === l.id);
    return `<div class="g-row"><div class="lbl"><b>${h(l.name)}</b><span>${monthName(s.closedAt)}${b.closedAt - s.closedAt > 0 ? ` · ${dur(b.closedAt - s.closedAt)} early` : ""}</span></div><div class="g-track"><span class="g-base"></span><span class="g-sel"></span></div></div>`;
  }).join("");
  [...host.children].forEach((row, i) => {
    const l = loans[i], b = base.loans.find(x => x.id === l.id), s = r.loans.find(x => x.id === l.id);
    row.querySelector(".g-base").style.setProperty("--w", (b.closedAt / max) * 100 + "%");
    const sel = row.querySelector(".g-sel");
    sel.style.setProperty("--w", (s.closedAt / max) * 100 + "%");
    sel.style.setProperty("--c", COLORS[state.loans.findIndex(x => x.id === l.id) % COLORS.length]);
  });
}

function renderVerdict(loans, plan, sel, noExtra) {
  const v = $("#verdict");
  if (noExtra) { v.innerHTML = `<header class="card-head"><h3>Prepay or invest?</h3></header><p class="small">Set an extra monthly amount or a lump sum to compare prepaying with investing that money at ${state.ret}% a year.</p>`; return; }
  const pv = prepayVsInvest(loans, { ...plan, strategy: sel }, state.ret);
  const max = Math.max(pv.prepayCorpus, pv.investCorpus, 1);
  v.innerHTML = `<header class="card-head"><h3>Prepay or invest?</h3><span class="small">at ${state.ret}% p.a. for ${dur(pv.horizon)}</span></header>
    <div class="verdict-big ${pv.winner}">${pv.winner === "prepay" ? "Prepaying wins" : "Investing wins"} by ${compact(pv.difference)}</div>
    <p class="small">Both paths spend the same cash every month. Wealth is compared at ${monthName(pv.horizon)}, when the loans would close anyway.</p>
    <div class="bars2">
      <div class="b"><span>Prepay first</span><span class="t"><span class="f" data-w="${(pv.prepayCorpus / max) * 100}"></span></span><span class="v">${compact(pv.prepayCorpus)}</span></div>
      <div class="b"><span>Invest instead</span><span class="t"><span class="f" data-w="${(pv.investCorpus / max) * 100}"></span></span><span class="v">${compact(pv.investCorpus)}</span></div>
    </div>
    <p class="small">Returns aren't guaranteed, but interest saved is. Prepaying also lowers risk, so many people prepay loans above about 9–10% and invest when loans are cheaper.</p>`;
  v.querySelectorAll(".f").forEach(f => f.style.setProperty("--w", f.dataset.w + "%"));
}

function renderBreakdown(loans, base, r) {
  $("#breakdown").innerHTML = `<thead><tr><th>Loan</th><th class="num">Rate</th><th class="num">Interest (EMIs only)</th><th class="num">Interest (plan)</th><th class="num">Prepaid</th><th class="num">Closes</th></tr></thead><tbody>` +
    loans.map(l => {
      const b = base.loans.find(x => x.id === l.id), s = r.loans.find(x => x.id === l.id);
      const c = COLORS[state.loans.findIndex(x => x.id === l.id) % COLORS.length];
      return `<tr><td><span class="dot" data-c="${c}"></span>${h(l.name)}</td><td class="num">${l.rate}%</td><td class="num">${inr(b.interest)}</td><td class="num">${inr(s.interest)}${b.interest - s.interest > 1 ? ` <span class="good">−${compact(b.interest - s.interest)}</span>` : ""}</td><td class="num">${inr(s.prepaid)}${s.penalty > 1 ? `<div class="small">+${inr(s.penalty)} penalty</div>` : ""}</td><td class="num">${monthName(s.closedAt)}</td></tr>`;
    }).join("") + "</tbody>";
  document.querySelectorAll(".dot").forEach(d => d.style.setProperty("--c", d.dataset.c));
}

renderLoans();
syncPlanInputs();
compute();
