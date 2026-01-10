# Troubleshooting

## Quick Diagnostics

```bash
# Webhook status
curl "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .

# View logs
make logs-webhook
make logs-worker

# Queue status
gcloud tasks queues describe invoice-processing --location us-central1
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Bot not receiving photos | Make bot a group admin |
| 401/403 on worker | Check `tasks-invoker-sa` has `roles/run.invoker` |
| Sheets permission denied | Share sheet with `worker-sa@PROJECT.iam.gserviceaccount.com` |
| Webhook 404 | Verify secret path matches config |
| Date shows `?` | Invoice text unclear or unusual format |
