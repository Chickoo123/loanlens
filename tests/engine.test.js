import { test } from "node:test";
import assert from "node:assert/strict";
import { emi, tenureFor, simulate, compareStrategies, prepayVsInvest, futureValue, effectiveRate } from "../src/engine.js";

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test("EMI matches the standard formula (₹50L @ 8.5% for 20y ≈ ₹43,391)", () => {
  near(emi(5_000_000, 8.5, 240), 43391.16, 0.5);
  near(emi(120_000, 0, 12), 10000, 1e-9);
  assert.equal(emi(0, 10, 12), 0);
});

test("tenureFor inverts the EMI formula and detects payments that never amortise", () => {
  assert.equal(tenureFor(5_000_000, 8.5, emi(5_000_000, 8.5, 240)), 240);
  assert.equal(tenureFor(100_000, 12, 1000), Infinity); // interest is exactly ₹1,000/month
});

test("baseline simulation repays exactly on schedule and interest = payments − principal", () => {
  const r = simulate([{ id: 1, name: "Car", principal: 800_000, rate: 9, tenure: 60 }]);
  assert.equal(r.months, 60);
  near(r.totalInterest, emi(800_000, 9, 60) * 60 - 800_000, 2);
  assert.equal(r.timeline.at(-1).total, 0);
});

test("prepaying (reduce tenure) shortens the loan and saves interest", () => {
  const loans = [{ id: 1, name: "Home", principal: 5_000_000, rate: 8.5, tenure: 240 }];
  const base = simulate(loans);
  const pre = simulate(loans, { strategy: "avalanche", extra: 10_000 });
  assert.ok(pre.months < base.months - 60, `${pre.months}`);
  assert.ok(pre.totalInterest < base.totalInterest - 1_500_000);
});

test("reduce-EMI mode keeps the tenure but lowers the EMI, and saves less than reduce-tenure", () => {
  const loans = [{ id: 1, name: "Home", principal: 3_000_000, rate: 9, tenure: 180 }];
  const lump = [{ month: 12, amount: 500_000 }];
  const tenure = simulate(loans, { strategy: "avalanche", lumpSums: lump, mode: "tenure" });
  const emiMode = simulate(loans, { strategy: "avalanche", lumpSums: lump, mode: "emi" });
  assert.equal(emiMode.months, 180);
  assert.ok(emiMode.loans[0].finalEmi < emi(3_000_000, 9, 180));
  assert.ok(tenure.months < 180);
  assert.ok(tenure.totalInterest < emiMode.totalInterest);
});

const portfolio = [
  { id: 1, name: "Home loan", type: "home", principal: 4_000_000, rate: 8.6, tenure: 240 },
  { id: 2, name: "Car loan", type: "car", principal: 600_000, rate: 9.5, tenure: 60 },
  { id: 3, name: "Personal loan", type: "personal", principal: 250_000, rate: 14, tenure: 36 },
  { id: 4, name: "Credit card EMI", type: "card", principal: 60_000, rate: 18, tenure: 12 },
];

test("avalanche never pays more interest than snowball or proportional (no penalties)", () => {
  const { results, best } = compareStrategies(portfolio, { extra: 15_000 });
  assert.ok(results.avalanche.totalCost <= results.snowball.totalCost + 1);
  assert.ok(results.avalanche.totalCost <= results.proportional.totalCost + 1);
  assert.equal(best, "avalanche");
  assert.ok(results.avalanche.interestSaved > 0 && results.avalanche.monthsSaved > 0);
});

test("snowball closes the smallest loan first", () => {
  const r = simulate(portfolio, { strategy: "snowball", extra: 15_000 });
  const firstClosed = [...r.loans].sort((a, b) => a.closedAt - b.closedAt)[0];
  assert.equal(firstClosed.name, "Credit card EMI");
});

test("rollover of freed EMIs accelerates payoff", () => {
  const withRoll = simulate(portfolio, { strategy: "avalanche", extra: 5_000, rollover: true });
  const without = simulate(portfolio, { strategy: "avalanche", extra: 5_000, rollover: false });
  assert.ok(withRoll.months < without.months);
});

test("prepayment penalties are charged and can make avalanche skip a penalised loan's advantage", () => {
  const loans = [{ id: 1, name: "Fixed", principal: 500_000, rate: 12, tenure: 60, penalty: 4 }];
  const r = simulate(loans, { strategy: "avalanche", extra: 10_000 });
  assert.ok(r.totalPenalty > 0);
  near(r.loans[0].penalty, r.loans[0].prepaid * 0.04, 1);
});

test("home-loan tax benefit lowers the effective rate used for ranking", () => {
  assert.equal(effectiveRate({ type: "home", rate: 9 }, 30), 6.3);
  assert.equal(effectiveRate({ type: "car", rate: 9 }, 30), 9);
});

test("futureValue of ₹10k/month for 12 months at 12% ≈ ₹1,26,825", () => {
  near(futureValue(Array(12).fill(10_000), 12), 126825, 1);
});

test("prepay vs invest: a 7% loan loses to 12% returns; an 18% loan beats them", () => {
  const cheap = [{ id: 1, name: "Cheap", principal: 2_000_000, rate: 7, tenure: 180 }];
  const dear = [{ id: 1, name: "Dear", principal: 2_000_000, rate: 18, tenure: 180 }];
  assert.equal(prepayVsInvest(cheap, { strategy: "avalanche", extra: 20_000 }, 12).winner, "invest");
  assert.equal(prepayVsInvest(dear, { strategy: "avalanche", extra: 20_000 }, 12).winner, "prepay");
});

test("an EMI that cannot cover interest is rejected with a clear error", () => {
  assert.throws(() => simulate([{ id: 1, name: "Bad", principal: 1_000_000, rate: 12, emi: 5_000 }]), /does not cover/);
});
