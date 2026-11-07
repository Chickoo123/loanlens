// LoanLens engine: month-by-month multi-loan simulation. Pure functions, no DOM.

/** Standard reducing-balance EMI. rate = annual % ; n = months. */
export function emi(principal, annualRate, months) {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Months needed to repay `principal` with payment `pay` (Infinity if pay never covers interest). */
export function tenureFor(principal, annualRate, pay) {
  const r = annualRate / 1200;
  if (principal <= 0) return 0;
  if (r === 0) return Math.ceil(principal / pay);
  if (pay <= principal * r) return Infinity;
  return Math.ceil(-Math.log(1 - (principal * r) / pay) / Math.log(1 + r));
}

export const STRATEGIES = {
  none: { label: "No prepayment", blurb: "Pay EMIs only. The baseline." },
  avalanche: { label: "Avalanche", blurb: "Extra money goes to the highest effective interest rate first. Mathematically minimises interest." },
  snowball: { label: "Snowball", blurb: "Smallest balance first. Closes loans fastest, which frees up EMIs and keeps you motivated." },
  proportional: { label: "Proportional", blurb: "Spread extra money across loans in proportion to their balances." },
};

/**
 * Effective annual rate used for ranking. Home-loan interest under Sec 24(b) (old regime)
 * is deductible up to ₹2,00,000/yr; we approximate the after-tax rate when a tax slab is given.
 */
export function effectiveRate(loan, taxSlab = 0) {
  if (loan.type === "home" && taxSlab > 0) return loan.rate * (1 - taxSlab / 100);
  return loan.rate;
}

/**
 * Simulate repayment.
 * @param {Array<{id,name,type,principal,rate,emi?,tenure?,penalty?}>} loans  rate in annual %, penalty in % of prepaid amount
 * @param {object} plan  { strategy, extra (₹/month), lumpSums: [{month, amount}], mode: "tenure"|"emi", rollover: bool, taxSlab }
 */
export function simulate(loans, plan = {}) {
  const { strategy = "none", extra = 0, lumpSums = [], mode = "tenure", rollover = true, taxSlab = 0, maxMonths = 600 } = plan;
  const st = loans.filter(l => l.principal > 0).map(l => {
    const pay = l.emi || emi(l.principal, l.rate, l.tenure);
    return { ...l, bal: l.principal, pay, interest: 0, penaltyPaid: 0, prepaid: 0, closedAt: null, remaining: l.tenure || tenureFor(l.principal, l.rate, pay) };
  });
  for (const l of st) if (!isFinite(l.remaining)) throw new Error(`${l.name}: EMI of ₹${Math.round(l.pay)} does not cover the monthly interest.`);

  const timeline = [];
  const lumps = new Map();
  for (const s of lumpSums) if (s.amount > 0) lumps.set(s.month, (lumps.get(s.month) || 0) + s.amount);
  let freed = 0, totalInterest = 0, totalPenalty = 0, month = 0;

  while (st.some(l => l.bal > 0.005) && month < maxMonths) {
    month++;
    // 1) Regular EMIs.
    for (const l of st) {
      if (l.bal <= 0.005) continue;
      const int = l.bal * (l.rate / 1200);
      const pay = Math.min(l.pay, l.bal + int);
      l.bal = l.bal + int - pay;
      l.interest += int; totalInterest += int;
      l.remaining = Math.max(0, l.remaining - 1);
      if (l.bal <= 0.005) { l.bal = 0; l.closedAt = month; if (rollover) freed += l.pay; }
    }
    // 2) Prepayment pool: fixed extra + EMIs freed by closed loans (rollover) + any lump sum.
    let pool = strategy === "none" ? 0 : extra + freed + (lumps.get(month) || 0);
    if (pool > 0) {
      const open = st.filter(l => l.bal > 0.005);
      const order = {
        avalanche: () => [...open].sort((a, b) => effectiveRate(b, taxSlab) - effectiveRate(a, taxSlab) || a.bal - b.bal),
        snowball: () => [...open].sort((a, b) => a.bal - b.bal || b.rate - a.rate),
        proportional: () => open,
      }[strategy]();
      const totalBal = open.reduce((a, l) => a + l.bal, 0);
      const targets = strategy === "proportional"
        ? order.map(l => [l, pool * (l.bal / totalBal)])
        : order.map(l => [l, Infinity]);
      for (const [l, share] of targets) {
        if (pool <= 0.005) break;
        const budget = Math.min(pool, share);
        const p = (l.penalty || 0) / 100;
        const applied = Math.min(l.bal, budget / (1 + p)); // penalty is charged on the amount prepaid
        const cost = applied * (1 + p);
        l.bal -= applied; l.prepaid += applied;
        l.penaltyPaid += applied * p; totalPenalty += applied * p;
        pool -= cost;
        if (l.bal <= 0.005) { l.bal = 0; l.closedAt = month; if (rollover) freed += l.pay; }
        else if (mode === "emi" && l.remaining > 0) l.pay = emi(l.bal, l.rate, l.remaining); // keep tenure, lower EMI
      }
    }
    timeline.push({ month, total: st.reduce((a, l) => a + l.bal, 0), balances: st.map(l => l.bal) });
  }

  return {
    months: month,
    totalInterest, totalPenalty,
    totalCost: totalInterest + totalPenalty,
    loans: st.map(l => ({ id: l.id, name: l.name, closedAt: l.closedAt, interest: l.interest, prepaid: l.prepaid, penalty: l.penaltyPaid, finalEmi: l.pay })),
    timeline,
  };
}

/** Runs every strategy and ranks them by total cost (interest + penalties). */
export function compareStrategies(loans, plan) {
  const out = {};
  for (const key of Object.keys(STRATEGIES)) out[key] = simulate(loans, { ...plan, strategy: key });
  const base = out.none;
  for (const r of Object.values(out)) {
    r.interestSaved = base.totalCost - r.totalCost;
    r.monthsSaved = base.months - r.months;
  }
  const best = Object.keys(out).filter(k => k !== "none").sort((a, b) => out[a].totalCost - out[b].totalCost || out[a].months - out[b].months)[0];
  return { results: out, best };
}

/** Future value of a monthly contribution stream (array of ₹ per month) at annual return %. */
export function futureValue(contributions, annualReturn) {
  const r = annualReturn / 1200;
  return contributions.reduce((fv, c) => fv * (1 + r) + c, 0);
}

/**
 * Prepay vs invest: both paths spend the same cash every month until the baseline debt-free date H.
 *  - Invest path: pay EMIs only and invest `extra` (+ lump sums) monthly; freed EMIs are invested after each loan closes.
 *  - Prepay path: follow `strategy`; once debt-free, invest everything (all EMIs + extra) until H.
 * Compares invested corpus at month H (debt is zero in both by then).
 */
export function prepayVsInvest(loans, plan, annualReturn) {
  const base = simulate(loans, { ...plan, strategy: "none" });
  const pre = simulate(loans, plan);
  const H = base.months;
  const emis = loans.filter(l => l.principal > 0).map(l => l.emi || emi(l.principal, l.rate, l.tenure));
  const allEmi = emis.reduce((a, b) => a + b, 0);
  const lump = m => (plan.lumpSums || []).filter(s => s.month === m).reduce((a, s) => a + s.amount, 0);
  const investStream = [], prepayStream = [];
  for (let m = 1; m <= H; m++) {
    // EMIs no longer owed in the baseline (those loans closed) are invested on the invest path too.
    const freedBase = base.loans.reduce((a, l, i) => a + (l.closedAt && l.closedAt < m ? emis[i] : 0), 0);
    investStream.push((plan.extra || 0) + lump(m) + freedBase);
    prepayStream.push(m > pre.months ? allEmi + (plan.extra || 0) + lump(m) : 0);
  }
  const invest = futureValue(investStream, annualReturn);
  const prepay = futureValue(prepayStream, annualReturn);
  return { horizon: H, investCorpus: invest, prepayCorpus: prepay, winner: prepay >= invest ? "prepay" : "invest", difference: Math.abs(prepay - invest) };
}

/** Yearly amortisation rows for a simulation (for tables). */
export function yearly(result) {
  const rows = [];
  for (let y = 0; y * 12 < result.timeline.length; y++) {
    const end = result.timeline[Math.min(result.timeline.length - 1, y * 12 + 11)];
    rows.push({ year: y + 1, closing: end.total });
  }
  return rows;
}
