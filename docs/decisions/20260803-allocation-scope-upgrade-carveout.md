# Allocation scope — payment carve-out for room conversions

Date: 2026-08-03
Source: greybeard cycle tasks/2026-08-03-allocation-room-switch/ (G1 declaration, granted)
Status: DECIDED

## Context

The Aug-15 shared-triple capacity crunch requires converting triple rooms to doubles. Branch
reps (allocation-only accounts) coordinate this: they switch a registration's room type and
chase the resulting price difference over WhatsApp. The 2026-07-23 decision
(`20260723-capability-scopes-deferred.md`) had verified the `allocation` scope carried no
payment data at all — this feature is the first deliberate widening of that surface.

## Decided

1. **Scope posture** (stakeholder, verbatim): "yes and I would like to keep it like that
   [allocation scope free of payment data] — but for the people paying for the upgraded
   rooms, we still need to show the pending amount and payment link gen option. careful to
   not reveal anything more than necessary for the branch reps (like donation, total
   amounts etc)". Codified as `access-control.spec.md` R2.6: allocation payloads may carry
   registration status, a single outstanding-balance number, and generated payment links —
   never donations, totals, breakdowns, payment histories, or documents.

2. **Exposure population** (stakeholder, G1 question tool): "Any outstanding balance" —
   the pending amount and payment-link action show for every non-confirmed registration in
   the allocation list, not only converted ones. (Lead had recommended upgrade-dues-only;
   overridden.)

3. **Conversion range** (stakeholder, G1 question tool): one-way `shared_triple` →
   `shared_double` only. No general room-type switcher; downgrades and other conversions
   stay on the dashboard-scoped staff edit path.

4. **Status semantics**: registration statuses remain `pending` / `pending_verification` /
   `confirmed` (no new status). A conversion drops a confirmed registration to `pending`
   with a `payment_pending` payments row for the difference. Both non-confirmed statuses
   are shown in the allocation UI (stakeholder, same turn as #1).

5. **Preferences on conversion** (stakeholder, G2 question tool, D4): "Retain them" —
   a shared→shared conversion keeps all roommate preferences involving the registration;
   type-mismatched pairs render as incompatible until reps adjust them. This is an explicit
   exception to `roommate-preferences.spec.md` R6.1 (whose general cleanup rule is itself
   unimplemented — see the [REVIEW]/DF-D tag there; disposition out of this cycle's scope).
   Rationale: reps convert triple-groups one person at a time; deletion would destroy the
   group's mutual preferences mid-sequence.

## Why

Branch reps must complete conversions and collect the difference without being granted the
`dashboard` scope (which bundles full registration detail: donations, documents, verify/edit
powers). A narrow widening of `allocation` is smaller than granting `dashboard` to ~10-15
reps, and keeps the 2026-07-23 deferral of the capability model intact.

## Limitations

- `pendingAmount` is total-minus-verified; for a person with unpaid non-accommodation dues
  it embeds those too. Accepted — it is a single actionable number with no breakdown.
- No in-UI price preview before conversion; reps learn the delta from the conversion result
  (or the Aug-15 contact campaign sheets). Revisit if reps ask for a preview.

## Reversal triggers

- Reps report confusion or complaints about amount visibility → narrow to upgrade-dues-only
  (the rejected alternative in #2).
- A second scope needs a similar carve-out → that is capability-model trigger territory;
  revisit `20260723-capability-scopes-deferred.md` instead of stacking carve-outs.
