# Invofox Admin Tool

⚠️ **SECURITY WARNING** ⚠️

This is a powerful local-only admin tool for managing GCP resources. **Use with extreme caution!**

## Features

- **Firestore Management**
  - Browse all collections and documents
  - View document details (JSON viewer)
  - Delete individual documents
  - Bulk delete with selection

- **Cloud Storage Management**
  - List all buckets
  - Browse objects with prefix filtering
  - Preview images and PDFs
  - View object metadata
  - Delete individual objects
  - Bulk delete with selection

## Security

- ✅ **Local-only**: Runs on `localhost:3000` - never accessible from outside
- ✅ **Uses GCP credentials**: Uses Application Default Credentials (ADC) - **NO credentials in code**
- ✅ **Confirmation dialogs**: All deletions require explicit confirmation
- ⚠️ **Powerful tool**: Can permanently delete data - use carefully!
- ⚠️ **Optional password**: Set `ADMIN_PASSWORD` env var for basic auth

### GCP Authentication & Credentials

**How it works:**
The tool uses **Application Default Credentials (ADC)**, which means:

1. **No credentials in code** ✅
   - The code uses `new Firestore()` and `new Storage()` 
   - These automatically detect credentials from your environment
   - No hardcoded keys, tokens, or service account files in the codebase

2. **Credentials stored locally** ✅
   - When you run `gcloud auth application-default login`, credentials are stored locally:
     - Mac: `~/.config/gcloud/application_default_credentials.json`
   - These files are **never** in the repository

3. **Safe to push to GitHub** ✅
   - No credentials are committed to the repository
   - `.gitignore` excludes all sensitive files:
     - `.env` files (may contain `ADMIN_PASSWORD`)
     - `service-account*.json` files
     - `*-credentials.json` files
     - `application_default_credentials.json`

**Alternative: Service Account (Optional)**
If you prefer using a service account JSON file:
1. Create a service account in GCP Console
2. Download the JSON key file
3. Set: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
4. **IMPORTANT**: The JSON file is already in `.gitignore` - never commit it!

**Security Checklist Before Pushing to GitHub:**
```bash
# Check for any sensitive files that might be tracked
git ls-files tools/admin/ | grep -E '\.(env|json)$' | grep -v -E '(package|tsconfig|nodemon|favicon)'

# Verify .env files are ignored
git check-ignore tools/admin/.env

# Verify service account files are ignored  
git check-ignore tools/admin/service-account.json
```

If any of these commands show files, they should be removed from git tracking:
```bash
git rm --cached tools/admin/.env  # Remove if accidentally committed
```

## Prerequisites

1. GCP credentials configured (Application Default Credentials)
   ```bash
   gcloud auth application-default login
   ```

2. Node.js 20+ installed

3. Access to the GCP project

## Installation

```bash
cd tools/admin
npm install
```

## Usage

### Basic Usage

```bash
npm start
```

Then open http://localhost:3000 in your browser.

### With Password Protection (Optional)

Create a `.env` file:

```bash
ADMIN_PASSWORD=your-secure-password-here
ADMIN_PORT=3000
```

Then start the server:

```bash
npm start
```

The API will require `Authorization: Bearer your-secure-password-here` header.

### Development Mode (Auto-reload)

```bash
npm run dev
```

## How It Works

1. **Firestore Tab**
   - Select a collection from the dropdown
   - Click "Load" to view documents
   - Use checkboxes to select documents for bulk operations
   - Click "View" to see document details
   - Click "Delete" to remove documents (with confirmation)

2. **Storage Tab**
   - Select a bucket from the dropdown
   - Optionally filter by prefix (e.g., `2026/` for year-based folders)
   - Click "Load" to view objects
   - Use checkboxes to select objects for bulk operations
   - Click "View" to see object details and preview
   - Click "Delete" to remove objects (with confirmation)

## API Endpoints

### Firestore

- `GET /api/firestore/collections` - List all collections
- `GET /api/firestore/collections/:name` - List documents in collection
- `GET /api/firestore/collections/:name/:id` - Get document details
- `DELETE /api/firestore/collections/:name/:id` - Delete document
- `POST /api/firestore/collections/:name/delete-multiple` - Bulk delete

### Cloud Storage

- `GET /api/storage/buckets` - List all buckets
- `GET /api/storage/buckets/:name/objects` - List objects in bucket
- `GET /api/storage/buckets/:name/objects/*` - Get object details
- `DELETE /api/storage/buckets/:name/objects/*` - Delete object
- `POST /api/storage/buckets/:name/delete-multiple` - Bulk delete

## Known Collections

The tool is pre-configured with these Firestore collections:

- `invoice_sessions` - User invoice generation sessions
- `generated_invoices` - Invoice audit log
- `invoice_jobs` - Job tracking for invoice processing
- `invoice_counters` - Yearly invoice number counters
- `business_config` - Business configuration per chat

## Troubleshooting

### "Failed to list collections"

- Ensure GCP credentials are configured: `gcloud auth application-default login`
- Check that you have Firestore access in the project
- Verify the project ID is correct

### "Failed to list buckets"

- Ensure you have Storage Admin or Storage Object Viewer permissions
- Check that buckets exist in the project

### "Unauthorized" error

- If you set `ADMIN_PASSWORD`, ensure you're sending the correct Authorization header
- Check the browser console for authentication errors

## Safety Tips

1. **Always confirm deletions** - The tool requires explicit confirmation
2. **Test on non-production data first** - If possible, test on a dev project
3. **Use prefix filters** - When browsing Storage, use prefixes to narrow results
4. **Check before bulk delete** - Review selected items before bulk operations
5. **Keep it local** - Never deploy this tool to production or expose it publicly

## Limitations

- Firestore collections are hardcoded (Firestore doesn't provide a list API)
- Pagination is basic (50 items per page for Firestore, 100 for Storage)
- No search/filter functionality beyond Storage prefix filtering
- No undo functionality - deletions are permanent

## Development

To modify the tool:

1. Edit `server.ts` for API changes
2. Edit `public/index.html` for UI structure
3. Edit `public/style.css` for styling
4. Edit `public/app.js` for frontend logic

The server auto-reloads in dev mode (`npm run dev`).
