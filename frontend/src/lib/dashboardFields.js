// Single source of truth for interpreting shared fields from GET /api/dashboard.
//
// Why this file exists: Dashboard.jsx and Budget.jsx both display "Monthly Income"
// from the same dashboard payload, but used to read two different fields (one read
// the real income figure, the other read a cash-position field that happened to also
// be a number). They silently disagreed for a while because nothing forced a shared
// definition. Add a getter here — not inline field access — for any concept (income,
// spendable, etc.) that more than one page displays, so a backend rename or rework
// only requires updating one call site instead of hunting through every page.

// Total paychecks landing within the calendar month: already received + still projected.
// This is THE income figure — always all paychecks for the month, nothing else mixed in.
export function getMonthlyIncome(dash) {
  return dash?.monthly_income ?? 0
}
