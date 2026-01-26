<p align="center">
  <img src="docs/assets/logo.png" alt="Invofox" width="400">
</p>

<h1 align="center">Invofox Invoice Bot</h1>

<p align="center">
  A serverless Telegram bot that automatically processes invoice images<br>
  using AI vision, stores them in Cloud Storage, and logs data to Google Sheets.
</p>

<p align="center">
  <a href="https://github.com/idobetesh/invofox/actions/workflows/ci.yml"><img src="https://github.com/idobetesh/invofox/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/idobetesh/invofox/actions/workflows/deploy.yml"><img src="https://github.com/idobetesh/invofox/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a>
  <br>
  <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fwebhook-handler-gm27rejjwa-uc.a.run.app%2Fhealth&query=%24.version&label=version&color=blue&style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fwebhook-handler-gm27rejjwa-uc.a.run.app%2Fhealth&query=%24.status&label=status&color=brightgreen&style=flat-square" alt="Status">
</p>

## Features

- 📸 **Photo Processing** - Send invoice photos to Telegram group
- 🤖 **AI Vision** - LLM extracts invoice data (Hebrew + English)
- 🧾 **Invoice Generation** - Create professional PDF invoices via `/invoice`
- ☁️ **Cloud Storage** - Auto-organized by `YYYY/MM/`
- 📊 **Sheets Logging** - All extracted data logged automatically
- 📈 **Monitoring Dashboard** - GCP dashboard with alerts
- 🔄 **Reliable** - Cloud Tasks with retry & deduplication
- 👥 **Multi-tenant** - Per-customer branding by chat ID
- 💰 **Cost-effective** - Scales to zero, mostly free tier

## Supported File Types

### 📱 As Photos (Telegram-compressed)
- **JPEG** (.jpg, .jpeg)
- **PNG** (.png)
- **WebP** (.webp)

### 📄 As Documents (Original Quality Preserved)
- **PDF** (.pdf) - Multi-page support (up to 5 pages)
- **JPEG** (.jpg, .jpeg)
- **PNG** (.png)
- **WebP** (.webp)
- **HEIC/HEIF** (.heic, .heif) - iPhone native format

> **Note:** HEIC files are automatically converted to JPEG for processing while the original HEIC is stored in Cloud Storage. Maximum file size: 5 MB.

## Architecture

```
Telegram → Webhook Handler → Cloud Tasks → Worker
                                              ↓
                              Storage + Sheets + Firestore + PDF Generation
```

## Quick Start

```bash
# Install
make install

# Configure
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edit with your values

# Deploy
make terraform-init terraform-apply push
```

## Requirements

- Node.js 24+
- Docker
- Terraform 1.0+
- GCP account with billing
- Telegram Bot Token
- OpenAI API Key (fallback) and/or Gemini API Key

## Commands

```bash
make install             # Install dependencies
make dev-webhook         # Run webhook locally
make dev-worker          # Run worker locally
make test                # Run tests
make lint                # Lint code
make push                # Build & push images
make terraform-apply     # Deploy infrastructure
make version             # Check deployed version
make sample-invoice      # Generate sample invoice PDF
make seed-business-config  # Seed business config to Firestore
make list-customers      # List configured customers
```

## Configuration

Set these in `terraform.tfvars`:

| Variable | Description |
|----------|-------------|
| `project_id` | GCP project ID |
| `telegram_bot_token` | Bot token from @BotFather |
| `webhook_secret_path` | Random secret for webhook URL |
| `openai_api_key` | OpenAI API key (fallback) |
| `gemini_api_key` | Gemini API key (primary, free tier) |
| `sheet_id` | Google Sheet ID |

## Documentation

- **[Multi-Tenant Architecture](docs/MULTI_TENANT_ARCHITECTURE.md)** - Planned improvements for proper customer isolation
- **[Customer Onboarding](docs/CUSTOMER_ONBOARDING.md)** - How to add new customers
- **[Architecture Overview](docs/architecture.md)** - System architecture details
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

---

<p align="center">
  <img src="docs/assets/msg-example.jpeg" alt="Success Message Example" width="280">
  <br>
  <em>Example: Success message after processing an invoice</em>
</p>
