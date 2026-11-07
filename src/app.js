import { audit, schedule, grievanceLetter, computeApr, cashflows, pmt, DEFAULTS } from "./audit.js";
import { RULES } from "./rules.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 0) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = n => (Number.isFinite(n) ? n.toFixed(2) + "%" : "—");
const form = $("#form");
const TODAY = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Presentation of finding status: severity label + what the evidence supports.
const STATUS = {
  issue: { chip: "Raise with lender", conf: "Proven by your figures" },
  check: { chip: "Confirm", conf: "Needs facts outside the KFS" },
  info: { chip: "Context", conf: "Informational" },
  ok: { chip: "Passes", conf: "Checked" },
};

// ---------- Examples (fictional offers that exercise each check) ----------
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
const EXAMPLE_NAMES = { app: "Instant-loan app offer", bank: "Bank personal loan", home: "Home loan" };

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

// ---------- Specimen (hero): the real engine run on the sample offer ----------
function renderSpecimen() {
  const r = audit(examples().app);
  const s = r.summary;
  const max = Math.max(s.apr, s.statedApr) * 1.08;
  const top = r.findings.filter(f => f.status === "issue").slice(0, 3);
  const rules = new Set(r.findings.filter(f => f.status === "issue" && f.rule).map(f => f.rule.ref)).size;
  $("#specimen").innerHTML = `
    <div class="spec-top"><span>Sample audit</span><span>Instant-loan app offer</span></div>
    <div class="spec-body">
      <p class="spec-title">The advertised APR leaves out ${pct(s.apr - s.statedApr).replace("%", "")} points of cost.</p>
      <div class="compare" role="img" aria-label="APR stated ${pct(s.statedApr)}, recomputed ${pct(s.apr)}">
        <div class="cmp-row"><span>APR on the KFS</span><span class="bar"><i data-w="${(s.statedApr / max) * 100}"></i></span><b>${pct(s.statedApr)}</b></div>
        <div class="cmp-row"><span>Recomputed APR</span><span class="bar true"><i data-w="${(s.apr / max) * 100}"></i></span><b>${pct(s.apr)}</b></div>
      </div>
      <ul class="spec-list">${top.map((f, i) => `<li><span class="sev issue" aria-hidden="true"></span><span>${h(f.title)}</span><span class="n">F${i + 1}</span></li>`).join("")}</ul>
    </div>
    <div class="spec-foot"><span>${s.issues} issues · ${rules} RBI circulars cited · ${inr(s.estimatedExcess)} quantified</span><a href="#audit" data-example="app">Open full report →</a></div>`;
  $("#specimen").querySelectorAll(".bar i").forEach(i => i.style.setProperty("--w", i.dataset.w + "%"));
}

// ---------- Report ----------
function run() {
  const input = read();
  const result = audit(input);
  const err = $("#errors");
  const jump = $("#jump");
  if (result.errors) {
    err.hidden = false; err.textContent = result.errors.join(" "); jump.hidden = true;
    $("#results").innerHTML = `<div class="sheet sheet-pad"><p class="hd-eyebrow">Audit report</p><h3 class="verdict-title">Enter the loan terms to begin</h3><p class="verdict-sub">The report appears as soon as the amount, interest rate and tenure are filled in.</p></div>`;
    return;
  }
  err.hidden = true;
  const s = result.summary;
  const issues = result.findings.filter(f => f.status === "issue");
  const checks = result.findings.filter(f => f.status === "check");
  const gap = s.statedApr ? s.apr - s.statedApr : null;
  const rulesCited = new Set(result.findings.filter(f => f.rule).map(f => f.rule.ref)).size;

  jump.hidden = false;
  jump.innerHTML = `<span>${issues.length ? `<i class="sev" aria-hidden="true"></i>${issues.length} issue${issues.length > 1 ? "s" : ""} · APR ${pct(s.apr)}` : `No issues · APR ${pct(s.apr)}`}</span><span aria-hidden="true">Report ↓</span>`;

  const title = issues.length
    ? `${issues.length} finding${issues.length > 1 ? "s" : ""} to raise before you sign`
    : checks.length ? `No rule breaches found. ${checks.length} point${checks.length > 1 ? "s" : ""} to confirm` : "No problems found in these figures";
  const sub = issues.length && s.estimatedExcess > 0
    ? `Where it can be quantified, the offer costs about ${inr(s.estimatedExcess)} more than RBI's rules allow.`
    : "Every check below was run against the figures you entered.";

  $("#results").innerHTML = `
    <article class="sheet">
      <header class="rep-head ${issues.length ? "" : "clean"}">
        <p class="hd-eyebrow">Audit report</p>
        <h3 class="verdict-title">${h(title)}</h3>
        <p class="verdict-sub">${h(sub)}</p>
        <div class="rep-meta">
          <span>Method <b>RBI KFS Annex B · IRR × 12</b></span>
          <span>Checks run <b>10</b></span>
          <span>Circulars cited <b>${rulesCited}</b></span>
          <span>Prepared <b>${TODAY}, in your browser</b></span>
        </div>
      </header>
      <div class="apr-block">
        <div><span class="apr-k">APR stated on the KFS</span><span class="apr-v ${s.statedApr ? "" : "muted"}">${s.statedApr ? pct(s.statedApr) : "Not given"}</span></div>
        <div><span class="apr-k">APR recomputed from cash flows</span><span class="apr-v ${gap > 0.25 ? "bad" : ""}">${pct(s.apr)}</span></div>
        <div class="delta">${gap === null ? "" : gap > 0.25 ? `<span class="hd-chip issue"><span class="dot"></span>+${gap.toFixed(2)} pts understated</span>` : gap < -0.25 ? `<span class="hd-chip check"><span class="dot"></span>${gap.toFixed(2)} pts</span>` : `<span class="hd-chip ok"><span class="dot"></span>Matches</span>`}</div>
      </div>
      <dl class="figs">
        <div><dt>You receive</dt><dd>${inr(s.net)}<small>of ${inr(s.sanctioned)} sanctioned</small></dd></div>
        <div><dt>You repay</dt><dd>${inr(s.totalRepaid)}<small>${s.advance ? `${s.advance} upfront + ` : ""}${s.laterPayments} × ${inr(s.emi)}</small></dd></div>
        <div><dt>Cost per ₹100 received</dt><dd>${inr(s.per100 - 100, 2)}<small>over the full tenure</small></dd></div>
        <div><dt>Beyond the rules</dt><dd>${s.estimatedExcess > 0 ? inr(s.estimatedExcess) : "—"}<small>where quantifiable</small></dd></div>
      </dl>
    </article>

    <article class="sheet">
      <div class="sec-title"><h3>Findings</h3><span>${result.findings.length} results · ordered by severity</span></div>
      <div class="legend-row"><span><b>Proven</b>: established by your figures alone</span><span><b>Confirm</b>: depends on facts outside the KFS</span></div>
      <ol class="findings">${(firstCite = new Map(), result.findings.map(renderFinding).join(""))}</ol>
    </article>

    ${renderWorking(input, s)}

    ${issues.length ? `<article class="sheet letter sheet-pad">
      <p class="hd-eyebrow">Next step</p>
      <h3 class="verdict-title">Send this to the lender</h3>
      <p class="verdict-sub">Addressed to the Grievance Redressal Officer, with each issue and its RBI reference. Edit freely. Nothing is sent from this page.</p>
      <div class="letter-row">
        <label>Lender<input id="l-lender" placeholder="Example Finance Ltd"></label>
        <label>Loan / application no.<input id="l-ref"></label>
        <label>Your name<input id="l-name"></label>
      </div>
      <textarea id="letter" aria-label="Draft grievance letter"></textarea>
      <div class="actions"><button type="button" class="btn primary small" id="copy">Copy letter</button><button type="button" class="btn quiet small" id="print">Print report</button><span class="muted small" id="copied" role="status"></span></div>
      <p class="small muted">No resolution in 30 days? File free with the <a href="${RULES.ombudsman.url}" rel="noopener">RBI Ombudsman</a>.</p>
    </article>` : ""}`;

  $("#results").querySelectorAll(".finding > button").forEach(b => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    b.nextElementSibling.hidden = open;
  }));
  if (issues.length) {
    const update = () => { $("#letter").value = grievanceLetter(result, { lender: $("#l-lender").value, loanRef: $("#l-ref").value, name: $("#l-name").value }); };
    ["#l-lender", "#l-ref", "#l-name"].forEach(id => $(id).addEventListener("input", update));
    update();
    $("#copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#letter").value); $("#copied").textContent = "Copied."; }
      catch { $("#letter").select(); $("#copied").textContent = "Press Ctrl+C to copy."; }
    });
    $("#print").addEventListener("click", () => window.print());
  }
}

let fid = 0;
let firstCite = new Map(); // rule ref → index of the finding that first cites it
function citeHtml(rule, i) {
  const first = firstCite.get(rule.ref);
  if (first === undefined) firstCite.set(rule.ref, i);
  const same = first !== undefined && first !== i;
  return `<li class="c-rule"><span class="k">Rule</span><a class="cite ${same ? "same" : ""}" href="${h(rule.url)}" target="_blank" rel="noopener"><b>${h(rule.name)} ↗</b><small>${h(rule.ref)}${rule.date ? " · " + h(rule.date) : ""}</small><em>${h(rule.summary)}</em>${same ? `<span class="same-note">Same rule as F${first + 1}</span>` : ""}</a></li>`;
}
function renderFinding(f, i) {
  const id = "f" + (++fid);
  const st = STATUS[f.status];
  const open = f.status === "issue" && i < 3;
  return `<li class="finding">
    <button type="button" aria-expanded="${open}" aria-controls="${id}">
      <span class="fid">F${i + 1}</span>
      <span class="f-main">
        <span class="f-title">${h(f.title)}</span>
        <span class="f-tags"><span class="hd-chip ${f.status}"><span class="dot"></span>${st.chip}</span><span class="conf">${st.conf}</span></span>
      </span>
      <span class="f-amt">${f.excess > 0 ? "≈ " + inr(f.excess) : ""}<span class="chev" aria-hidden="true"></span></span>
    </button>
    <ol class="chain" id="${id}" ${open ? "" : "hidden"}>
      <li><span class="k">Calculation</span><p>${h(f.detail)}</p></li>
      ${f.rule ? citeHtml(f.rule, i) : ""}
      ${f.action ? `<li class="c-act"><span class="k">What to do</span><p>${h(f.action)}</p></li>` : ""}
    </ol>
  </li>`;
}

function renderWorking(input, s) {
  const rows = schedule(input);
  const n = s.laterPayments;
  return `<details class="sheet working-toggle">
    <summary><h3>Show the working</h3><small>Verify every number</small></summary>
    <div class="working-body">
      <div class="cols">
        <div>
          <h4>From sanctioned amount to money in hand</h4>
          <table>
            <tbody>
              <tr><td>Sanctioned amount</td><td class="num">${inr(s.sanctioned, 2)}</td></tr>
              ${s.upfront.map(d => `<tr><td>− ${h(d.label)}</td><td class="num">${inr(d.amount, 2)}</td></tr>`).join("")}
            </tbody>
            <tfoot><tr><td>Net amount received</td><td class="num">${inr(s.net, 2)}</td></tr></tfoot>
          </table>
        </div>
        <div>
          <h4>APR, step by step</h4>
          <p class="small">Find the monthly rate <i>i</i> at which ${n} payments of ${inr(s.emi, 2)} are worth ${inr(s.net, 2)} today:</p>
          <p class="formula">${inr(s.net, 2)} = ${inr(s.emi, 2)} × (1 − (1 + i)<sup>−${n}</sup>) ÷ i</p>
          <p class="small">i = ${(s.apr / 12).toFixed(4)}% a month → APR = i × 12 = <b>${pct(s.apr)}</b>. Without GST on fees: ${pct(s.aprExGst)}. Compounded yearly: ${pct(s.effectiveAnnual)}.</p>
          <p class="small">Verify in Excel or Google Sheets:</p>
          <p class="formula">=RATE(${n}, -${s.emi.toFixed(2)}, ${s.net.toFixed(2)}) * 12</p>
        </div>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Month</th><th class="num">EMI</th><th class="num">Interest at APR</th><th class="num">Principal</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.month}</td><td class="num">${inr(r.emi, 2)}</td><td class="num">${inr(r.interest, 2)}</td><td class="num">${inr(r.principal, 2)}</td><td class="num">${inr(r.balance, 2)}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
  </details>`;
}

function renderSources() {
  $("#source-list").innerHTML = Object.values(RULES).map(r => `<li><a href="${h(r.url)}" target="_blank" rel="noopener">${h(r.name)} ↗</a>
    <div class="meta">${h(r.ref)}${r.date ? " · " + h(r.date) : ""} · checked ${h(r.verified)}</div></li>`).join("");
}

// ---------- Wiring ----------
let t;
form.addEventListener("input", e => { if (e.target.name === "digital") toggleDigital(); clearTimeout(t); t = setTimeout(run, 120); });
form.addEventListener("submit", e => e.preventDefault());
$("#example").addEventListener("change", e => { fill(e.target.value ? examples()[e.target.value] : {}); run(); });
document.addEventListener("click", e => {
  const a = e.target.closest("[data-example]");
  if (!a) return;
  $("#example").value = a.dataset.example;
  fill(examples()[a.dataset.example]); run();
});
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
});

renderSpecimen();
renderSources();
fill(examples().app);
run();
