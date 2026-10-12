# Accounts assistant

A chat in the Accounts suite (`/accounts/assistant` — the **Assistant** tab in the Accounts section rail, and **Assistant** under **Money** in the sidebar; `/assistant` redirects there) that
answers questions about the books and prepares postings for a person to
confirm. The Accounts overview hero carries an **Ask the books** bar: a
question asked there opens the assistant with it already sent, for the branch
picked on the overview (`/accounts/assistant?q=…&branch=…`, sent once, then the
URL is cleaned). It is available to anyone with `accounts:view` or `accounts:manage`.

## Models and AI Gateway

Every model call is a Workers AI run routed through **Cloudflare AI Gateway**
(`env.AI.run(model, inputs, { gateway: { id } })`), so logs, analytics, rate
limits and spend caps are managed in the gateway dashboard.

| Setting (`wrangler.toml` `[vars]`) | Default | Purpose |
|---|---|---|
| `AI_GATEWAY_ID` | `default` | Gateway the calls go through |
| `ASSISTANT_MODEL` | `@cf/zai-org/glm-5.3-flash` | Primary model ($0.15 in / $0.50 out per 1M tokens, 1M context, tool calling) |
| `ASSISTANT_FALLBACK_MODEL` | `@cf/zai-org/glm-4.7-flash` | Used only when the primary errors or returns nothing ($0.06 / $0.40) |
| `ASSISTANT_REASONING_EFFORT` | `high` | `low` \| `high` \| `max`, primary only |

Binding: `[ai] binding = "AI"`. GLM-5.3 Flash needs the Workers Paid plan or
prepaid AI Gateway credits. Gateway caching is skipped on every call: books
change by the minute and a cached answer would be a wrong one.

Shop settings: `assistant_enabled` (boolean) turns it off;
`assistant_daily_request_limit` (default 200) caps questions per user per day.
Token use per user per day is in `assistant_usage`.

## Why the figures are right

- **No figure comes from the model.** The model only chooses which tool to
  call; every tool calls the same service the matching screen uses
  (`trialBalance`, `profitAndLoss`, `listReceivables`, `buildClosingReport`,
  `investigateDay`, `reconcile`, …). The system prompt forbids stating any
  number not returned by a tool in the conversation.
- **Units are converted before the model sees them.** Cents, milligrams,
  basis points and epoch timestamps are turned into `"LKR 12,345.50"`,
  `"12.345 g"`, `"18.00%"` and shop-local `"2026-10-10 14:05"` by
  `assistant/present.ts`, so the model quotes rather than converts.
- **Arithmetic is a tool.** `calculate` is a parser (never `eval`); the model
  is told to use it for any sum, difference or percentage.
- **Dates are the server's.** "Today", the time and the financial year are
  computed from the server clock and `business_tz_offset_minutes`, and put in
  the prompt on every request. Relative periods ("last month", "this financial
  year", "Q2") are resolved by `assistant/time.ts`, never by the model.
  Invoice-based reports use shop-local day bounds (`localDayBoundsMs`).
- **Answers state their scope.** Every result carries the branch (or "whole
  shop") and the period it covers.
- **Long lists say they are cut.** A truncated result says so, and the model is
  told not to total from it.

## Access

- The model is only offered tools the user holds permission for.
- Branch scope is enforced in the tools with `branchScope`: a user without
  `branches:manage` can only read their own branches, and cannot name another.
  With no branch named, a shop-wide user gets the whole shop; others get the
  branch selected in the top bar.
- Conversations and confirm cards belong to one user.

## Postings

A `propose_*` tool never writes. It resolves names to records, builds the exact
body the existing route expects, validates it with that route's own Zod schema,
and stores a `PENDING` row in `assistant_actions`. The web shows it as a card
with **Confirm and post** / **Cancel**.

Confirm (`POST /assistant/actions/:id/confirm`) replays the stored request
through the app itself with the confirming user's session cookie and an
idempotency key derived from the action id. The route therefore applies its
permission check, approval thresholds (a manual adjustment or a large expense
goes to approval and the card says so), day and financial-year locks, the
atomic batch and the audit row — exactly as for a click on its own screen. A
double click or retry cannot post twice. Cards expire after 30 minutes.

| Tool | Route |
|---|---|
| `propose_expense` | `POST /expenses` |
| `propose_expense_decision` | `POST /expenses/:id/approve` \| `reject` |
| `propose_cash_entry` | `POST /cash/entries` |
| `propose_bank_deposit_or_withdrawal` | `POST /cash/deposits` \| `withdrawals` |
| `propose_cash_transfer` / `propose_receive_cash_transfer` | `POST /cash/transfers`, `/:id/receive` |
| `propose_customer_receipt` | `POST /receipts` |
| `propose_supplier_payment` | `POST /purchases/invoices/:id/payments` |
| `propose_tax_payment` | `POST /accounts/tax/payments` |
| `propose_card_settlement` | `POST /card-settlements` |
| `propose_journal_adjustment` | `POST /accounts/adjustments` |
| `propose_reverse_entry` | `POST /accounts/journal/reverse` |
| `propose_day_close` | `POST /day-closings` |

## Read tools

`resolve_period`, `calculate`, `list_branches`, `chart_of_accounts`,
`account_balance`, `trial_balance`, `profit_and_loss`, `balance_sheet`,
`account_statement`, `journal_entries`, `journal_entry`, `cash_position`,
`daily_cash_summary`, `cash_transfers`, `receivables`, `customer_account`,
`payables`, `supplier_account`, `expenses`, `expense_summary`,
`expense_categories`, `day_closing`, `investigate_cash_difference`,
`unclosed_days`, `day_closings`, `reconciliation`, `vat_report`,
`tax_settings`, `sales_summary`, `purchase_summary`, `gold_rates`,
`gold_stock`, `pending_approvals`, `financial_years`, `find_document`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/v1/assistant/status` | model, fallback, gateway, whether the binding exists |
| POST | `/api/v1/assistant/chat` | `{ message, conversationId?, branchId? }` → `{ conversationId, reply, actions, toolsUsed, model }` |
| GET | `/api/v1/assistant/conversations` | the user's conversations |
| GET | `/api/v1/assistant/conversations/:id` | messages and confirm cards |
| DELETE | `/api/v1/assistant/conversations/:id` | archive (pending cards are cancelled) |
| POST | `/api/v1/assistant/actions/:id/confirm` | post it through the real route |
| POST | `/api/v1/assistant/actions/:id/cancel` | discard it |

Errors: `429 RATE_LIMITED` (daily cap), `503 AI_UNAVAILABLE` (both models
failed), plus the usual envelope.

## Code

```
apps/api/src/assistant/
  llm.ts        gateway client, response normaliser, fallback
  context.ts    user, permissions, branch scope, shop clock
  time.ts       business date, named periods, local day bounds
  present.ts    cents/mg/time → display strings, truncation
  calc.ts       safe arithmetic
  prompt.ts     system prompt
  agent.ts      the tool loop and conversation store (max 8 tool steps)
  actions.ts    confirm / cancel through the real routes
  tools/        read.ts, write.ts, lookup.ts, kit.ts, index.ts
apps/api/src/routes/assistant.ts
apps/api/drizzle/0039_assistant.sql
apps/web/app/(app)/accounts/assistant/page.tsx, components/ask-books.tsx,
lib/assistant.ts, components/markdown.tsx  (app/(app)/assistant is a redirect)
```

Tests: `assistant/assistant.test.ts` (units), `assistant/tools/tools.integration.test.ts`
(every tool against the real schema), `routes/assistant.integration.test.ts`
(the whole flow with a scripted model: answers, follow-ups, propose → confirm
→ posted once, refusals, scope, runaway loops, model outage).

## Deploying

```
./scripts/cloudflare-sync.sh   # applies 0039_assistant.sql (tracked in schema_migrations) and deploys the worker with the [ai] binding
```

Then open AI Gateway in the Cloudflare dashboard to watch requests and set
spend limits.

## Scan a bill

`POST /api/v1/expenses/scan` (`accounts:manage`, multipart `file`: jpeg/png/webp, max 4 MB).
The **Record expense** form has a **Scan a bill** control: a photo goes to a
Workers AI vision model (`ASSISTANT_VISION_MODEL`, default
`@cf/meta/llama-4-scout-17b-16e-instruct`) through the same AI Gateway, which
returns vendor, date, total, currency, description and a category from the
shop's own list. The result only **fills the form**; the person reviews it and
records the expense the normal way, so thresholds, approvals and locks still
apply, and the photo is attached as the receipt once it exists.

The model is not trusted: `ai/billscan.ts` validates the date (real, not in the
future), the amount, and that the category is one of the shop's. A bill in
another currency leaves the amount blank rather than guessing a rate. Each scan
counts against the user's daily AI request limit.

## Daily brief

`ai_briefs` (migration `0040_ai_features.sql`) holds one brief per shop-local
day. An hourly cron (`maybeRunBrief`) writes it once the shop-local hour
reaches `brief_hour` (setting, default 21); `brief_enabled` turns it off.
`GET /api/v1/assistant/brief` returns the latest, limited to the user's
branches; `POST /api/v1/assistant/brief/refresh` (`accounts:manage`) rewrites
today's. It is shown on the Accounts overview.

Findings are computed by code from the books (`ai/brief.ts`): yesterday's cash
difference, days never closed, sales far under the branch's 30-day average,
voids, high discounts, large expenses, expenses held for approval, and money
owed over 90 days. The model only words the list. Every number in its wording
must appear in the findings; otherwise the brief uses the rule-written summary
(`model` shows `rules`). A branch-limited user gets only their branches and the
rule-written summary.
