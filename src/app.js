import { audit, schedule, grievanceLetter, computeApr, cashflows, pmt, DEFAULTS } from "./audit.js";
import { RULES } from "./rules.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 0) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = n => (Number.isFinite(n) ? n.toFixed(2) + "%" : "—");
const form = $("#form");

// ---------- Examples (fictional offers that illustrate each check) ----------
function examples() {
  const bankBase = { sanctioned: 300000, rate: 11.25, tenure: 36, processingFee: 3000, rateType: "fixed", penalStyle: "charge" };
  const app = { sanctioned: 50000, rate: 30, tenure: 6, advanceEmis: 1, processingFee: 2500, insurance: 999, digital: true, penalStyle: "rate_added",
    disbursalDate: "2026-11-10", interestFromDate: "2026-11-07", firstEmiDate: "2026-12-10" };
  app.emi = Math.round(pmt(app.sanctioned, app.rate, app.tenure));
  app.statedNetDisbursed = Math.round(cashflows(app).net - 590);
  app.statedApr = 34.5;
  return {
    app,
    bank: { ...bankBase, emi: Math.round(pmt(300000, 11.25, 36)), statedNetDisbursed: Math.round(cashflows(bankBase).net), statedApr: +computeApr(bankBase).apr.toFixed(2) },
    home: { sanctioned: 4000000, rate: 8.6, tenure: 240, processingFee: 10000, rateType: "floating", prepaymentChargePct: 2, sanctionedOnOrAfter2026: true,
      brokenPeriodInterest: 28000, disbursalDate: "2026-03-26", firstEmiDate: "2026-05-05", statedApr: 8.65 },
  };
}

function fill(values) {
  const v = { ...DEFAULTS, ...values };
  for (const el of form.elements) {
    if (!el.name || !(el.name in v)) continue;
    if (el.type === "checkbox") el.checked = !!v[el.name];
    else if (el.type === "number") el.value = v[el.name] === null || v[el.name] === 0 ? "" : v[el.name];
    else el.value = String(v[el.name] ?? "");
  }
  form.querySelectorAll("details").forEach(d => (d.open = ["disbursalDate", "interestFromDate", "firstEmiDate", "prepaymentChargePct", "digital"].some(k => values[k])));
  toggleDigital();
}

function read() {
  const v = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") v[el.name] = el.checked;
    else if (el.type === "number") v[el.name] = el.value === "" ? (el.name === "coolingOffDays" ? null : 0) : Number(el.value);
    else if (el.name === "sanctionedOnOrAfter2026") v[el.name] = el.value === "true";
    else v[el.name] = el.value;
  }
  return v;
}

function toggleDigital() { form.querySelector("[data-digital]").hidden = !form.elements.digital.checked; }

// ---------- Render ----------
let last = null;
function run() {
  const input = read();
  const result = audit(input);
  const err = $("#errors");
  if (result.errors) {
    err.hidden = false; err.textContent = result.errors.join(" "); $("#jump").hidden = true;
    $("#results").innerHTML = `<div class="card"><h2>Enter the loan terms</h2><p class="muted">Results appear as soon as the amount, rate and tenure are filled in.</p></div>`;
    return;
  }
  err.hidden = true;
  last = { input, result };
  const jump = $("#jump");
  const nIssues = result.findings.filter(f => f.status === "issue").length;
  jump.hidden = false;
  jump.innerHTML = `<span>${nIssues ? `${nIssues} issue${nIssues > 1 ? "s" : ""} found` : "No issues found"} · APR ${pct(result.summary.apr)}</span><span aria-hidden="true">View ↓</span>`;
  const s = result.summary;
  const issues = result.findings.filter(f => f.status === "issue");
  const checks = result.findings.filter(f => f.status === "check");
  const aprGap = s.statedApr ? s.apr - s.statedApr : 0;

  const headline = issues.length
    ? `${issues.length} thing${issues.length > 1 ? "s" : ""} to raise with the lender before you sign`
    : checks.length ? `No rule problems found. ${checks.length} point${checks.length > 1 ? "s" : ""} to confirm` : "No problems found in these figures";
  const sub = issues.length && s.estimatedExcess > 0
    ? `Where it can be quantified, these add up to about <b>${inr(s.estimatedExcess)}</b> more than the rules allow.`
    : "LoanLens checked the figures you entered against the RBI rules listed below.";

  $("#results").innerHTML = `
    <article class="card verdict ${issues.length ? "" : "clean"}">
      <p class="headline">${h(headline)}</p>
      <p>${sub}</p>
      <dl class="figures">
        <div><dt>True APR (recomputed)</dt><dd class="${aprGap > 0.25 ? "bad" : ""}">${pct(s.apr)}<small>${s.statedApr ? `KFS says ${pct(s.statedApr)}` : "KFS APR not entered"}</small></dd></div>
        <div><dt>You actually receive</dt><dd>${inr(s.net)}<small>of ${inr(s.sanctioned)} sanctioned</small></dd></div>
        <div><dt>You repay in total</dt><dd>${inr(s.totalRepaid)}<small>${s.advance ? `${s.advance} upfront + ` : ""}${s.laterPayments} × ${inr(s.emi)}</small></dd></div>
        <div><dt>Cost per ₹100 received</dt><dd>${inr(s.per100 - 100, 2)}<small>over the full tenure</small></dd></div>
      </dl>
    </article>

    <article class="card">
      <h2>Findings</h2>
      <p class="muted small">Tap a finding to see the numbers, the rule, and what to do.</p>
      <ul class="findings">${result.findings.map(renderFinding).join("")}</ul>
    </article>

    ${renderWorking(input, s)}

    ${issues.length ? `<article class="card letter">
      <h2>Draft a letter to the lender</h2>
      <p class="muted small">Addressed to the lender's Grievance Redressal Officer, citing each issue and its RBI reference. Edit it freely. Nothing is sent from this page.</p>
      <div class="row">
        <label>Lender<input id="l-lender" placeholder="e.g. Example Finance Ltd"></label>
        <label>Loan / application no.<input id="l-ref"></label>
        <label>Your name<input id="l-name"></label>
      </div>
      <textarea id="letter" aria-label="Draft grievance letter"></textarea>
      <div class="actions"><button type="button" class="btn" id="copy">Copy letter</button><span class="muted small" id="copied" role="status"></span></div>
      <p class="small muted">If the lender doesn't resolve it within 30 days, you can complain to the <a href="${RULES.ombudsman.url}" rel="noopener">RBI Ombudsman</a> online, free of charge.</p>
    </article>` : ""}`;

  $("#results").querySelectorAll(".finding > button").forEach(b => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    b.nextElementSibling.hidden = open;
  }));
  if (issues.length) {
    const update = () => { $("#letter").value = grievanceLetter(result, { lender: $("#l-lender").value, loanRef: $("#l-ref").value, name: $("#l-name").value }); };
    ["#l-lender", "#l-ref", "#l-name"].forEach(s => $(s).addEventListener("input", update));
    update();
    $("#copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#letter").value); $("#copied").textContent = "Copied."; }
      catch { $("#letter").select(); $("#copied").textContent = "Press Ctrl+C to copy."; }
    });
  }
}

const LABEL = { issue: "Raise this", check: "Confirm", info: "Good to know", ok: "Looks fine" };
const ICON = { issue: "!", check: "?", info: "i", ok: "✓" };
let fid = 0;
function renderFinding(f) {
  const id = "f" + (++fid);
  const openByDefault = f.status === "issue";
  return `<li class="finding ${f.status}">
    <button type="button" aria-expanded="${openByDefault}" aria-controls="${id}">
      <span class="badge"><span aria-hidden="true">${ICON[f.status]}</span>${LABEL[f.status]}</span>
      <span class="title">${h(f.title)}</span>
      <span class="excess">${f.excess > 0 ? "≈ " + inr(f.excess) : ""}</span>
    </button>
    <div class="body" id="${id}" ${openByDefault ? "" : "hidden"}>
      <span class="label">What we found</span><p>${h(f.detail)}</p>
      ${f.action ? `<span class="label">What to do</span><p>${h(f.action)}</p>` : ""}
      ${f.rule ? `<div class="rule"><span class="muted small">Rule: </span><a href="${h(f.rule.url)}" target="_blank" rel="noopener">${h(f.rule.name)} ↗</a>
        <div class="meta">${h(f.rule.ref)}${f.rule.date ? " · " + h(f.rule.date) : ""}</div>
        <details><summary>What the rule says</summary><p>${h(f.rule.summary)}</p></details></div>` : ""}
    </div>
  </li>`;
}

function renderWorking(input, s) {
  const rows = schedule(input);
  const n = s.laterPayments;
  return `<article class="card working">
    <details>
      <summary><h2>Show the working</h2></summary>
      <div class="cols">
        <div>
          <h3>From sanctioned amount to money in hand</h3>
          <table>
            <tbody>
              <tr><td>Sanctioned amount</td><td class="num">${inr(s.sanctioned, 2)}</td></tr>
              ${s.upfront.map(d => `<tr><td>− ${h(d.label)}</td><td class="num">${inr(d.amount, 2)}</td></tr>`).join("")}
            </tbody>
            <tfoot><tr><td>Net amount received</td><td class="num">${inr(s.net, 2)}</td></tr></tfoot>
          </table>
        </div>
        <div>
          <h3>APR, step by step</h3>
          <p class="small">Find the monthly rate <i>i</i> at which ${n} payments of ${inr(s.emi, 2)} are worth exactly ${inr(s.net, 2)} today:</p>
          <p class="formula">${inr(s.net, 2)} = ${inr(s.emi, 2)} × (1 − (1 + i)<sup>−${n}</sup>) ÷ i</p>
          <p class="small">i = ${(s.apr / 12).toFixed(4)}% a month → APR = i × 12 = <b>${pct(s.apr)}</b> (without GST on fees: ${pct(s.aprExGst)}; compounded yearly: ${pct(s.effectiveAnnual)}).</p>
          <p class="small">Check it yourself in Excel or Google Sheets:</p>
          <p class="formula">=RATE(${n}, -${s.emi.toFixed(2)}, ${s.net.toFixed(2)}) * 12</p>
        </div>
      </div>
      <div class="scroll">
        <table>
          <thead><tr><th>Month</th><th class="num">EMI</th><th class="num">Interest at APR</th><th class="num">Principal</th><th class="num">Balance</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${r.month}</td><td class="num">${inr(r.emi, 2)}</td><td class="num">${inr(r.interest, 2)}</td><td class="num">${inr(r.principal, 2)}</td><td class="num">${inr(r.balance, 2)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </details>
  </article>`;
}

function renderSources() {
  $("#source-list").innerHTML = Object.values(RULES).map(r => `<li><a href="${h(r.url)}" target="_blank" rel="noopener">${h(r.name)}</a>
    <div class="meta">${h(r.ref)}${r.date ? " · " + h(r.date) : ""} · summary last checked ${h(r.verified)}</div></li>`).join("");
}

// ---------- Wiring ----------
let t;
form.addEventListener("input", e => { if (e.target.name === "digital") toggleDigital(); clearTimeout(t); t = setTimeout(run, 120); });
form.addEventListener("submit", e => e.preventDefault());
$("#example").addEventListener("change", e => { fill(e.target.value ? examples()[e.target.value] : {}); run(); });
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
});

renderSources();
fill(examples().app);
run();
