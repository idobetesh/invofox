# Papertrail Invoice Bot - Makefile
# Run 'make help' for available commands

# Configuration (override with environment variables or command line)
PROJECT_ID ?= $(shell gcloud config get-value project 2>/dev/null)
REGION ?= us-central1
ARTIFACT_REPO ?= papertrail-containers

# Derived values
WEBHOOK_IMAGE = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(ARTIFACT_REPO)/webhook-handler
WORKER_IMAGE = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(ARTIFACT_REPO)/worker
VERSION ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "latest")

.PHONY: help install build build-webhook build-worker push push-webhook push-worker \
        deploy deploy-webhook deploy-worker deploy-all \
        terraform-init terraform-plan terraform-apply terraform-destroy \
        set-webhook get-webhook-info dev-webhook dev-worker test-worker \
        logs-webhook logs-worker clean lint lint-fix test test-unit \
        version revisions rollback-webhook rollback-worker

# =============================================================================
# Help
# =============================================================================

help:
	@echo ""
	@echo "Papertrail Invoice Bot - Commands"
	@echo "================================="
	@echo ""
	@echo "SETUP"
	@echo "  make install          Install npm dependencies + husky hooks"
	@echo ""
	@echo "BUILD"
	@echo "  make build            Build both services"
	@echo "  make build-webhook    Build webhook-handler only"
	@echo "  make build-worker     Build worker only"
	@echo ""
	@echo "LINT"
	@echo "  make lint             Lint all services"
	@echo "  make lint-fix         Lint and auto-fix all services"
	@echo ""
	@echo "DOCKER"
	@echo "  make push             Build and push both images"
	@echo "  make push-webhook     Build and push webhook-handler image"
	@echo "  make push-worker      Build and push worker image"
	@echo ""
	@echo "DEPLOY"
	@echo "  make deploy-all       Deploy infrastructure + services"
	@echo "  make deploy-webhook   Deploy webhook-handler to Cloud Run"
	@echo "  make deploy-worker    Deploy worker to Cloud Run"
	@echo ""
	@echo "TERRAFORM"
	@echo "  make terraform-init   Initialize Terraform"
	@echo "  make terraform-plan   Show Terraform plan"
	@echo "  make terraform-apply  Apply Terraform configuration"
	@echo "  make terraform-destroy Destroy Terraform resources"
	@echo ""
	@echo "TELEGRAM"
	@echo "  make set-webhook      Set Telegram webhook URL"
	@echo "  make get-webhook-info Get current webhook info"
	@echo ""
	@echo "TESTING"
	@echo "  make test             Run all tests"
	@echo "  make test-unit        Run unit tests only"
	@echo ""
	@echo "LOCAL DEVELOPMENT"
	@echo "  make dev-webhook      Run webhook-handler locally"
	@echo "  make dev-worker       Run worker locally"
	@echo "  make test-worker      Send test payload to local worker"
	@echo ""
	@echo "MONITORING"
	@echo "  make logs-webhook     Tail webhook-handler logs"
	@echo "  make logs-worker      Tail worker logs"
	@echo ""
	@echo "VERSION & ROLLBACK"
	@echo "  make version          Show deployed versions"
	@echo "  make revisions        List Cloud Run revisions"
	@echo "  make rollback-webhook Rollback webhook to previous revision"
	@echo "  make rollback-worker  Rollback worker to previous revision"
	@echo ""
	@echo "Current project: $(PROJECT_ID)"
	@echo "Region: $(REGION)"
	@echo ""

# =============================================================================
# Setup
# =============================================================================

install:
	@echo "Installing root dependencies..."
	npm install
	@echo ""
	@echo "Installing webhook-handler dependencies..."
	cd services/webhook-handler && npm install
	@echo ""
	@echo "Installing worker dependencies..."
	cd services/worker && npm install
	@echo ""
	@echo "All dependencies installed!"
	@echo "Husky git hooks configured."

# =============================================================================
# Lint
# =============================================================================

lint:
	npm run lint

lint-fix:
	npm run lint:fix

# =============================================================================
# Build
# =============================================================================

build: build-webhook build-worker

build-webhook:
	@echo "Building webhook-handler..."
	cd services/webhook-handler && npm run build

build-worker:
	@echo "Building worker..."
	cd services/worker && npm run build

# =============================================================================
# Docker
# =============================================================================

push: push-webhook push-worker

push-webhook:
	@echo "Building and pushing webhook-handler image..."
	@echo "Image: $(WEBHOOK_IMAGE):$(VERSION)"
	docker build --platform linux/amd64 \
		--build-arg APP_VERSION=$(VERSION) \
		-f services/webhook-handler/Dockerfile \
		-t $(WEBHOOK_IMAGE):$(VERSION) -t $(WEBHOOK_IMAGE):latest . && \
		docker push $(WEBHOOK_IMAGE):$(VERSION) && \
		docker push $(WEBHOOK_IMAGE):latest

push-worker:
	@echo "Building and pushing worker image..."
	@echo "Image: $(WORKER_IMAGE):$(VERSION)"
	docker build --platform linux/amd64 \
		--build-arg APP_VERSION=$(VERSION) \
		-f services/worker/Dockerfile \
		-t $(WORKER_IMAGE):$(VERSION) -t $(WORKER_IMAGE):latest . && \
		docker push $(WORKER_IMAGE):$(VERSION) && \
		docker push $(WORKER_IMAGE):latest

docker-auth:
	gcloud auth configure-docker $(REGION)-docker.pkg.dev

# =============================================================================
# Deploy
# =============================================================================

deploy-all: terraform-apply push deploy-webhook deploy-worker
	@echo ""
	@echo "Deployment complete!"
	@echo "Don't forget to run 'make set-webhook' to configure Telegram."

deploy-webhook:
	@echo "Deploying webhook-handler to Cloud Run..."
	gcloud run deploy webhook-handler \
		--image $(WEBHOOK_IMAGE):latest \
		--region $(REGION) \
		--platform managed

deploy-worker:
	@echo "Deploying worker to Cloud Run..."
	gcloud run deploy worker \
		--image $(WORKER_IMAGE):latest \
		--region $(REGION) \
		--platform managed

# =============================================================================
# Terraform
# =============================================================================

terraform-init:
	@echo "Initializing Terraform..."
	cd infra/terraform && terraform init

terraform-plan:
	@echo "Running Terraform plan..."
	cd infra/terraform && terraform plan

terraform-apply:
	@echo "Applying Terraform configuration..."
	cd infra/terraform && terraform apply

terraform-destroy:
	@echo "Destroying Terraform resources..."
	cd infra/terraform && terraform destroy

terraform-output:
	@cd infra/terraform && terraform output

# =============================================================================
# Telegram Webhook
# =============================================================================

set-webhook:
	@if [ -z "$(TELEGRAM_BOT_TOKEN)" ]; then \
		echo "Error: TELEGRAM_BOT_TOKEN not set"; \
		echo "Usage: make set-webhook TELEGRAM_BOT_TOKEN=your-token WEBHOOK_URL=https://..."; \
		exit 1; \
	fi
	@if [ -z "$(WEBHOOK_URL)" ]; then \
		echo "Error: WEBHOOK_URL not set"; \
		echo "Usage: make set-webhook TELEGRAM_BOT_TOKEN=your-token WEBHOOK_URL=https://webhook-handler-xxx.run.app/webhook/your-secret"; \
		exit 1; \
	fi
	@echo "Setting Telegram webhook to: $(WEBHOOK_URL)"
	@curl -s -X POST "https://api.telegram.org/bot$(TELEGRAM_BOT_TOKEN)/setWebhook" \
		-H "Content-Type: application/json" \
		-d '{"url": "$(WEBHOOK_URL)"}' | jq .

get-webhook-info:
	@if [ -z "$(TELEGRAM_BOT_TOKEN)" ]; then \
		echo "Error: TELEGRAM_BOT_TOKEN not set"; \
		exit 1; \
	fi
	@curl -s "https://api.telegram.org/bot$(TELEGRAM_BOT_TOKEN)/getWebhookInfo" | jq .

delete-webhook:
	@if [ -z "$(TELEGRAM_BOT_TOKEN)" ]; then \
		echo "Error: TELEGRAM_BOT_TOKEN not set"; \
		exit 1; \
	fi
	@curl -s -X POST "https://api.telegram.org/bot$(TELEGRAM_BOT_TOKEN)/deleteWebhook" | jq .

# =============================================================================
# Testing
# =============================================================================

test: test-unit
	@echo "All tests passed!"

test-unit:
	@echo "Running unit tests..."
	@echo ""
	@echo "=== Webhook Handler Tests ==="
	cd services/webhook-handler && npm test
	@echo ""
	@echo "=== Worker Tests ==="
	cd services/worker && npm test

# =============================================================================
# Local Development
# =============================================================================

dev-webhook:
	@echo "Starting webhook-handler on port 8080 (Cloud Tasks bypassed)..."
	cd services/webhook-handler && SKIP_CLOUD_TASKS=true npm run dev

dev-worker:
	@echo "Starting worker on port 8081..."
	cd services/worker && npm run dev

test-worker:
	@echo "Sending test payload to local worker..."
	@curl -s -X POST http://localhost:8081/process \
		-H "Content-Type: application/json" \
		-d '{"chatId": 123456789, "messageId": 42, "fileId": "test-file-id", "uploaderUsername": "testuser", "uploaderFirstName": "Test", "chatTitle": "Test Group", "receivedAt": "2024-01-15T10:30:00Z"}' | jq .

# =============================================================================
# Monitoring
# =============================================================================

logs-webhook:
	gcloud run logs tail webhook-handler --region $(REGION)

logs-worker:
	gcloud run logs tail worker --region $(REGION)

# =============================================================================
# Version & Rollback
# =============================================================================

version:
	@WEBHOOK_URL=$$(gcloud run services describe webhook-handler --region $(REGION) --format='value(status.url)' 2>/dev/null) && \
	HEALTH=$$(curl -s "$$WEBHOOK_URL/health") && \
	WEBHOOK_REV=$$(gcloud run services describe webhook-handler --region $(REGION) --format='value(status.latestReadyRevisionName)' 2>/dev/null) && \
	WORKER_REV=$$(gcloud run services describe worker --region $(REGION) --format='value(status.latestReadyRevisionName)' 2>/dev/null) && \
	echo "$$HEALTH" | jq --arg wh "$$WEBHOOK_REV" --arg wk "$$WORKER_REV" '. + {services: {"webhook-handler": $$wh, "worker": $$wk}}'

revisions:
	@echo "=== Webhook Handler Revisions ==="
	@gcloud run revisions list --service=webhook-handler --region=$(REGION) --limit=5
	@echo ""
	@echo "=== Worker Revisions ==="
	@gcloud run revisions list --service=worker --region=$(REGION) --limit=5

rollback-webhook:
	@echo "Rolling back webhook-handler to previous revision..."
	@PREV_REV=$$(gcloud run revisions list --service=webhook-handler --region=$(REGION) --limit=2 --format='value(metadata.name)' | tail -1) && \
	echo "Switching traffic to: $$PREV_REV" && \
	gcloud run services update-traffic webhook-handler --to-revisions=$$PREV_REV=100 --region=$(REGION)

rollback-worker:
	@echo "Rolling back worker to previous revision..."
	@PREV_REV=$$(gcloud run revisions list --service=worker --region=$(REGION) --limit=2 --format='value(metadata.name)' | tail -1) && \
	echo "Switching traffic to: $$PREV_REV" && \
	gcloud run services update-traffic worker --to-revisions=$$PREV_REV=100 --region=$(REGION)

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf services/webhook-handler/dist
	rm -rf services/worker/dist
	rm -rf node_modules
	rm -rf services/webhook-handler/node_modules
	rm -rf services/worker/node_modules
	@echo "Clean complete!"
