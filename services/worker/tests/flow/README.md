# Flow Tests

End-to-end conversation tests. Each test runs real session/controller code against an
in-memory Firestore, records every Telegram call, and clicks buttons from the **actual
keyboard the bot sends** — not hardcoded callback data.

Run: `npm run test:flow`

---

## Receipt (`receipt.flow.test.ts`) — 10 tests

The receipt flow lets users create a payment receipt linked to one or more open invoices.

| Test | What it covers |
|------|----------------|
| partial payment | Full happy path for a partial payment: select invoice → confirm → **amount prompt** → enter partial amount → select payment method → confirm → PDF sent |
| full payment | Same flow, amount = full remaining balance → invoice closed |
| amount too high | Entering an amount above remaining balance → error message, session stays open, no keyboard shown |
| cancel during selection | Clicking ❌ בטל at the invoice selection screen deletes the session |
| no open invoices | Clicking קבלה when no invoices exist → `no_open_invoices` response, session deleted |
| multi-invoice confirm button | Selecting 2 invoices changes confirm button text from "המשך עם חשבונית זו" to "המשך עם הבחירה" |
| multi-invoice full happy path | Select 2 invoices → confirm → amount prompt → enter total → payment method → PDF sent |
| non-numeric amount | Entering letters instead of a number → `invalid_amount` response, session stays in `awaiting_payment` |
| amount = 0 | Entering 0 → `invalid_amount` response |
| customer mismatch | Trying to add a second invoice for a different customer → ⛔ button disabled (noop callback) |

**Gaps to consider:**
- Multi-invoice: currency mismatch between invoices
- Multi-invoice: 10-invoice selection limit
- Show more / pagination of invoice list
- Receipt PDF linked to correct invoice numbers in the generated doc

---

## Invoice Creation (`invoice-creation.flow.test.ts`) — 6 tests

The invoice flow creates a חשבונית (no payment method required).

| Test | What it covers |
|------|----------------|
| complete creation flow | `/new` → select חשבונית → enter details → confirmation keyboard → ✅ confirm → PDF sent, session deleted |
| invalid details format | Sending malformed text → `invalid_format` response, session stays in `awaiting_details` |
| cancel | ❌ בטל at confirmation → session deleted |
| message without session | Random text with no active session → `no_session` response |
| optional tax ID | 4th comma-separated field parsed and saved as `customerTaxId`, passed to generator |
| expired session callback | Callback on a session older than 1 hour → `session_expired` |

**Gaps to consider:**
- Multiple currencies
- Invoice creation for invoice-receipt type (combined flow in separate file)

---

## Invoice-Receipt (`invoice-receipt.flow.test.ts`) — 5 tests

The invoice-receipt flow (חשבונית-קבלה) combines invoice + payment in one document. Unlike plain invoice, it **requires** a payment method.

| Test | What it covers |
|------|----------------|
| full flow | `/new` → select חשבונית-קבלה → enter details → **payment method keyboard** → select method → confirm → PDF |
| all 6 payment methods | After entering details, all 6 payment buttons are visible: מזומן, ביט, PayBox, העברה, אשראי, צ׳ק |
| cancel at confirmation | ❌ בטל after selecting payment method → session deleted |
| invalid details format | Sending malformed text → `invalid_format` response, session stays in `awaiting_details` |
| generateInvoice called correctly | Verifies the correct `documentType`, `customerName`, `amount`, `paymentMethod`, `userId`, `chatId` are passed to the generator |

**Gaps to consider:**
- Each payment method individually produces correct session state
- Tax ID field

---

## Onboarding (`onboarding.flow.test.ts`) — 7 tests

The onboarding flow walks a new business through a multi-step setup wizard.

| Test | What it covers |
|------|----------------|
| language keyboard | `/onboard` command sends inline keyboard with language options |
| already configured | If business config already exists → warning message sent, no session created |
| Hebrew language selection | Clicking Hebrew → session created with `language: 'he'`, step advances to `business_name` |
| English language selection | Clicking English → `language: 'en'`, same result |
| tax status selection | `onboard_tax_exempt` callback → `handleTaxStatusSelection` called with chatId + localized text + language |
| counter selection | `onboard_counter_1` callback → `handleCounterSelection` called with `startFromOne: true` |
| business name step | Sending business name text → `handleBusinessNameStep` called with correct args, session advances to `owner_details` |

**Gaps to consider:**
- Invalid invite code
- Rate-limited onboarding attempt
- Logo upload step (Telegram file download mocked)
- Re-onboarding after already completing (invite code reuse)

---

## Onboarding Full Path (`onboarding-full.flow.test.ts`) — 2 tests

All 7 onboarding steps with **real step handlers** (not mocked). Only external I/O is mocked (sheet verification, config save, user mapping).

| Test | What it covers |
|------|----------------|
| complete 7-step flow | `/onboard` → lang → business name → owner details (comma-separated) → address → tax status → `/skip` logo → sheet URL → counter_1 → `saveBusinessConfig` called, session deleted |
| invalid owner details | Sending 3-part owner details (missing email) → rejected, session stays in `owner_details` |

---

## Report (`report.flow.test.ts`) — 8 tests

The report flow lets users generate revenue/expense reports via `/report`.

Note: The actual report generation (PDF/Excel creation) is mocked — these tests cover
session management and routing only.

| Test | What it covers |
|------|----------------|
| session created | `/report` creates a session in `report_sessions` with `status: active`, `currentStep: type` |
| no access | User not in the chat's user mapping → 403 |
| duplicate command | Same `updateId` sent twice → second is skipped, `duplicate: true` |
| type-selection callback | Callback with `a: 'type'` routes to `handleTypeSelection` with correct args |
| date-selection callback | Callback `{ a: 'date', v: 'tm' }` → `handleDateSelection` called with `'this_month'` |
| format-selection callback | Callback `{ a: 'fmt', v: 'pdf' }` → `handleFormatSelection` called with `'pdf'` |
| rate limit exceeded | `checkReportLimit` returns `allowed: false` → 429 response + message sent to user |
| cancel callback | Callback with `a: 'cancel'` routes to `handleCancelAction` |

**Gaps to consider:**
- Each report type tested individually (revenue, expense, VAT)
- Expired report session

---

## Report Full Flow (`report-full.flow.test.ts`) — 3 tests

The **complete** report sequence with real `report-flow.service` and `report-session.service`. Only data layer (`report/core`) and file generators (`report/generators`) are mocked.

| Test | What it covers |
|------|----------------|
| complete flow | `/report` → type → date → format → `generatePDFReport` called, `sendDocument` delivered, session completed |
| no invoices in period | Date selection finds zero invoices → session deleted, PDF never generated |
| Excel format | Format `xls` → `generateExcelReport` called, `.xlsx` filename in `sendDocument` |

---

## Duplicate Decision (`duplicate-decision.flow.test.ts`) — 3 tests

Tests the `keep_both` / `delete_new` inline keyboard on the duplicate warning message. `invoice.service.handleDuplicateDecision` runs with real logic; state tracked via in-memory job store.

| Test | What it covers |
|------|----------------|
| keep_both | `appendRow` called, `deleteFile` NOT called, job marked processed, edit message updated |
| delete_new | `deleteFile` called, `appendRow` NOT called, job marked processed, edit message updated |
| no pending job | No `pending_decision` job exists → `ok: false`, no side effects |

---

## Process / OCR Pipeline (`process.flow.test.ts`) — 4 tests

Tests the full `POST /process` pipeline. All external I/O mocked (Telegram download, Cloud Storage, LLM, Sheets); `invoice.service.processInvoice` runs with real orchestration logic.

| Test | What it covers |
|------|----------------|
| full pipeline | Image → download → upload → LLM → duplicate check → Sheets → job marked processed → ACK sent |
| already processed | Pre-existing `processed` job → `already_processed` response, no re-processing |
| LLM rejects non-invoice | `is_invoice: false` → uploaded file deleted, rejection message sent to user |
| duplicate detected | `findDuplicateInvoice` returns match → `appendRow` NOT called, duplicate warning with buttons sent |

---

## Correction (`correction.flow.test.ts`) — 12 tests

The correction flow lets users edit fields on already-processed OCR invoices via the ✏️ Edit button.

`correction.service` runs with **real validation logic** (no mock). State is tracked in
in-memory Maps wired to the mocked `firestore.service` functions.

| Test | What it covers |
|------|----------------|
| field selection keyboard | Clicking ✏️ Edit on a processed invoice shows field selection: 💰 סכום, 📅 תאריך, 🏢 ספק, ✖ ביטול |
| edit amount — happy path | Select 💰 סכום → enter valid number → `applyJobCorrection` called, pending cleared, confirmation sent |
| edit date — happy path | Select 📅 תאריך → enter DD/MM/YYYY → stored as ISO YYYY-MM-DD |
| edit vendor — happy path | Select 🏢 ספק → enter name → `applyJobCorrection` called with `vendorName` |
| amount — letters rejected | Non-numeric input → `applyJobCorrection` NOT called, pending stays |
| amount — zero rejected | `0` → rejected |
| amount — negative rejected | `-100` → rejected |
| date — ISO format rejected | `2024-03-15` (ISO) → rejected; only DD/MM/YYYY accepted |
| date — impossible date rejected | `31/02/2024` → rejected |
| vendor — whitespace-only rejected | `   ` → rejected |
| cancel | ✖ ביטול → original success message restored with ✏️ Edit button, pending cleared |
| no pending correction | Plain message with no pending correction → falls through to `no_session` |
