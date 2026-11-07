import { test } from "node:test";
import assert from "node:assert/strict";
import { pmt, flatEmi, monthlyIrr, impliedRate, computeApr, audit, cashflows, schedule, grievanceLetter, validate, DEFAULTS } from "../src/audit.js";
import { RULES } from "../src/rules.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
const ids = r => r.findings.map(f => f.id);
const status = (r, id) => r.findings.find(f => f.id === id)?.status;

test("reproduces RBI's own KFS illustration: ₹20,000 @ 15% for 24 months with ₹400 charges → APR ≈ 17.07%", () => {
  const { apr } = computeApr({ sanctioned: 20000, rate: 15, tenure: 24, otherUpfront: 400 });
  near(apr, 17.07, 0.02);
});

test("EMI, flat EMI and IRR helpers are mutually consistent", () => {
  near(pmt(500000, 12, 36), 16607.15, 0.05);
  near(flatEmi(100000, 10, 12), 9166.67, 0.01);
  near(impliedRate(500000, pmt(500000, 12, 36), 36), 12, 1e-6);
  assert.ok(Number.isNaN(monthlyIrr(1000, 10, 12))); // repays less than received
});

test("a clean offer with a correct APR produces no issues", () => {
  const base = { sanctioned: 300000, rate: 13, tenure: 36, processingFee: 3000 };
  const apr = computeApr(base).apr;
  const r = audit({ ...base, statedApr: +apr.toFixed(2), statedNetDisbursed: cashflows(base).net });
  assert.equal(r.summary.issues, 0);
  assert.equal(status(r, "apr_matches"), "ok");
});

test("flags an understated APR, accepting either GST treatment", () => {
  const base = { sanctioned: 300000, rate: 13, tenure: 36, processingFee: 6000, insurance: 4500 };
  const r = audit({ ...base, statedApr: 13.0 });
  assert.equal(status(r, "apr_understated"), "issue");
  // A lender that excludes GST from the APR should not be flagged for that alone.
  const exGst = computeApr(base, { excludeGst: true }).apr;
  assert.equal(status(audit({ ...base, statedApr: +exGst.toFixed(2) }), "apr_matches"), "ok");
});

test("detects a deduction the listed charges don't explain", () => {
  const base = { sanctioned: 200000, rate: 14, tenure: 24, processingFee: 2000 };
  const r = audit({ ...base, statedNetDisbursed: cashflows(base).net - 1500 });
  const f = r.findings.find(f => f.id === "hidden_deduction");
  assert.equal(f.status, "issue");
  near(f.excess, 1500, 1);
});

test("converts a flat rate to its reducing equivalent (10% flat over 3 yrs ≈ 17.97% reducing)", () => {
  const r = audit({ sanctioned: 100000, rate: 10, tenure: 36, rateBasis: "flat" });
  const f = r.findings.find(f => f.id === "flat_rate");
  assert.equal(f.status, "issue");
  assert.match(f.title, /17\.9\d%/);
});

test("catches a flat-rate EMI presented as a reducing-balance loan", () => {
  const r = audit({ sanctioned: 100000, rate: 10, tenure: 36, emi: flatEmi(100000, 10, 36) });
  assert.equal(status(r, "flat_disguised"), "issue");
});

test("RBI Apr-2024 malpractice: advance EMIs with interest on the full amount", () => {
  const P = 100000, rate = 24, n = 12;
  const bad = audit({ sanctioned: P, rate, tenure: n, advanceEmis: 2, emi: pmt(P, rate, n) });
  assert.equal(status(bad, "advance_emi_full_interest"), "issue");
  assert.ok(bad.findings.find(f => f.id === "advance_emi_full_interest").excess > 0);
  // A lender that reduces the EMI to reflect the advance instalments is not flagged.
  const r = rate / 1200, fair = P / (2 + (1 - (1 + r) ** -(n - 2)) / r);
  assert.ok(!ids(audit({ sanctioned: P, rate, tenure: n, advanceEmis: 2, emi: fair })).includes("advance_emi_full_interest"));
});

test("RBI Apr-2024 malpractice: interest charged from before disbursal", () => {
  const r = audit({ sanctioned: 1000000, rate: 9, tenure: 120, interestFromDate: "2026-01-01", disbursalDate: "2026-01-11" });
  const f = r.findings.find(f => f.id === "interest_before_disbursal");
  assert.equal(f.status, "issue");
  near(f.excess, 1000000 * 0.09 / 365 * 10, 1);
});

test("RBI Apr-2024 malpractice: a full month of broken-period interest for a few days", () => {
  const base = { sanctioned: 500000, rate: 12, tenure: 60, disbursalDate: "2026-03-28", firstEmiDate: "2026-05-05" };
  // Period starts 5 Apr → 8 days. A full month (~₹5,000) is excessive; the day-count amount is fine.
  assert.equal(status(audit({ ...base, brokenPeriodInterest: 5000 }), "broken_period"), "issue");
  assert.ok(!ids(audit({ ...base, brokenPeriodInterest: Math.round(500000 * 0.12 / 365 * 8) })).includes("broken_period"));
});

test("pre-payment charges: banned for floating, individual, non-business loans from 2026", () => {
  const base = { sanctioned: 3000000, rate: 8.5, tenure: 240, prepaymentChargePct: 2 };
  assert.equal(status(audit({ ...base, rateType: "floating" }), "prepayment_banned"), "issue");
  assert.equal(status(audit({ ...base, rateType: "floating", sanctionedOnOrAfter2026: false }), "prepayment_older"), "check");
  assert.equal(status(audit({ ...base, rateType: "fixed" }), "prepayment_fixed"), "info");
});

test("penal interest added to the rate, undisclosed charges and missing cooling-off are issues", () => {
  const r = audit({ sanctioned: 50000, rate: 30, tenure: 6, penalStyle: "rate_added", undisclosedCharges: 999, digital: true, coolingOffDays: null });
  for (const id of ["penal_interest", "undisclosed", "cooling_off"]) assert.equal(status(r, id), "issue", id);
  assert.equal(status(audit({ sanctioned: 50000, rate: 30, tenure: 6, digital: true, coolingOffDays: 3 }), "cooling_off_ok"), "ok");
});

test("insurance impact is quantified in APR points", () => {
  const f = audit({ sanctioned: 200000, rate: 12, tenure: 24, insurance: 6000 }).findings.find(f => f.id === "insurance");
  assert.match(f.title, /adds \d+\.\d\d points/);
});

test("findings are ordered issue → check → info → ok and every finding cites a real rule", () => {
  const r = audit({ sanctioned: 100000, rate: 10, tenure: 36, rateBasis: "flat", insurance: 2000, statedApr: 30 });
  const rank = { issue: 0, check: 1, info: 2, ok: 3 };
  const ranks = r.findings.map(f => rank[f.status]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const f of r.findings) assert.ok(Object.values(RULES).includes(f.rule), f.id);
  for (const rule of Object.values(RULES)) assert.match(rule.url, /^https:\/\/(www\.|website\.)?(rbi\.org\.in|cms\.rbi\.org\.in)/);
});

test("schedule amortises the net amount to zero at the APR", () => {
  const rows = schedule({ sanctioned: 100000, rate: 15, tenure: 12, processingFee: 2000, advanceEmis: 1 });
  assert.equal(rows.length, 11);
  near(rows.at(-1).balance, 0, 0.01);
});

test("validation rejects impossible inputs instead of producing nonsense", () => {
  assert.ok(validate({ ...DEFAULTS, sanctioned: 0, rate: 10, tenure: 12 }).length);
  assert.ok(validate({ ...DEFAULTS, sanctioned: 1000, rate: 10, tenure: 12, processingFee: 2000 }).length);
  assert.ok(audit({ sanctioned: 1000, rate: 10, tenure: 12, emi: 10 }).errors.length);
});

test("grievance letter lists each issue with its RBI reference and the 30-day Ombudsman path", () => {
  const r = audit({ sanctioned: 100000, rate: 24, tenure: 12, advanceEmis: 2, emi: pmt(100000, 24, 12), penalStyle: "rate_added" });
  const letter = grievanceLetter(r, { lender: "Example Finance Ltd" });
  assert.match(letter, /Example Finance Ltd/);
  assert.match(letter, /RBI\/2024-25\/30/);
  assert.match(letter, /RBI\/2023-24\/53/);
  assert.match(letter, /cms\.rbi\.org\.in/);
});

test("the APR uses the money actually received when the KFS net amount is lower than listed charges explain", () => {
  const base = { sanctioned: 200000, rate: 14, tenure: 24, processingFee: 2000 };
  const listed = cashflows(base).net;
  const withGap = computeApr({ ...base, statedNetDisbursed: listed - 3000 }).apr;
  assert.ok(withGap > computeApr(base).apr + 0.2);
  // A KFS net amount that is higher than our figure never lowers the APR.
  near(computeApr({ ...base, statedNetDisbursed: listed + 5000 }).apr, computeApr(base).apr, 1e-9);
});
