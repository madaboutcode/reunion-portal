# Capability-based scope model — deferred

Date: 2026-07-23
Source: grill-me session on the RBAC fix queue (cycle tasks/2026-07-23-rbac-compliance/)
Status: DEFERRED — recorded so the thinking survives until the trigger fires

## Considered

Splitting the coarse `dashboard` scope into composable **capabilities** rather than
persona-shaped scopes. The maintainer's axes, from the session:

1. **See coordination details** — attendee list, guests, accommodation type, check-in/out.
2. **See money** — payments, donations, totals. Carve-out: helpers coordinating
   registrations DO need the pending/unpaid amount for people who haven't paid, while
   having no business seeing donations or totals.
3. **See privileged documents** — ID documents, payment split/proofs, donation details.
4. **Approve / verify** — payment verification and similar operations, distinct from
   viewing.

Personas compose from capabilities, not the other way around:
- **Branch representatives** — coordination view (list, accommodation); payments and
  donation amounts hidden; possibly pending-payment visibility (undecided).
- **Registration helpers** — coordination view incl. guests and accommodation; pending
  amounts yes; donations/totals no.
- **Committee / report readers** — aggregate reports only, no personal details; donor
  call-outs in reports hidden for this persona.
- **Admins** — everything.

Also raised: UI-level blocking of specific sections/columns per capability, and hiding
donor call-outs in existing reports.

## Chosen

Defer the whole capability model. Keep the current six flat scopes
(`dashboard`, `resources`, `reports`, `allocation`, `admin-tools`, `bank_txns`) and
control exposure by assignment.

## Why

Maintainer, verbatim intent: "this is a pretty complicated piece of work, and there is no
requirement for any of these things right now, other than the allocation part…
I don't want to overly complicate things, but I also don't want us to lose track of
the security surface."

The one live requirement — allocation-only accounts (incoming branch reps) must not
reach privileged APIs or data — is satisfied without the split: verified 2026-07-23
that the allocation API payloads carry coordination fields only (no payment, donation,
or ID-doc data; `allocation.routes.ts`), and the requireScope fail-open fix (cycle
slice t1) closes the middleware edge that could silently widen an allocation-only
account.

## Limitations

> **Amended 2026-08-03:** the "allocation payloads carry coordination fields only" property
> below is narrowed by a deliberate carve-out — registration status, outstanding balance,
> and payment-link generation are now allocation-visible. See
> `20260803-allocation-scope-upgrade-carveout.md` and `access-control.spec.md` R2.6.

- Anyone holding `dashboard` sees everything it bundles: full registration detail
  (donations, ID docs, proofs) plus verify/reject/edit/archive/export/refund powers.
  Mitigation is assignment discipline, not mechanism.
- Reports currently include donor call-outs visible to any `reports`-scope holder.
- The spec's Open Scoping Questions Q1/Q2 (moving export/photo/files/refunds between
  scopes) stay open; they become moot or trivial once the capability model lands.

## Reversal triggers

Revisit (i.e., design the capability model) when ANY of:
1. A restricted persona beyond allocation actually onboards — registration helpers or
   report-only committee members need accounts.
2. The committee asks for donor-anonymized reports.
3. Someone needs registration lookup without payment/approve powers and the public
   Who's Coming page doesn't cover it.

The safety of this deferral is also conditional on cycle slice t1 (requireScope
fail-closed) shipping — recorded in the cycle register (R11).
