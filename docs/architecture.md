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
                   └───────────┘    └───────────┘    │ (deduplication)│
                                                     └────────────────┘
```

## Services

| Service | Role |
|---------|------|
| `webhook-handler` | Receives Telegram webhooks, enqueues tasks |
| `worker` | Downloads images, calls LLM, updates Sheets |
| Cloud Tasks | Retry with backoff, exactly-once delivery |
| Firestore | Idempotency tracking |

## Service Accounts

| Account | Purpose |
|---------|---------|
| `webhook-handler-sa` | Enqueue tasks, read secrets |
| `worker-sa` | Storage, Sheets, Firestore, secrets |
| `tasks-invoker-sa` | Invoke worker (OIDC) |
