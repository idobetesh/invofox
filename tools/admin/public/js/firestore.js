/**
 * Firestore Operations Module
 * Handles Firestore collection and document operations
 */

import {
  API_BASE,
  getAuthHeaders,
  showLoading,
  hideLoading,
  showError,
  showSuccess,
  showConfirmModal,
  formatDate,
  escapeHtml,
  isCommittedInvoiceJob,
  renderJobStatusHtml,
} from './utils.js';
import { promptAndSaveInvoiceJobAmount } from './invoice-amount-update.js';

const INVOICE_JOBS_COLLECTION = 'invoice_jobs';

// State
export let currentCollection = null;
export let selectedFirestoreDocs = new Set();
export let firestoreCursor = null;
let currentEditingDocument = null;
let originalDocumentData = null;
let firestoreSortColumn = 'createdAt'; // default sort
let firestoreSortDirection = 'desc';
let currentFirestoreDocs = [];

function isInvoiceJobsView() {
  return currentCollection === INVOICE_JOBS_COLLECTION;
}

function isSafeFileUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function showFirestoreToast(message, type = 'success') {
  const bg =
    type === 'warning' ? '#d97706' : type === 'error' ? '#dc2626' : 'var(--success,#22c55e)';
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position:fixed;bottom:2rem;right:2rem;background:${bg};color:#fff;padding:0.75rem 1.25rem;border-radius:8px;z-index:9999;font-size:0.875rem;box-shadow:0 4px 12px rgba(0,0,0,.15);max-width:420px;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), type === 'warning' ? 6000 : 3000);
}

async function saveInvoiceJobAmount(docId, amountRaw, inputEl) {
  const doc = currentFirestoreDocs.find((d) => d.id === docId);

  await promptAndSaveInvoiceJobAmount({
    jobId: docId,
    newAmountRaw: amountRaw,
    previousAmount: doc?.data?.totalAmount,
    chatId: doc?.data?.telegramChatId,
    sheetRowId: doc?.data?.sheetRowId,
    currency: doc?.data?.currency || 'ILS',
    inputEl,
    inputLookup: { kind: 'firestore', id: docId },
    onSaved: (n) => {
      if (doc) {
        doc.data.totalAmount = n;
      }
      const liveInput = document.querySelector(
        `.firestore-amount-input[data-doc-id="${CSS.escape(docId)}"]`
      );
      if (liveInput) {
        liveInput.dataset.savedAmount = String(n);
      }
    },
    showToast: showFirestoreToast,
  });
}

function renderInvoiceJobAmountCell(doc) {
  const value =
    doc.data.totalAmount !== null && doc.data.totalAmount !== undefined
      ? doc.data.totalAmount
      : '';
  const currency = doc.data.currency ? escapeHtml(String(doc.data.currency)) : '';
  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
      <input
        type="number"
        class="modern-input firestore-amount-input"
        data-doc-id="${escapeHtml(doc.id)}"
        data-saved-amount="${escapeHtml(String(value))}"
        value="${value}"
        step="0.01"
        min="0.01"
        placeholder="?"
        style="width:80px;padding:4px 8px;font-size:0.8rem;"
        title="Edit amount — Enter or ✓ to save"
      />
      <button type="button" class="btn btn-ghost firestore-save-amount-btn" data-doc-id="${escapeHtml(doc.id)}" title="Save amount" style="padding:4px 8px;font-size:0.75rem;">✓</button>
      ${currency ? `<span style="font-size:0.75rem;color:var(--muted);">${currency}</span>` : ''}
    </div>
  `;
}

function renderInvoiceJobFileCell(doc) {
  const status = doc.data.status;
  const link = doc.data.driveLink;
  if (!isCommittedInvoiceJob(status) || !isSafeFileUrl(link)) {
    return '<span style="color:var(--muted);font-size:0.75rem;">—</span>';
  }
  const safeUrl = escapeHtml(link);
  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
      <a href="${safeUrl}" class="action-btn" target="_blank" rel="noopener noreferrer" title="Open invoice file" style="padding:4px 8px;font-size:0.75rem;">
        <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        <span>Open</span>
      </a>
      <button type="button" class="action-btn firestore-copy-file-btn" data-url="${safeUrl}" title="Copy file URL" style="padding:4px 8px;font-size:0.75rem;">
        <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>Copy</span>
      </button>
    </div>
  `;
}

function handleFirestoreDocumentsClick(event) {
  if (!isInvoiceJobsView()) {
    return;
  }

  const saveBtn = event.target.closest('.firestore-save-amount-btn');
  if (saveBtn) {
    const docId = saveBtn.dataset.docId;
    const row = saveBtn.closest('tr');
    const input = row?.querySelector('.firestore-amount-input');
    if (docId && input) {
      void saveInvoiceJobAmount(docId, input.value.trim(), input);
    }
    return;
  }

  const copyBtn = event.target.closest('.firestore-copy-file-btn');
  if (copyBtn?.dataset.url) {
    void navigator.clipboard.writeText(copyBtn.dataset.url).then(
      () => showFirestoreToast('File URL copied'),
      () => showFirestoreToast('Could not copy URL', 'error')
    );
  }
}

function handleFirestoreDocumentsKeydown(event) {
  if (!isInvoiceJobsView() || event.key !== 'Enter') {
    return;
  }
  if (!event.target.classList.contains('firestore-amount-input')) {
    return;
  }
  event.preventDefault();
  const input = event.target;
  const docId = input.dataset.docId;
  if (docId) {
    void saveInvoiceJobAmount(docId, input.value.trim(), input);
  }
}

function bindFirestoreDocumentHandlers() {
  const container = document.getElementById('documents-container');
  if (!container || container.dataset.handlersBound === '1') {
    return;
  }
  container.dataset.handlersBound = '1';
  container.addEventListener('click', handleFirestoreDocumentsClick);
  container.addEventListener('keydown', handleFirestoreDocumentsKeydown);
}

/**
 * Load Firestore collections
 */
export async function loadCollections() {
  try {
    const response = await fetch(`${API_BASE}/firestore/collections`, getAuthHeaders());
    const data = await response.json();

    const select = document.getElementById('collection-select');
    select.innerHTML = '<option value="">Select a collection...</option>';
    data.collections.forEach((col) => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load collections: ' + error.message);
  }
}

/**
 * Load documents from a collection (newest by create date first).
 * @param {object} options
 * @param {boolean} options.reset - When true, reload from the first page
 */
export async function loadCollectionDocuments({ reset = true } = {}) {
  const collectionName = document.getElementById('collection-select').value;
  if (!collectionName) {
    showError('Please select a collection');
    return;
  }

  currentCollection = collectionName;

  if (reset) {
    firestoreCursor = null;
    selectedFirestoreDocs.clear();
    updateFirestoreSelection();
    firestoreSortColumn = 'createdAt';
    firestoreSortDirection = 'desc';
  }

  showLoading();
  try {
    const response = await fetch(
      `${API_BASE}/firestore/collections/${collectionName}?limit=50${
        firestoreCursor ? `&startAfter=${encodeURIComponent(firestoreCursor)}` : ''
      }`,
      getAuthHeaders()
    );
    const data = await response.json();

    currentFirestoreDocs = data.documents;
    displayFirestoreDocuments(currentFirestoreDocs);
    firestoreCursor = data.nextCursor;
    updateFirestorePagination(data.hasMore);

    document.getElementById('refresh-collection-btn').style.display = 'inline-block';
  } catch (error) {
    showError('Failed to load documents: ' + error.message);
  } finally {
    hideLoading();
  }
}

/** Load the next page without resetting pagination cursor. */
export function loadNextFirestorePage() {
  return loadCollectionDocuments({ reset: false });
}

/**
 * Extract a sortable timestamp (ms) from a Firestore date field
 */
function toSortableMs(val) {
  if (!val) return 0;
  if (typeof val === 'string') return new Date(val).getTime();
  if (val.toMillis) return val.toMillis();
  if (val.toDate) return val.toDate().getTime();
  const secs = val._seconds ?? val.seconds;
  if (typeof secs === 'number') return secs * 1000;
  return new Date(val).getTime() || 0;
}

/**
 * Sort firestore documents by current sort state
 */
function sortFirestoreDocs(docs) {
  return [...docs].sort((a, b) => {
    let aVal, bVal;
    if (firestoreSortColumn === 'status') {
      aVal = (a.data.status || a.data.documentType || '').toLowerCase();
      bVal = (b.data.status || b.data.documentType || '').toLowerCase();
    } else if (firestoreSortColumn === 'updatedAt') {
      aVal = toSortableMs(a.data.updatedAt);
      bVal = toSortableMs(b.data.updatedAt);
    } else {
      // createdAt (fallback to generatedAt / startedAt for generated docs)
      aVal = toSortableMs(a.data.createdAt || a.data.generatedAt || a.data.startedAt);
      bVal = toSortableMs(b.data.createdAt || b.data.generatedAt || b.data.startedAt);
    }
    if (aVal < bVal) return firestoreSortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return firestoreSortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Display Firestore documents in table
 */
export function displayFirestoreDocuments(documents) {
  const container = document.getElementById('documents-container');

  if (documents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>No documents found</p>
      </div>
    `;
    return;
  }

  const sorted = sortFirestoreDocs(documents);

  const sortIndicator = (col) => {
    if (firestoreSortColumn !== col) return ' <span style="color:#475569;font-size:11px;">⇅</span>';
    return firestoreSortDirection === 'asc'
      ? ' <span style="color:#818cf8;font-size:11px;">↑</span>'
      : ' <span style="color:#818cf8;font-size:11px;">↓</span>';
  };

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
  const invoiceJobs = isInvoiceJobsView();

  const table = document.createElement('table');
  table.innerHTML = invoiceJobs
    ? `
    <thead>
      <tr>
        <th class="checkbox-cell"><input type="checkbox" id="select-all-firestore"></th>
        <th>ID</th>
        <th>Vendor</th>
        <th>Amount</th>
        <th>File</th>
        <th id="sort-status" style="${thStyle}">Status${sortIndicator('status')}</th>
        <th id="sort-createdAt" style="${thStyle}">Created${sortIndicator('createdAt')}</th>
        <th id="sort-updatedAt" style="${thStyle}">Updated${sortIndicator('updatedAt')}</th>
        <th class="action-cell">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `
    : `
    <thead>
      <tr>
        <th class="checkbox-cell"><input type="checkbox" id="select-all-firestore"></th>
        <th>ID</th>
        <th id="sort-status" style="${thStyle}">Status/Type${sortIndicator('status')}</th>
        <th id="sort-createdAt" style="${thStyle}">Created${sortIndicator('createdAt')}</th>
        <th id="sort-updatedAt" style="${thStyle}">Updated${sortIndicator('updatedAt')}</th>
        <th class="action-cell">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  sorted.forEach((doc) => {
    const row = document.createElement('tr');
    const status = doc.data.status || doc.data.documentType || '-';
    const createdAt = formatDate(
      doc.data.createdAt || doc.data.generatedAt || doc.data.startedAt
    );
    const updatedAt = formatDate(doc.data.updatedAt);
    const safeId = escapeHtml(doc.id);
    const safeCollection = escapeHtml(currentCollection);

    if (invoiceJobs) {
      const committed = isCommittedInvoiceJob(status);
      if (!committed) {
        row.style.opacity = '0.65';
      }
      row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="doc-checkbox" data-id="${safeId}">
      </td>
      <td><code style="font-size:0.75rem;">${safeId}</code></td>
      <td>${escapeHtml(committed ? doc.data.vendorName || '—' : '—')}</td>
      <td>${renderInvoiceJobAmountCell(doc)}</td>
      <td>${renderInvoiceJobFileCell(doc)}</td>
      <td>${renderJobStatusHtml(status, { lastError: doc.data.lastError })}</td>
      <td>${createdAt}</td>
      <td>${updatedAt}</td>
      <td class="action-cell">
        <button class="action-btn" onclick="window.viewFirestoreDocument('${safeCollection}', '${safeId}', this)">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="window.deleteFirestoreDocument('${safeCollection}', '${safeId}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <span>Delete</span>
        </button>
      </td>
    `;
    } else {
      row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="doc-checkbox" data-id="${safeId}">
      </td>
      <td><code>${safeId}</code></td>
      <td>${renderJobStatusHtml(status)}</td>
      <td>${createdAt}</td>
      <td>${updatedAt}</td>
      <td class="action-cell">
        <button class="action-btn" onclick="window.viewFirestoreDocument('${safeCollection}', '${safeId}', this)">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="window.deleteFirestoreDocument('${safeCollection}', '${safeId}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <span>Delete</span>
        </button>
      </td>
    `;
    }
    tbody.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(table);

  if (invoiceJobs) {
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:0.8rem;color:var(--muted);margin-top:0.75rem;';
    hint.textContent =
      'Expense jobs: edit amount inline (Enter or ✓). Open/Copy opens the stored invoice file. Sheet is not auto-updated.';
    container.appendChild(hint);
  }

  bindFirestoreDocumentHandlers();

  // Sort header clicks
  const makeToggle = (col, defaultDir) => () => {
    if (firestoreSortColumn === col) {
      firestoreSortDirection = firestoreSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      firestoreSortColumn = col;
      firestoreSortDirection = defaultDir;
    }
    displayFirestoreDocuments(currentFirestoreDocs);
  };
  table.querySelector('#sort-status').addEventListener('click', makeToggle('status', 'asc'));
  table.querySelector('#sort-createdAt').addEventListener('click', makeToggle('createdAt', 'desc'));
  table.querySelector('#sort-updatedAt').addEventListener('click', makeToggle('updatedAt', 'desc'));

  // Select all checkbox
  document.getElementById('select-all-firestore').addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.doc-checkbox');
    checkboxes.forEach((cb) => {
      cb.checked = e.target.checked;
      if (e.target.checked) {
        selectedFirestoreDocs.add(cb.dataset.id);
      } else {
        selectedFirestoreDocs.delete(cb.dataset.id);
      }
    });
    updateFirestoreSelection();
  });

  // Individual checkboxes
  document.querySelectorAll('.doc-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedFirestoreDocs.add(e.target.dataset.id);
      } else {
        selectedFirestoreDocs.delete(e.target.dataset.id);
      }
      updateFirestoreSelection();
    });
  });
}

/**
 * View Firestore document details — expands inline below the row
 */
export async function viewFirestoreDocument(collectionName, documentId, triggerBtn) {
  const clickedRow = triggerBtn ? triggerBtn.closest('tr') : null;
  const existingExpand = document.getElementById('firestore-expand-row');

  // Toggle off if clicking the same row again
  if (existingExpand) {
    const isSame = existingExpand.dataset.docId === documentId;
    existingExpand.remove();
    if (isSame) return;
  }

  showLoading();
  try {
    const response = await fetch(
      `${API_BASE}/firestore/collections/${collectionName}/${documentId}`,
      getAuthHeaders()
    );
    const data = await response.json();

    currentEditingDocument = { collectionName, documentId };
    originalDocumentData = JSON.stringify(data.data, null, 2);

    const colCount = isInvoiceJobsView() ? 9 : 6;
    const expandRow = document.createElement('tr');
    expandRow.id = 'firestore-expand-row';
    expandRow.dataset.docId = documentId;
    expandRow.style.cssText = 'background:#0f172a;';

    const expandCell = document.createElement('td');
    expandCell.colSpan = colCount;
    expandCell.style.cssText = 'padding:16px;border-top:1px solid #1e293b;';

    expandCell.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:flex;gap:16px;align-items:center;">
          <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Document ID:</span>
          <code>${documentId}</code>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="edit-document-btn" class="btn btn-primary">
            <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Edit</span>
          </button>
          <button id="close-expand-btn" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
        </div>
      </div>
      <div id="json-viewer-container">
        <div class="json-viewer" id="json-viewer">${originalDocumentData}</div>
      </div>
      <div id="json-editor-container" style="display:none;">
        <div style="margin-bottom:12px;display:flex;gap:8px;justify-content:flex-end;">
          <button id="cancel-edit-btn" class="btn btn-ghost">Cancel</button>
          <button id="save-document-btn" class="btn btn-primary">
            <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>Save Changes</span>
          </button>
        </div>
        <textarea id="json-editor" class="json-editor" spellcheck="false">${originalDocumentData}</textarea>
        <div id="json-error" class="json-error" style="display:none;"></div>
      </div>
    `;

    expandRow.appendChild(expandCell);

    if (clickedRow) {
      clickedRow.after(expandRow);
    } else {
      document.querySelector('#documents-container tbody')?.appendChild(expandRow);
    }

    document.getElementById('edit-document-btn').addEventListener('click', enableDocumentEditing);
    document.getElementById('close-expand-btn').addEventListener('click', () => expandRow.remove());
  } catch (error) {
    showError('Failed to load document: ' + error.message);
  } finally {
    hideLoading();
  }
}

/**
 * Enable document editing mode
 */
export function enableDocumentEditing() {
  document.getElementById('json-viewer-container').style.display = 'none';
  document.getElementById('json-editor-container').style.display = 'block';
  document.getElementById('edit-document-btn').style.display = 'none';

  const editor = document.getElementById('json-editor');
  editor.focus();

  // Setup cancel button
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    cancelDocumentEditing();
  });

  // Setup save button
  document.getElementById('save-document-btn').addEventListener('click', () => {
    saveDocumentChanges();
  });

  // Validate JSON on input
  editor.addEventListener('input', validateJson);

  // Enable tab key for indentation
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;

      if (e.shiftKey) {
        // Shift+Tab: Remove indentation
        const lines = value.substring(0, start).split('\n');
        const currentLine = lines[lines.length - 1];
        if (currentLine.startsWith('  ')) {
          const newValue = value.substring(0, start - 2) + value.substring(start);
          editor.value = newValue;
          editor.setSelectionRange(start - 2, end - 2);
        }
      } else {
        // Tab: Add indentation
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        editor.value = newValue;
        editor.setSelectionRange(start + 2, start + 2);
      }
      validateJson();
    }
  });
}

/**
 * Cancel document editing
 */
export function cancelDocumentEditing() {
  document.getElementById('json-viewer-container').style.display = 'block';
  document.getElementById('json-editor-container').style.display = 'none';
  document.getElementById('edit-document-btn').style.display = 'inline-flex';
  document.getElementById('json-error').style.display = 'none';

  // Reset editor content
  const editor = document.getElementById('json-editor');
  editor.value = originalDocumentData;
}

/**
 * Validate JSON in editor
 */
export function validateJson() {
  const editor = document.getElementById('json-editor');
  const errorDiv = document.getElementById('json-error');
  const saveBtn = document.getElementById('save-document-btn');

  try {
    const jsonText = editor.value.trim();
    if (!jsonText) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'JSON cannot be empty';
      saveBtn.disabled = true;
      return false;
    }

    JSON.parse(jsonText);
    errorDiv.style.display = 'none';
    saveBtn.disabled = false;
    return true;
  } catch (error) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = `Invalid JSON: ${error.message}`;
    saveBtn.disabled = true;
    return false;
  }
}

/**
 * Save document changes
 */
export async function saveDocumentChanges() {
  const editor = document.getElementById('json-editor');

  if (!validateJson()) {
    return;
  }

  if (!currentEditingDocument) {
    showError('No document being edited');
    return;
  }

  showLoading();
  try {
    const jsonText = editor.value.trim();
    const data = JSON.parse(jsonText);

    const response = await fetch(
      `${API_BASE}/firestore/collections/${currentEditingDocument.collectionName}/${currentEditingDocument.documentId}`,
      {
        method: 'PUT',
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, confirm: true }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update document');
    }

    const result = await response.json();
    showSuccess('Document updated successfully');

    // Update the viewer with new data
    originalDocumentData = JSON.stringify(result.document.data, null, 2);
    document.getElementById('json-viewer').textContent = originalDocumentData;

    // Exit edit mode
    cancelDocumentEditing();

    // Reload the document list to reflect changes
    if (currentCollection === currentEditingDocument.collectionName) {
      loadCollectionDocuments();
    }
  } catch (error) {
    showError('Failed to update document: ' + error.message);
  } finally {
    hideLoading();
  }
}

/**
 * Delete a Firestore document
 */
export function deleteFirestoreDocument(collectionName, documentId) {
  showConfirmModal(
    `document from collection "${collectionName}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/firestore/collections/${collectionName}/${documentId}`,
          {
            method: 'DELETE',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }

        showSuccess('Document deleted successfully');
        loadCollectionDocuments();
      } catch (error) {
        showError('Failed to delete document: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: 1,
      details: `Document ID: <code>${documentId}</code>`,
      warning: 'This action cannot be undone!',
      confirmText: 'Delete Document',
    }
  );
}

/**
 * Delete selected Firestore documents
 */
export function deleteSelectedFirestore() {
  if (selectedFirestoreDocs.size === 0) {
    showError('No documents selected');
    return;
  }

  const count = selectedFirestoreDocs.size;
  showConfirmModal(
    `document(s) from collection "${currentCollection}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/firestore/collections/${currentCollection}/delete-multiple`,
          {
            method: 'POST',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentIds: Array.from(selectedFirestoreDocs),
              confirm: true,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }

        showSuccess(`${count} document(s) deleted successfully`);
        selectedFirestoreDocs.clear();
        updateFirestoreSelection();
        loadCollectionDocuments();
      } catch (error) {
        showError('Failed to delete documents: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: count,
      details: `Collection: <code>${currentCollection}</code>`,
      warning:
        'This action cannot be undone! All selected documents will be permanently deleted.',
      confirmText: `Delete ${count} Document${count > 1 ? 's' : ''}`,
    }
  );
}

/**
 * Update selection UI
 */
export function updateFirestoreSelection() {
  const count = selectedFirestoreDocs.size;
  const bulkActions = document.getElementById('bulk-actions-firestore');
  const countSpan = document.getElementById('selected-count');

  if (count > 0) {
    bulkActions.style.display = 'flex';
    countSpan.textContent = `${count} selected`;
  } else {
    bulkActions.style.display = 'none';
  }
}

/**
 * Clear selection
 */
export function clearFirestoreSelection() {
  selectedFirestoreDocs.clear();
  document.querySelectorAll('.doc-checkbox').forEach((cb) => (cb.checked = false));
  document.getElementById('select-all-firestore').checked = false;
  updateFirestoreSelection();
}

/**
 * Update pagination
 */
export function updateFirestorePagination(hasMore) {
  const pagination = document.getElementById('pagination-firestore');
  pagination.innerHTML = '';

  if (firestoreCursor || hasMore) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = !firestoreCursor;
    prevBtn.onclick = () => loadCollectionDocuments({ reset: true });
    pagination.appendChild(prevBtn);

    if (hasMore) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.onclick = () => loadNextFirestorePage();
      pagination.appendChild(nextBtn);
    }
  }
}
