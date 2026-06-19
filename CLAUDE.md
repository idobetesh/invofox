# CLAUDE.md

Serverless Telegram invoice bot on GCP (Cloud Run, Cloud Tasks, Firestore, Storage). See `README.md` + `docs/architecture.md` for how it works; this file is how to work here.

**Monorepo:** `services/worker/` (main pipeline: download → convert → LLM extract → store → reply), `services/webhook-handler/` (Telegram → Cloud Task), `shared/` (types + `collections.ts`), `infra/terraform/`, `tools/migrations/`, `tools/admin/` (separate project). TypeScript strict, Node 24+, CommonJS, Jest, Zod env validation, Pino logging.

## Rules

- Build/test/lint locally without asking. **Confirm before**: `terraform apply`/`destroy`, `make deploy-*`, migrations on real data, offboarding — these hit live infra/data.
- Conventional commits enforced (`feat:`/`fix:`/`chore:`). Branch + PR, never push to `master` directly.
- Firestore collection names come from `shared/collections.ts` — never hardcode. Log via `pino`, not `console.log`. Secrets live in Secret Manager / `.env`, never in code.

## Commands

`make help` lists everything. Key ones:

```bash
npm run build / npm run lint          # root = all services
make test                             # unit + integration, all services
make dev-worker / make dev-webhook    # local, Cloud Tasks bypassed
cd services/worker && npx jest <file> # single file;  -t "name" for one test
```

## Footguns

- **`infra/terraform/` is real GCP infra** — plan + confirm before apply/destroy.
- **Migrations touch live Firestore, hard to undo.** Run via `make migrate NAME=<file>`; make idempotent, verify small scope first, update `MIGRATIONS.md`.
- **Services need a Zod-validated `.env` to boot** (copy `env.example`). A startup crash is usually a missing env var, not a bug.
- **Integration tests mock Firestore — no emulator, no live GCP.** New external dependency → add its mock or tests make real network calls.
