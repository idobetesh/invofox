<p align="center">
  <img src="docs/assets/logo.png" alt="Papertrail" width="200">
</p>

# Papertrail Invoice Bot

[![CI](https://github.com/idobetesh/papertrail/actions/workflows/ci.yml/badge.svg)](https://github.com/idobetesh/papertrail/actions/workflows/ci.yml)
[![Deploy](https://github.com/idobetesh/papertrail/actions/workflows/deploy.yml/badge.svg)](https://github.com/idobetesh/papertrail/actions/workflows/deploy.yml)

A serverless Telegram bot that automatically processes invoice images using AI vision, stores them in Cloud Storage, and logs data to Google Sheets.

<p align="center">
  <img src="docs/assets/msg-example.jpeg" alt="Bot Response Example" width="300">
</p>

## Features

- 📸 **Photo Processing** - Send invoice photos to Telegram group
- 🤖 **AI Vision** - Gemini/GPT-4o extracts invoice data (Hebrew + English)
- ☁️ **Cloud Storage** - Auto-organized by `YYYY/MM/`
- 📊 **Sheets Logging** - All extracted data logged automatically
- 🔄 **Reliable** - Cloud Tasks with retry & deduplication
- 💰 **Cost-effective** - Scales to zero, mostly free tier

## Architecture

```
Telegram → Webhook Handler (Cloud Run) → Cloud Tasks → Worker (Cloud Run)
                                                            ↓
                                              Cloud Storage + Sheets + Firestore
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
make install          # Install dependencies
make dev-webhook      # Run webhook locally
make dev-worker       # Run worker locally
make test             # Run tests
make lint             # Lint code
make push             # Build & push images
make terraform-apply  # Deploy infrastructure
```

## Configuration

Set these in `terraform.tfvars`:

| Variable | Description |
|----------|-------------|
| `project_id` | GCP project ID |
| `telegram_bot_token` | Bot token from @BotFather |
| `webhook_secret_path` | Random secret for webhook URL |
| `openai_api_key` | OpenAI API key |
| `sheet_id` | Google Sheet ID |

