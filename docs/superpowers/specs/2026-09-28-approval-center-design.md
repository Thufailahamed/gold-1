# GoldOS — Unified Approval Engine + Approval Center Design (Slice 1 of Production Hardening)

Date: 2026-09-28
Status: Approved (unified table + async request-first, inline fast path retained, lazy + sweep expiry)
Scope: One approvals table, per-action settings configuration, async lifecycle with exactly-once execution, wiring for all 12 high-risk actions, Approval Center API + UI. Follow-ups in order: Audit Center search, then the security review document.

## 1. Context

Approvals today are per-module and ad-hoc: expense approve/reject, sales discount + return `approvedBy`, melt/mfg loss thresholds (`melt_loss_approve_pct`, `mfg_loss_approve_pct`), transfer + count + custom-order approvals, each with its own `approved_by` column. There is no unified request lifecycle, no expiry, and no Pending/Approved/Rejected/Expired center. Audit is append-only (`audit_logs` written atomically with every mutation; `GET /audit` filters entity/entityId/userId only). Thresholds already live in `settings` per business-rules, which mandates business rules as configuration, never code.

User-confirmed decisions:
- First spec is the unified approval engine + Approval Center; Audit Center and security review follow.
- Async request-first engine; existing inline `approvedBy` stays as the same-counter fast path.
- Expiry is per-action configurable TTL, terminal, evaluated lazily plus a sweep.

## 2. Schema (new migration, `approvals` table)

`id`, `action` (12 fixed keys: `SALES_DISCOUNT`, `PRICE_OVERRIDE`, `GOLD_RATE_CHANGE`, `GOLD_STOCK_ADJUST`, `INVENTORY_ADJUST`, `OLDGOLD_VALUATION`, `MELT_DIFFERENCE`, `MFG_DIFFERENCE`, `SALES_CANCEL`, `PURCHASE_CANCEL`, `SALES_RETURN`, `FIN_ADJUST`), `entity` + `entity_id` (the pending document/transaction), `requester_id`, `approver_id` (null until decided), `old_value_json` + `new_value_json` (exact before/after shown in the Center), `reason` (required at request time), `branch_id`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`), `expires_at`, `decided_at`, `created_at`. Rows are append-only: decisions UPDATE only status/decider columns; nothing is ever deleted. Request writes batch with their `audit_logs` row atomically, per architecture.

## 3. Configuration (all in `settings`)

Per action: `approval_threshold_<action>` (above → async request; at-or-below → immediate execution with audit row), `approval_ttl_<action>_hours` (default via `approval_default_ttl_hours`, 48), `approval_perm_<action>` (deciding `:approve` permission; defaults to the domain approver, e.g. `sales:approve`). Threshold empty/zero disables the async path (immediate + audited) — rollout and emergency bypass are configuration, not code.

## 4. Lifecycle and execution

Request → `PENDING` (`expires_at = now + TTL`). Approve → the registered handler executes the underlying service call in the same atomic batch as the status flip → `APPROVED`. Reject (reason required) → `REJECTED`, nothing executes. Expired requests are terminal: never approvable, only re-requestable as new rows. Expiry evaluates lazily on read plus a periodic sweep; no load-bearing background worker. Approve/Reject are single conditional writes (`UPDATE ... WHERE status='PENDING'`): second decider gets `409 CONFLICT`, and the handler runs exactly once inside the flipping batch. Under-threshold call sites execute immediately and write an auto-approved row (`approver_id` null, reason recorded as below-threshold) for complete history. Inline `approvedBy` fast path retained where the approver is present.

## 5. Approver rules and the 12 wirings

Approver ≠ requester (codebase second-person rule), must hold the configured `:approve` permission; self-approval → `403`, wrong permission → `403`, deciding expired → `409`; member-branch scoping applies. Each of the 12 call sites computes old/new values and either executes or returns `202 PENDING` with the approval id: sales discount gate, price override, gold-rate create, gold adjustment, inventory adjustment, old-gold valuation override, melt/mfg difference confirmations, sales/purchase cancellations, returns, manual journal adjustments.

## 6. Approval Center

`GET /api/v1/approvals` filters status (Pending/Approved/Rejected/Expired), action, branch, requester; rows carry requester, approver, action, old/new values, reason, date/time. `POST /:id/approve`, `POST /:id/reject` (reason required) with Section-5 guards. `/(app)/approvals` page: four tabs, expandable old→new diffs, approve/reject on Pending, explicit expired copy. Sidebar link gated on any `:approve` permission. No permission-matrix additions (count stays 53).

## 7. Testing

Unit: TTL/expiry, double-decide 409, self-approve 403, threshold boundary (at executes, above pends). Integration: full async cycle for a sales action and a ledger action proving exactly-once execution + audit row. Full `pnpm test` green, no regressions.

## 8. Out of scope (follow-up specs)

- Audit Center search extension (action, date, branch, transaction ID filters + UI).
- Security review document (controls inventory + residual operational requirements, no perfection claims).
