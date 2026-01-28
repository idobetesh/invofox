# Data Migrations

Firestore data migrations for schema changes.

## Running Migrations

```bash
make migrate NAME=2026-01-28-add-chatid-currency-to-invoices
```

## Migration History

| Date       | File | Ran? | Notes |
|------------|------|------|-------|
| 2026-01-28 | `2026-01-28-add-chatid-currency-to-invoices.ts` | ✅ | Updated 3 documents. Required for revenue reports. |

**After running:** Update "Ran?" column (⏳ → ✅) and add result count.

## Guidelines

- Name: `YYYY-MM-DD-description.ts`
- Make idempotent (safe to run multiple times)
- Check if field exists before updating
- Log progress and results
