// LoanLens audit engine. Pure functions: no DOM, no network.
//
// Given the figures on a loan's Key Facts Statement (KFS), it rebuilds the actual
// cash flows, recomputes the APR the way RBI's KFS circular illustrates it
// (monthly IRR on the net amount received × 12), and checks the offer against
// specific RBI rules. Every finding carries the numbers behind it and a citation.

import { RULES } from "./rules.js";

export const GST_RATE = 0.18;
const round2 = x => Math.round(x * 100) / 100;
const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Reducing-balance EMI. */
export function pmt(principal, annualRate, months) {
  const r = annualRate / 1200;
  if (months <= 0) return 0;
  if (r === 0) return principal / months;
  const f = (1 + r) ** months;
  return principal * r * f / (f - 1);
}

/** EMI when interest is quoted on a flat basis (on the original principal for the whole tenure). */
export const flatEmi = (principal, annualRate, months) => (principal + principal * annualRate / 100 * months / 12) / months;

/** Present value factor of n monthly payments of 1 at monthly rate r. */
const annuity = (r, n) => (r === 0 ? n : (1 - (1 + r) ** -n) / r);

/**
 * Monthly IRR for: receive `net` today, pay `payment` at the end of each of `n` months.
 * Bisection: robust, monotonic, and easy to verify. Returns a monthly rate.
 */
export function monthlyIrr(net, payment, n) {
  if (net <= 0 || payment <= 0 || n <= 0) return NaN;
  if (payment * n < net) return NaN; // repays less than received: not a loan
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (payment * annuity(mid, n) > net) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Equivalent reducing-balance annual rate for a given EMI (inverse of pmt). */
export const impliedRate = (principal, emi, n) => monthlyIrr(principal, emi, n) * 1200;

export const DEFAULTS = {
  loanType: "personal",      // personal | home | vehicle | education | gold | consumer_durable | business
  purpose: "non_business",   // non_business | business
  borrower: "individual",    // individual | non_individual
  digital: false,
  rateType: "fixed",         // fixed | floating
  rateBasis: "reducing",     // reducing | flat
  sanctioned: 0,
  rate: 0,
  tenure: 0,
  emi: 0,                    // as printed; 0 = not given, we compute it
  advanceEmis: 0,            // instalments collected upfront, counted within `tenure`
  processingFee: 0,
  feeGstIncluded: false,     // is GST already included in processingFee?
  insurance: 0,              // premium deducted from the loan amount
  otherUpfront: 0,           // documentation, stamp duty, etc. deducted from the loan amount
  brokenPeriodInterest: 0,   // pre-EMI / broken-period interest deducted or charged
  statedNetDisbursed: 0,
  statedApr: 0,
  sanctionDate: "",
  disbursalDate: "",
  interestFromDate: "",
  firstEmiDate: "",
  prepaymentChargePct: 0,
  sanctionedOnOrAfter2026: true,
  penalStyle: "charge",      // charge | rate_added | unknown
  coolingOffDays: null,      // digital loans only; null = not disclosed
  undisclosedCharges: 0,     // charges asked for that are NOT in the KFS
};

/** Build the cash-flow picture from KFS inputs. */
export function cashflows(input) {
  const x = { ...DEFAULTS, ...input };
  const P = +x.sanctioned, n = Math.round(+x.tenure), k = Math.max(0, Math.round(+x.advanceEmis));
  const formulaEmi = x.rateBasis === "flat" ? flatEmi(P, x.rate, n) : pmt(P, x.rate, n);
  const emi = +x.emi > 0 ? +x.emi : formulaEmi;
  const feeGst = x.feeGstIncluded ? 0 : x.processingFee * GST_RATE;
  const upfront = [
    { label: "Processing fee", amount: +x.processingFee },
    { label: "GST on processing fee (18%)", amount: feeGst },
    { label: "Insurance premium", amount: +x.insurance },
    { label: "Other upfront charges", amount: +x.otherUpfront },
    { label: "Broken-period interest", amount: +x.brokenPeriodInterest },
    { label: `Advance instalments (${k} × EMI)`, amount: k * emi },
  ].filter(d => d.amount > 0);
  const deductions = upfront.reduce((a, d) => a + d.amount, 0);
  const listedNet = P - deductions;
  // If the KFS says you receive less than the listed charges explain, the money you
  // actually receive is what determines your true cost.
  const unexplained = +x.statedNetDisbursed > 0 && +x.statedNetDisbursed < listedNet ? listedNet - x.statedNetDisbursed : 0;
  if (unexplained > 0) upfront.push({ label: "Unexplained deduction (KFS net amount)", amount: unexplained });
  const net = listedNet - unexplained;
  const laterPayments = n - k;
  const totalRepaid = emi * n; // includes advance instalments
  return { P, n, k, emi, formulaEmi, upfront, deductions: deductions + unexplained, listedNet, net, laterPayments, totalRepaid, feeGst };
}

/** APR per RBI KFS illustration: monthly IRR on net amount received, × 12. */
export function computeApr(input, { excludeGst = false } = {}) {
  const c = cashflows(input);
  const net = excludeGst ? c.net + c.feeGst : c.net;
  const m = monthlyIrr(net, c.emi, c.laterPayments);
  return { apr: m * 1200, effectiveAnnual: ((1 + m) ** 12 - 1) * 100, monthly: m * 100 };
}

/** Amortisation schedule on the net amount at the APR (for the "show your working" table). */
export function schedule(input) {
  const c = cashflows(input);
  const m = monthlyIrr(c.net, c.emi, c.laterPayments);
  const rows = [];
  let bal = c.net;
  for (let i = 1; i <= c.laterPayments; i++) {
    const interest = bal * m;
    const principal = c.emi - interest;
    bal -= principal;
    rows.push({ month: i, emi: c.emi, interest, principal, balance: Math.max(0, bal) });
  }
  return rows;
}

function finding(status, id, title, detail, rule, action, excess = 0) {
  return { status, id, title, detail, rule: rule && RULES[rule], action, excess: round2(Math.max(0, excess)) };
}

/** Run every check. Returns { summary, findings } with findings ordered by severity. */
export function audit(input) {
  const x = { ...DEFAULTS, ...input };
  const errors = validate(x);
  if (errors.length) return { errors };
  const c = cashflows(x);
  const aprAll = computeApr(x);
  const aprNoGst = computeApr(x, { excludeGst: true });
  const F = [];
  const fmt = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const pct = n => n.toFixed(2) + "%";

  // 1. APR as stated vs recomputed.
  if (x.statedApr > 0) {
    const gap = aprAll.apr - x.statedApr;
    const gapNoGst = aprNoGst.apr - x.statedApr;
    const best = Math.abs(gapNoGst) < Math.abs(gap) ? gapNoGst : gap;
    if (best > 0.25) {
      F.push(finding("issue", "apr_understated", `The APR on your KFS looks understated by about ${best.toFixed(2)} points`,
        `KFS says ${pct(x.statedApr)}. Recomputed from the cash flows you entered: ${pct(aprAll.apr)} including GST on fees (${pct(aprNoGst.apr)} excluding it). RBI requires the APR to include all charges, so a lower figure suggests a cost left out of the calculation.`,
        "kfs", "Ask the lender for the APR computation sheet (RBI requires one in the KFS) and which charges it includes."));
    } else if (best < -0.25) {
      F.push(finding("check", "apr_overstated", "The KFS shows a higher APR than your figures produce",
        `KFS says ${pct(x.statedApr)}, recomputed ${pct(aprAll.apr)}. This usually means a charge on the KFS hasn't been entered here, such as insurance or documentation fees.`,
        "kfs", "Check every charge line on the KFS is entered. If they are, ask the lender which costs make up the difference."));
    } else {
      F.push(finding("ok", "apr_matches", "The stated APR matches the cash flows",
        `KFS ${pct(x.statedApr)} vs recomputed ${pct(aprAll.apr)} (within 0.25 points).`, "kfs", ""));
    }
  } else {
    F.push(finding("check", "apr_missing", "No APR entered from the KFS",
      `Recomputed APR is ${pct(aprAll.apr)}. RBI requires every retail loan KFS to state an all-inclusive APR.`, "kfs",
      "If the lender gave you no KFS or no APR, ask for it in writing before signing."));
  }

  // 2. Net disbursed amount vs deductions.
  if (x.statedNetDisbursed > 0) {
    const hidden = c.listedNet - x.statedNetDisbursed;
    if (hidden > 1) {
      F.push(finding("issue", "hidden_deduction", `${fmt(hidden)} is deducted that the charges you entered don't explain`,
        `Sanctioned ${fmt(c.P)} − listed deductions ${fmt(c.deductions - hidden)} = ${fmt(c.listedNet)}, but the KFS says you'll receive ${fmt(x.statedNetDisbursed)}. The APR above uses the lower amount, because that is what you actually receive.`,
        "kfs", "Ask the lender to itemise every deduction. Charges not in the KFS can't be levied without your explicit consent.", hidden));
    }
  }

  // 3. Flat-rate quote.
  if (x.rateBasis === "flat") {
    const eq = impliedRate(c.P, c.emi, c.n);
    F.push(finding("issue", "flat_rate", `A ${pct(x.rate)} "flat" rate is really about ${pct(eq)} on a reducing balance`,
      `Flat interest is charged on the original amount for the whole tenure, even as you repay it. Your EMI of ${fmt(c.emi)} equals a ${pct(eq)} reducing-balance rate, before fees.`,
      "kfs", "Compare offers only on APR. A flat rate looks roughly half as expensive as it really is."));
  } else if (x.emi > 0) {
    const flat = flatEmi(c.P, x.rate, c.n);
    if (Math.abs(x.emi - flat) < Math.max(2, flat * 0.002) && Math.abs(x.emi - c.formulaEmi) > 2) {
      F.push(finding("issue", "flat_disguised", "This EMI is calculated on a flat rate, not a reducing balance",
        `At ${pct(x.rate)} reducing, the EMI should be ${fmt(c.formulaEmi)}. ${fmt(x.emi)} matches the flat-rate formula instead.`,
        "kfs", "Ask the lender to confirm the interest method in writing.", (x.emi - c.formulaEmi) * c.n));
    } else if (x.emi - c.formulaEmi > Math.max(2, c.formulaEmi * 0.005) && c.k === 0) {
      F.push(finding("check", "emi_high", `The EMI is ${fmt(x.emi - c.formulaEmi)} higher than the stated rate implies`,
        `${pct(x.rate)} over ${c.n} months on ${fmt(c.P)} gives ${fmt(c.formulaEmi)}. The printed EMI implies about ${pct(impliedRate(c.P, x.emi, c.n))}.`,
        "kfs", "Ask what is included in the EMI (for example, an insurance premium spread across instalments).", (x.emi - c.formulaEmi) * c.n));
    }
  }

  // 4. Advance instalments with interest on the full amount (RBI, 29 Apr 2024).
  if (c.k > 0 && x.rateBasis === "reducing") {
    const r = x.rate / 1200;
    const fairEmi = c.P / (c.k + annuity(r, c.n - c.k));
    const ordinary = pmt(c.P, x.rate, c.n);
    if (Math.abs(c.emi - ordinary) <= Math.abs(c.emi - fairEmi) && c.emi - fairEmi > 1) {
      F.push(finding("issue", "advance_emi_full_interest", `Interest seems to be charged on the full amount despite ${c.k} advance instalment${c.k > 1 ? "s" : ""}`,
        `You pay ${c.k} instalment${c.k > 1 ? "s" : ""} upfront, so you never have the full ${fmt(c.P)}. An EMI that reflects that would be ${fmt(fairEmi)}; yours (${fmt(c.emi)}) matches the EMI for the full amount over the full tenure.`,
        "fairInterest", "RBI named this exact practice in April 2024 and asked lenders to refund the excess. Ask for a corrected schedule.", (c.emi - fairEmi) * c.n));
    }
  }

  // 5. Interest from before disbursal (RBI, 29 Apr 2024).
  if (x.interestFromDate && x.disbursalDate) {
    const early = days(x.interestFromDate, x.disbursalDate);
    if (early > 0) {
      const excess = c.P * x.rate / 100 / 365 * early;
      F.push(finding("issue", "interest_before_disbursal", `Interest starts ${early} day${early > 1 ? "s" : ""} before the money reaches you`,
        `Interest from ${x.interestFromDate}, disbursal on ${x.disbursalDate}. That is about ${fmt(excess)} of interest on money you didn't have.`,
        "fairInterest", "Interest may only run from the actual disbursal date. Ask for the excess to be removed or refunded.", excess));
    }
  }

  // 6. Broken-period interest larger than the actual days (RBI, 29 Apr 2024).
  if (x.brokenPeriodInterest > 0 && x.disbursalDate && x.firstEmiDate) {
    const first = new Date(x.firstEmiDate + "T00:00:00Z");
    const periodStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, first.getUTCDate()));
    const gap = Math.max(0, Math.round((periodStart - Date.parse(x.disbursalDate + "T00:00:00Z")) / DAY));
    const fair = c.P * x.rate / 100 / 365 * gap;
    if (x.brokenPeriodInterest - fair > Math.max(10, fair * 0.05)) {
      F.push(finding("issue", "broken_period", `Broken-period interest looks higher than the ${gap} days it covers`,
        `For ${gap} days between disbursal and the start of the first EMI period, interest at ${pct(x.rate)} is about ${fmt(fair)}. You're charged ${fmt(x.brokenPeriodInterest)}.`,
        "fairInterest", "Interest should cover only the days the loan is outstanding, not a whole month. Ask for the day-count calculation.", x.brokenPeriodInterest - fair));
    }
  }

  // 7. Pre-payment charges.
  if (x.prepaymentChargePct > 0) {
    const covered = x.rateType === "floating" && (x.borrower === "individual" || x.purpose === "business");
    if (covered && x.sanctionedOnOrAfter2026 && x.purpose === "non_business") {
      F.push(finding("issue", "prepayment_banned", `A ${x.prepaymentChargePct}% pre-payment charge on this loan isn't allowed`,
        "For floating-rate loans to individuals for non-business purposes, sanctioned or renewed on or after 1 Jan 2026, lenders may not levy pre-payment charges.",
        "prepayment", "Ask the lender to remove the clause before you sign."));
    } else if (covered && x.sanctionedOnOrAfter2026) {
      F.push(finding("check", "prepayment_business", "Pre-payment charges on floating-rate business loans are restricted",
        "The 2025 Directions bar these for most lenders and, for some lender categories, for loans up to ₹50 lakh. It depends on the lender type and amount.",
        "prepayment", "Ask the lender which provision of the 2025 Directions allows this charge."));
    } else if (x.rateType === "floating" && x.borrower === "individual") {
      F.push(finding("check", "prepayment_older", "Check this pre-payment charge with your lender",
        "This loan was sanctioned before 1 Jan 2026, so the 2025 Directions don't apply. Earlier RBI instructions already restricted foreclosure charges on floating-rate term loans to individuals.",
        "prepayment", "Ask the lender which rule permits the charge."));
    } else {
      F.push(finding("info", "prepayment_fixed", `${x.prepaymentChargePct}% pre-payment charge on a fixed-rate loan`,
        "Fixed-rate loans may carry a pre-payment charge if it is disclosed in the sanction letter, agreement and KFS.",
        "prepayment", "Factor this in if you plan to repay early."));
    }
  }

  // 8. Penal interest added to the rate.
  if (x.penalStyle === "rate_added") {
    F.push(finding("issue", "penal_interest", "Late payments are penalised by adding to the interest rate",
      "Since 2024, penalties must be a separate 'penal charge', not extra interest on the rate, and no interest may be charged on them.",
      "penal", "Ask for the penalty to be restated as a fixed penal charge, as RBI requires."));
  }

  // 9. Charges outside the KFS.
  if (x.undisclosedCharges > 0) {
    F.push(finding("issue", "undisclosed", `${fmt(x.undisclosedCharges)} of charges aren't on the KFS`,
      "A charge that isn't in the KFS can't be levied without your explicit consent at any point in the loan.",
      "kfs", "Refuse the charge in writing, or ask the lender to point to it on the KFS.", x.undisclosedCharges));
  }

  // 10. Digital lending: cooling-off.
  if (x.digital) {
    if (x.coolingOffDays === null || x.coolingOffDays === "" || +x.coolingOffDays < 1) {
      F.push(finding("issue", "cooling_off", "No cooling-off period of at least one day is disclosed",
        "Digital loans must allow you to exit within a cooling-off period of at least one day, disclosed in the KFS, by repaying principal and proportionate APR without penalty.",
        "digital", "Ask the lender to confirm the cooling-off period in writing before accepting."));
    } else {
      F.push(finding("ok", "cooling_off_ok", `Cooling-off period: ${x.coolingOffDays} day${+x.coolingOffDays > 1 ? "s" : ""}`,
        "You can exit within this window by repaying principal and the proportionate APR.", "digital", ""));
    }
  }

  // 11. Insurance weight (informational: show what it does to the APR).
  if (x.insurance > 0) {
    const without = computeApr({ ...x, insurance: 0 }).apr;
    F.push(finding("info", "insurance", `Bundled insurance adds ${(aprAll.apr - without).toFixed(2)} points to your APR`,
      `APR with the ${fmt(x.insurance)} premium: ${pct(aprAll.apr)}. Without it: ${pct(without)}. The premium is deducted upfront but you pay interest on it for the whole tenure.`,
      "kfs", "Ask whether the insurance is optional, and compare its price with buying a policy separately."));
  }

  const order = { issue: 0, check: 1, info: 2, ok: 3 };
  F.sort((a, b) => order[a.status] - order[b.status]);
  const excess = F.filter(f => f.status === "issue").reduce((a, f) => a + f.excess, 0);
  return {
    summary: {
      apr: aprAll.apr, aprExGst: aprNoGst.apr, effectiveAnnual: aprAll.effectiveAnnual,
      statedApr: x.statedApr || null, emi: c.emi, net: c.net, sanctioned: c.P, deductions: c.deductions,
      totalRepaid: c.totalRepaid, totalCost: c.totalRepaid - c.net, per100: (c.totalRepaid / c.net) * 100,
      upfront: c.upfront, laterPayments: c.laterPayments, advance: c.k,
      issues: F.filter(f => f.status === "issue").length, checks: F.filter(f => f.status === "check").length,
      estimatedExcess: round2(excess),
    },
    findings: F,
  };
}

export function validate(x) {
  const e = [];
  if (!(x.sanctioned > 0)) e.push("Enter the sanctioned loan amount.");
  if (!(x.rate >= 0 && x.rate < 100)) e.push("Enter the interest rate as a yearly percentage.");
  if (!(x.tenure >= 1 && x.tenure <= 480)) e.push("Tenure must be between 1 and 480 months.");
  if (x.advanceEmis >= x.tenure) e.push("Advance instalments must be fewer than the tenure.");
  if (!e.length) {
    const c = cashflows(x);
    if (c.net <= 0) e.push("Deductions are larger than the loan amount. Check the figures.");
    else if (c.emi * c.laterPayments < c.net) e.push("These instalments repay less than you receive. Check the EMI and tenure.");
  }
  return e;
}

/** Plain-text letter to the lender's Grievance Redressal Officer. Nothing is sent anywhere. */
export function grievanceLetter(result, meta = {}) {
  const issues = result.findings.filter(f => f.status === "issue");
  const fmt = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const lines = [
    `To: The Grievance Redressal Officer, ${meta.lender || "[Lender name]"}`,
    `Subject: Request for clarification and correction – loan ${meta.loanRef || "[application / loan number]"}`,
    "",
    "Dear Sir/Madam,",
    "",
    `I have reviewed the Key Facts Statement for the above loan (sanctioned amount ${fmt(result.summary.sanctioned)}). Based on the figures it contains, I request clarification on the following points:`,
    "",
    ...issues.flatMap((f, i) => [
      `${i + 1}. ${f.title}.`,
      `   ${f.detail}`,
      f.rule ? `   Reference: ${f.rule.name} (${f.rule.ref}, ${f.rule.date}).` : "",
      "",
    ]),
    `Recomputed APR from the KFS cash flows: ${result.summary.apr.toFixed(2)}% (monthly IRR on the net amount received × 12, as illustrated in the RBI KFS circular).`,
    "",
    "Please provide the APR computation sheet and a corrected repayment schedule, and confirm in writing how these points will be resolved. If I do not receive a satisfactory response within 30 days, I may approach the RBI Ombudsman under the Integrated Ombudsman Scheme, 2021 (cms.rbi.org.in).",
    "",
    "Regards,",
    meta.name || "[Your name]",
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
