# PR: Natural-language document creation (`nl-document-creation`)

## Summary

Adds voice/text natural-language document creation behind a per-chat feature flag. When `nl-document-creation` is enabled, `/new` starts an intent-based flow instead of the classic document-type button UI. Users describe the document in Hebrew (voice or text); the worker parses intent via Gemini (OpenAI fallback), shows a review screen with per-field edits, prompts for any missing fields (never silent defaults), then reuses the existing confirm → PDF generation path.

Supported in v1: `invoice` and `invoice_receipt`. Receipt-on-existing-invoice still uses the classic button flow.

## What changed

### Worker
- **Feature flag gate** in `handleNewCommand`: `featureFlags.getValue('nl-document-creation', false, { chatId })`
- **New `document-intent` module**: Zod schema, prompts, `computeMissingFields`, Gemini audio/text + OpenAI audio/Whisper fallback
- **New `nl-document.service`**: review/edit/missing-field loop, proceed-to-confirm, payment selection during review
- **Extended session model**: `awaiting_intent`, `reviewing`, `editing_field`; fields `nlMode`, `sourceTranscript`, `editingField`, `parseConfidence`
- **New callbacks**: `edit_field`, `proceed_to_confirm`, `back_to_review`
- **i18n**: Hebrew/English `nl.*` strings
- **Tests**: unit (`document-intent.test.ts`) + flow (`nl-document.flow.test.ts`)

### Webhook-handler
- Voice message schema + `isVoiceMessage` checker
- `voice-message.handler` routes approved-chat voice to invoice message task with `voiceFileId`
- `extractInvoiceMessagePayload` accepts voice without text

### Shared
- `document-intent.types.ts`, extended `invoice.types.ts` / `task.types.ts`

### Docs
- `docs/architecture.md` — NL flow section

## Feature flag setup (post-deploy)

1. Admin → **Feature Flags** (`/flags.html`)
2. Create key: `nl-document-creation` (boolean)
3. Edit → add target **chat ID(s)**, default value `false`
4. Toggle flag **ON**
5. In targeted group: `/new` → NL prompt; elsewhere → classic buttons

## Test plan

- [ ] Deploy **worker** + **webhook-handler**
- [ ] Create `nl-document-creation` flag; target test chat; enable
- [ ] `/new` in targeted chat → NL Hebrew prompt (not document-type buttons)
- [ ] `/new` in non-targeted chat → classic button flow unchanged
- [ ] Text: `תוציא לי חשבונית קבלה למשה על ספר בסכום של 300 שח` → review → asks payment method → confirm → PDF
- [ ] Voice message in NL session → parsed and reviewed
- [ ] Receipt intent in NL → message to use classic קבלה flow
- [ ] Edit field buttons (customer, amount, description) work from review screen
- [ ] Flag OFF → `/new` always uses classic flow

## Automated tests

```bash
cd services/worker && npm run test:unit -- --testPathPattern=document-intent
cd services/worker && npm run test:flow -- --testPathPattern=nl-document
cd services/webhook-handler && npm run test:unit -- --testPathPattern=telegram-voice
```

---

## Suggested git commit

**Scope this commit to NL feature files only.** Unrelated local changes (`.gitignore`, `tools/migrations/*`) should be committed separately or reverted.

### Commands

```bash
git add \
  docs/architecture.md \
  docs/pr/nl-document-creation.md \
  shared/document-intent.types.ts \
  shared/index.ts \
  shared/invoice.types.ts \
  shared/task.types.ts \
  services/worker/src/controllers/invoice.controller.ts \
  services/worker/src/services/document-generator/document-intent/ \
  services/worker/src/services/document-generator/nl-document.service.ts \
  services/worker/src/services/document-generator/keyboards.service.ts \
  services/worker/src/services/document-generator/messages.service.ts \
  services/worker/src/services/document-generator/session.service.ts \
  services/worker/src/services/i18n/languages.ts \
  services/worker/tests/unit/document-intent/ \
  services/worker/tests/flow/nl-document.flow.test.ts \
  services/webhook-handler/src/controllers/webhook.controller.ts \
  services/webhook-handler/src/handlers/voice-message.handler.ts \
  services/webhook-handler/src/handlers/index.ts \
  services/webhook-handler/src/services/telegram/telegram-invoice-extractors.ts \
  services/webhook-handler/src/services/telegram/telegram-types.ts \
  services/webhook-handler/src/services/telegram/telegram-update-checkers.ts \
  services/webhook-handler/tests/unit/telegram-voice-extractor.test.ts

git commit -m "$(cat <<'EOF'
feat: add NL voice/text document creation behind nl-document-creation flag

When enabled per chat, /new accepts spoken or typed intent, parses fields
via Gemini with OpenAI fallback, and guides users through review, missing-field
prompts, and confirmation before reusing existing PDF generation.
EOF
)"
```

### Commit title

```
feat: add NL voice/text document creation behind nl-document-creation flag
```

### Commit body

```
When enabled per chat, /new accepts spoken or typed intent, parses fields
via Gemini with OpenAI fallback, and guides users through review, missing-field
prompts, and confirmation before reusing existing PDF generation.
```
