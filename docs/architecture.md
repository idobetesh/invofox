# Architecture

## Overview

```
┌──────────┐     ┌─────────────────┐     ┌───────────┐     ┌────────┐
│ Telegram │────▶│ webhook-handler │────▶│Cloud Tasks│────▶│ worker │
└──────────┘     └─────────────────┘     └───────────┘     └────────┘
                                                                │
                         ┌──────────────────────────────────────┤
                         ▼                 ▼                    ▼
                   ┌───────────┐    ┌───────────┐    ┌────────────────┐
                   │  Storage  │    │  Sheets   │    │   Firestore    │
                   └───────────┘    └───────────┘    │ (jobs + config)│
                                                     └────────────────┘
```

## Services

| Service | Role |
|---------|------|
| `webhook-handler` | Receives Telegram webhooks, enqueues tasks |
| `worker` | Downloads images, calls LLM, generates PDFs, updates Sheets |
| Cloud Tasks | Retry with backoff, exactly-once delivery |
| Firestore | Job tracking, business config, invoice counters |

## Document Generation

### Command: `/new`
Creates invoices, receipts, and invoice-receipts through guided flow.

```
/new → Document Type Selection → Details Entry → Confirmation → PDF Generation
                 ↓
           Receipt Flow (if receipt selected)
                 ↓
    Open Invoices Query → Invoice Selection → Payment Amount → Validation
```

### Document Type System

**Invoice (I-{year}-{counter})**
- Separate counters per customer per year
- Payment tracking fields: `paymentStatus`, `paidAmount`, `remainingBalance`
- Can transition: unpaid → partial → paid
- Stored in `generated_invoices` collection

**Receipt (R-{year}-{counter})**
- Links to existing invoice via `relatedInvoiceNumber`
- Validates amount against remaining balance (prevents overpayment)
- Updates parent invoice payment status automatically
- Stored in `generated_receipts` collection

**Invoice-Receipt (IR-{year}-{counter})**
- Combined document for immediate payment
- Marked as fully paid on creation
- Stored in `generated_invoice_receipts` collection

### Payment Tracking Flow

```
Invoice Created (status: unpaid, balance: full amount)
         ↓
Receipt Created (partial: 50%)
         ↓
Invoice Updated (status: partial, balance: 50%)
         ↓
Receipt Created (full: remaining 50%)
         ↓
Invoice Updated (status: paid, balance: 0)
```

| Component | Purpose |
|-----------|---------|
| `config.service` | Per-customer business config |
| `pdf.generator` | Puppeteer-based PDF rendering |
| `counter.service` | Atomic document numbering (separate counters per type) |
| `open-invoices.service` | Query unpaid/partial invoices (limit 10, optimized) |
| `session.service` | Manage document creation flow state |
| `template.ts` | Document type labels and PDF rendering |

## Firestore Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `generated_invoices` | Invoice documents | `documentType`, `paymentStatus`, `paidAmount`, `remainingBalance`, `relatedReceiptIds` |
| `generated_receipts` | Receipt documents | `relatedInvoiceNumber`, `isPartialPayment` |
| `generated_invoice_receipts` | Invoice-receipt documents | Combined payment documents |
| `invoice_sessions` | Document creation flow state | `status`, `documentType`, `customerName`, `amount` |
| `invoice_counters` | Atomic counters per type | Separate counters: `invoice`, `receipt`, `invoice_receipt` |
| `business_configs` | Per-customer branding | Business details, logo, signature text |

