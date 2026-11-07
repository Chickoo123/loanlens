<div align="center">

# LoanLens

**Pay off every loan years earlier, and know exactly why.**

[![Test & deploy](https://github.com/Chickoo123/loanlens/actions/workflows/ci.yml/badge.svg)](https://github.com/Chickoo123/loanlens/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Chickoo123/loanlens/actions/workflows/codeql.yml/badge.svg)](https://github.com/Chickoo123/loanlens/actions/workflows/codeql.yml)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-8b5cf6)
![License](https://img.shields.io/badge/license-MIT-blue)

### [▶ Open the live app](https://chickoo123.github.io/loanlens/)

<img src="docs/dashboard.png" alt="LoanLens comparing prepayment strategies across a home, car and personal loan" width="860">

</div>

## The problem

Most Indian households carry several loans at once: a home loan, a car loan, a personal loan, a credit-card EMI. When a bonus arrives or there's ₹15,000 spare each month, the right question is *"which loan should get it, and should I prepay at all?"*

Bank EMI calculators handle **one loan at a time** and ignore the details that change the answer:

- **Reduce tenure or reduce EMI?** Banks ask after every prepayment, and the two can differ by lakhs.
- **Prepayment penalties** on fixed-rate and personal loans. RBI bars these on floating-rate loans to individuals, but not on every loan.
- **Section 24(b)**, which makes a home loan's after-tax rate lower than its sticker rate.
- **Freed EMIs.** When one loan closes, its EMI can roll into the next one (snowball/avalanche).
- **Opportunity cost.** Would the same money grow more if invested?

LoanLens simulates **all your loans together, month by month**, under every strategy, and shows the answer in one screen.

## Features

- **Strategy comparison:** No prepayment vs **Avalanche** (highest after-tax rate first) vs **Snowball** (smallest balance first) vs **Proportional**, ranked by total interest plus penalties. The best one is highlighted.
- **Headline answer:** "Debt-free by Mar 2035, 11 yrs 7 mo sooner, saving ₹29 L in interest."
- **Balance-over-time chart** against the EMI-only baseline, plus a per-loan **payoff timeline**.
- **Reduce tenure vs reduce EMI** modelled exactly. In EMI mode the EMI is recalculated on the new balance over the remaining tenure.
- **Lump sums** in any month, **prepayment penalties** per loan, and **rollover** of freed EMIs.
- **Prepay vs invest verdict.** Both paths spend identical cash each month, and wealth is compared on the date the loans would have closed anyway.
- **Shareable scenarios:** the full state is encoded in the URL hash. Nothing is stored on a server, and the strict CSP blocks all network access.

## How the engine works

`src/engine.js` is a pure, DOM-free simulator, so the same code runs in the browser and in CI.

```
for each month:
  1. every open loan accrues interest (balance × r/12) and pays its EMI
  2. loans that close release their EMI into the "freed" pool (if rollover is on)
  3. prepayment pool = extra + freed EMIs + any lump sum due this month
  4. the pool is allocated by strategy order; each prepayment is grossed up for its
     penalty (applied = budget / (1 + penalty%))
  5. reduce-EMI mode re-amortises the EMI over the remaining tenure
```

EMI uses the standard reducing-balance formula `P·r·(1+r)^n / ((1+r)^n − 1)`, and tenure is solved in closed form with logarithms. An EMI that can't cover the monthly interest is rejected with a clear error instead of looping forever.

## Tests

13 `node:test` suites check the maths against known values and invariants:

- EMI for ₹50 L at 8.5% over 20 years = ₹43,391.16, and tenure inverts it exactly
- Baseline total interest equals EMI × n − principal
- Avalanche never costs more than Snowball or Proportional when there are no penalties
- Reduce-tenure always saves more interest than reduce-EMI for the same prepayment
- Rollover strictly shortens payoff, penalties are charged at the configured rate, and the 24(b) after-tax rate is correct
- Prepay vs invest flips correctly: a 7% loan loses to 12% returns, and an 18% loan wins

```bash
npm test        # Node 20+, no install needed
npm run serve   # or: python -m http.server
```

Or open it in **GitHub Codespaces**, which uses the preconfigured dev container.

## Stack

Vanilla ES modules, hand-built SVG charts, and CSS custom-property theming (dark/light). No framework, no build step, zero runtime dependencies. GitHub Actions runs the tests on Node 20 and 22, CodeQL scans every push, and Pages deploys after tests pass.

---

Built by [Harshil Desai](https://github.com/Chickoo123). Educational estimates only. Banks may round, compound, or apply prepayments differently, so check your loan agreement. Not financial advice.
