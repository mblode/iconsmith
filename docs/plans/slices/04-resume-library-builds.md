# 04 Generate and resume a bounded library locally

Read the common contracts, STOP conditions and verification in [the authoritative plan](../reference-guided-foundry.md). This is a local planning ticket, not dispatched work.

**What to build:** An operator supplies a pinned concept/variant manifest and total budget to a local builder, can interrupt/restart it, and obtains durable outcomes without automatically paying again for completed or uncertain work.

**Blocked by:** 03 with a passing frozen coverage trial and qualified manifest/capabilities; a completed failed trial does not unlock batch work.

## Acceptance criteria

- [ ] Jobs schedule pinned generated anchors before dependent siblings, and a final family check catches shared-rule drift and semantic collisions.
- [ ] Preview validates manifest coverage and shows planned items with no provider calls.
- [ ] A persistent local SQLite ledger pins operation, source/style/compiler/model identities; it is outside temporary storage.
- [ ] Two processes cannot claim/spend for the same item concurrently; initial execution uses one worker.
- [ ] Reservations are committed before calls; completed results and receipts are persisted; replaying completion makes no provider call.
- [ ] A crash after a possible provider success produces uncertain status and reconciliation/manual retry behavior, never automatic redraw.
- [ ] Unknown actual cost retains reservation and stops additional spend; aggregate budget includes failed attempts.
- [ ] Cancellation prevents new work and retains completed artifacts and uncertain in-flight status.
- [ ] Corrupt ledger, unavailable pinned revision and incompatible resume configuration stop before calls; errors name the recovery action.
- [ ] The output records the actual local route and does not assert parity with Studio without a comparison.

## Verification and finish

Run touched-scope tests and the common plan gates. Record the command, expected behavior, actual result and artifact locations in the implementation notes. Paid experiments require an explicit total ceiling. Stop only the dependent work when a named STOP condition is met; continue independent work. The ticket closes when its observable outcome and all criteria are evidenced, not when files merely exist.
