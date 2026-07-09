/**
 * Invoice Jobs Module
 * List and correct OCR-processed invoice jobs
 */

import { API_BASE, getAuthHeaders, escapeHtml, isCommittedInvoiceJob, renderJobStatusHtml } from './utils.js';
import {
  promptAndSaveInvoiceJobAmount,
  promptAndSaveInvoiceJobCorrection,
} from './invoice-amount-update.js';

let allJobs = [];
let sortKey = 'createdAt';
let sortDir = -1; // -1 = desc, 1 = asc

const COLUMNS = [
  { key: 'createdAt',  label: 'Created' },
  { key: 'vendorName',  label: 'Vendor' },
  { key: 'totalAmount', label: 'Amount' },
  { key: 'currency',    label: 'Currency' },
  { key: 'invoiceDate', label: 'Date' },
  { key: 'uploaderUsername', label: 'Uploader' },
  { key: 'chatTitle',   label: 'Chat' },
  { key: 'status',      label: 'Status' },
  { key: null,          label: 'File' },
  { key: null,          label: '' },
];

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  const secs = value._seconds ?? value.seconds;
  if (typeof secs === 'number') return secs * 1000;
  return 0;
}

function formatDate(isoString) {
  if (!isoString) return '?';
  try {
    const d =
      typeof isoString === 'object'
        ? new Date(toMillis(isoString))
        : new Date(isoString);
    if (isNaN(d.getTime())) return '?';
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return isoString;
  }
}

function isCommittedJob(job) {
  return isCommittedInvoiceJob(job.status);
}

function sortIcon(col) {
  if (col !== sortKey) return '<span style="opacity:0.3;margin-left:4px;">⇅</span>';
  return sortDir === -1
    ? '<span style="margin-left:4px;">↓</span>'
    : '<span style="margin-left:4px;">↑</span>';
}

function setSort(key) {
  if (sortKey === key) {
    sortDir = sortDir * -1;
  } else {
    sortKey = key;
    sortDir = -1;
  }
  renderTable(getFiltered());
}

function getFiltered() {
  const search = document.getElementById('invoice-jobs-search')?.value?.trim().toLowerCase() || '';
  if (!search) return allJobs;
  return allJobs.filter(j => {
    return (
      (j.vendorName || '').toLowerCase().includes(search) ||
      (j.uploaderUsername || '').toLowerCase().includes(search) ||
      (j.chatTitle || '').toLowerCase().includes(search) ||
      String(j.chatId || '').includes(search) ||
      (j.status || '').toLowerCase().includes(search) ||
      (j.currency || '').toLowerCase().includes(search) ||
      String(j.totalAmount ?? '').includes(search)
    );
  });
}

function getSorted(jobs) {
  return [...jobs].sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];

    // Numeric sort for amount
    if (sortKey === 'totalAmount') {
      va = va ?? -Infinity;
      vb = vb ?? -Infinity;
      return (va - vb) * sortDir;
    }

    // Date sort for createdAt / receivedAt / invoiceDate
    if (sortKey === 'createdAt' || sortKey === 'receivedAt' || sortKey === 'invoiceDate') {
      va = toMillis(va);
      vb = toMillis(vb);
      return (va - vb) * sortDir;
    }

    // Default: string sort
    va = (va || '').toString().toLowerCase();
    vb = (vb || '').toString().toLowerCase();
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });
}

function isSafeFileUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function renderAmountCell(job) {
  const value = job.totalAmount !== null && job.totalAmount !== undefined ? job.totalAmount : '';
  return `
    <div class="inline-amount-edit" style="display:flex;align-items:center;gap:6px;min-width:120px;">
      <input
        type="number"
        class="modern-input invoice-amount-input"
        data-job-id="${escapeHtml(job.jobId)}"
        data-saved-amount="${escapeHtml(String(value))}"
        value="${value}"
        step="0.01"
        min="0.01"
        placeholder="?"
        style="width:88px;padding:4px 8px;font-size:0.8rem;"
        title="Edit amount — Enter or ✓ to save"
      />
      <button
        type="button"
        class="btn btn-ghost save-amount-btn"
        data-job-id="${escapeHtml(job.jobId)}"
        title="Save amount"
        style="padding:4px 8px;font-size:0.75rem;line-height:1;"
      >✓</button>
    </div>
  `;
}

function renderFileCell(job) {
  if (!isCommittedJob(job) || !isSafeFileUrl(job.driveLink)) {
    return '<span style="color:var(--muted);font-size:0.75rem;">—</span>';
  }
  const safeUrl = escapeHtml(job.driveLink);
  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
      <a
        href="${safeUrl}"
        class="action-btn"
        target="_blank"
        rel="noopener noreferrer"
        title="Open invoice file"
        style="padding:4px 10px;font-size:0.75rem;"
      >
        <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        <span>Open</span>
      </a>
      <button
        type="button"
        class="action-btn copy-file-btn"
        data-url="${safeUrl}"
        title="Copy file URL"
        style="padding:4px 10px;font-size:0.75rem;"
      >
        <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>Copy</span>
      </button>
    </div>
  `;
}

function renderTable(jobs) {
  const container = document.getElementById('invoice-jobs-container');
  if (!jobs.length) {
    container.innerHTML = '<div class="empty-state"><p>No invoices found</p></div>';
    return;
  }

  const sorted = getSorted(jobs);

  const headerCells = COLUMNS.map(col => {
    if (!col.key) return `<th>${col.label}</th>`;
    return `<th style="cursor:pointer;user-select:none;" onclick="window._invoiceSortBy('${col.key}')">${col.label}${sortIcon(col.key)}</th>`;
  }).join('');

  const rows = sorted.map(j => {
    const mutedRow = !isCommittedJob(j) ? 'opacity:0.65;' : '';
    return `
    <tr data-job-id="${escapeHtml(j.jobId)}" style="${mutedRow}">
      <td style="white-space:nowrap;font-size:0.8rem;">${formatDate(j.createdAt || j.receivedAt)}</td>
      <td>${escapeHtml(j.vendorName || (isCommittedJob(j) ? '?' : '—'))}</td>
      <td>${renderAmountCell(j)}</td>
      <td>${escapeHtml(j.currency || '')}</td>
      <td style="white-space:nowrap;font-size:0.8rem;">${formatDate(j.invoiceDate)}</td>
      <td>${escapeHtml(j.uploaderUsername || '?')}</td>
      <td>${escapeHtml(j.chatTitle || String(j.chatId || '?'))}</td>
      <td>${renderJobStatusHtml(j.status, { lastError: j.lastError })}</td>
      <td>${renderFileCell(j)}</td>
      <td>
        <button
          type="button"
          class="btn btn-ghost edit-invoice-btn"
          data-job-id="${escapeHtml(j.jobId)}"
          style="padding:4px 10px;font-size:0.8rem;"
          title="Edit date & vendor"
        >More</button>
      </td>
    </tr>
  `;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="data-table invoice-jobs-table" style="width:100%;font-size:0.85rem;">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem;">${sorted.length} jobs shown — edit amount inline; use Open/Copy for the stored file</p>
  `;
}

async function saveAmountForJob(jobId, amountRaw, inputEl) {
  const job = allJobs.find((j) => j.jobId === jobId);
  if (!job) {
    return false;
  }

  return promptAndSaveInvoiceJobAmount({
    jobId,
    newAmountRaw: amountRaw,
    previousAmount: job.totalAmount,
    chatId: job.chatId,
    sheetRowId: job.sheetRowId,
    currency: job.currency || 'ILS',
    inputEl,
    inputLookup: { kind: 'invoice-job', id: jobId },
    onSaved: (n) => {
      job.totalAmount = n;
      const liveInput = document.querySelector(
        `.invoice-amount-input[data-job-id="${CSS.escape(jobId)}"]`
      );
      if (liveInput) {
        liveInput.dataset.savedAmount = String(n);
      }
    },
    showToast,
  });
}

function handleInvoiceJobsTableClick(event) {
  const saveBtn = event.target.closest('.save-amount-btn');
  if (saveBtn) {
    const jobId = saveBtn.dataset.jobId;
    const row = saveBtn.closest('tr');
    const input = row?.querySelector('.invoice-amount-input');
    if (jobId && input) {
      void saveAmountForJob(jobId, input.value.trim(), input);
    }
    return;
  }

  const copyBtn = event.target.closest('.copy-file-btn');
  if (copyBtn?.dataset.url) {
    void navigator.clipboard.writeText(copyBtn.dataset.url).then(
      () => showToast('File URL copied'),
      () => showToast('Could not copy URL', 'error')
    );
    return;
  }

  const editBtn = event.target.closest('.edit-invoice-btn');
  if (editBtn?.dataset.jobId) {
    openInvoiceEditModal(editBtn.dataset.jobId);
  }
}

function handleInvoiceJobsTableKeydown(event) {
  if (event.key !== 'Enter' || !event.target.classList.contains('invoice-amount-input')) {
    return;
  }
  event.preventDefault();
  const input = event.target;
  const jobId = input.dataset.jobId;
  if (jobId) {
    void saveAmountForJob(jobId, input.value.trim(), input);
  }
}

export async function loadInvoiceJobs() {
  const chatIdEl = document.getElementById('invoice-jobs-chatid');
  const container = document.getElementById('invoice-jobs-container');

  container.innerHTML = '<div class="loading-state"><div class="spinner-small"></div><p>Loading...</p></div>';

  const chatId = chatIdEl?.value?.trim();
  const url = chatId
    ? `${API_BASE}/invoice-jobs?chatId=${encodeURIComponent(chatId)}&limit=100`
    : `${API_BASE}/invoice-jobs?limit=100`;

  try {
    const res = await fetch(url, getAuthHeaders());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allJobs = data.jobs || [];
    renderTable(getFiltered());
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Failed to load: ${err.message}</p></div>`;
  }
}

export function openInvoiceEditModal(jobId) {
  const job = allJobs.find(j => j.jobId === jobId);
  if (!job) return;

  document.getElementById('edit-job-id').value = jobId;
  document.getElementById('edit-amount').value = job.totalAmount ?? '';
  const editAmountEl = document.getElementById('edit-amount');
  if (editAmountEl) {
    editAmountEl.dataset.savedAmount =
      job.totalAmount !== null && job.totalAmount !== undefined ? String(job.totalAmount) : '';
  }
  document.getElementById('edit-date').value = job.invoiceDate ? job.invoiceDate.split('T')[0] : '';
  document.getElementById('edit-vendor').value = job.vendorName || '';

  const fileLinkEl = document.getElementById('edit-file-link');
  if (fileLinkEl) {
    if (isCommittedJob(job) && isSafeFileUrl(job.driveLink)) {
      const safeUrl = escapeHtml(job.driveLink);
      fileLinkEl.innerHTML = `
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="word-break:break-all;">${safeUrl}</a>
        <button type="button" class="btn btn-ghost copy-file-btn" data-url="${safeUrl}" style="margin-top:8px;padding:4px 10px;font-size:0.8rem;">Copy file URL</button>
      `;
      fileLinkEl.style.display = 'block';
    } else {
      fileLinkEl.innerHTML = '<span style="color:var(--muted);">No file link</span>';
      fileLinkEl.style.display = 'block';
    }
  }

  document.getElementById('invoice-edit-modal').classList.add('show');
}

export function closeInvoiceEditModal() {
  document.getElementById('invoice-edit-modal').classList.remove('show');
}

export async function saveInvoiceEdit() {
  const jobId = document.getElementById('edit-job-id').value;
  const amountRaw = document.getElementById('edit-amount').value.trim();
  const dateRaw = document.getElementById('edit-date').value.trim();
  const vendorRaw = document.getElementById('edit-vendor').value.trim();

  const job = allJobs.find((j) => j.jobId === jobId);
  if (!job) {
    alert('Job not found');
    return;
  }

  const updates = {};
  if (amountRaw) {
    const n = parseFloat(amountRaw);
    if (Number.isNaN(n) || n <= 0) {
      alert('Invalid amount');
      return;
    }
    if (Number(job.totalAmount) !== Number(n)) {
      updates.totalAmount = n;
    }
  }
  if (dateRaw && dateRaw !== (job.invoiceDate || '').split('T')[0]) {
    updates.invoiceDate = dateRaw;
  }
  if (vendorRaw && vendorRaw !== (job.vendorName || '')) {
    updates.vendorName = vendorRaw;
  }

  if (!Object.keys(updates).length) {
    alert('No changes to save');
    return;
  }

  const btn = document.getElementById('save-invoice-edit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await promptAndSaveInvoiceJobCorrection({
      jobId,
      updates,
      previousAmount: job.totalAmount,
      chatId: job.chatId,
      sheetRowId: job.sheetRowId,
      currency: job.currency || 'ILS',
      inputEl: document.getElementById('edit-amount'),
      inputLookup: { kind: 'edit' },
      showToast,
      onSaved: () => {
        closeInvoiceEditModal();
        const idx = allJobs.findIndex((j) => j.jobId === jobId);
        if (idx !== -1) {
          if (updates.totalAmount !== undefined) allJobs[idx].totalAmount = updates.totalAmount;
          if (updates.invoiceDate !== undefined) allJobs[idx].invoiceDate = updates.invoiceDate;
          if (updates.vendorName !== undefined) allJobs[idx].vendorName = updates.vendorName;
        }
        renderTable(getFiltered());
      },
    });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function showToast(message, type = 'success') {
  const bg =
    type === 'warning' ? '#d97706' : type === 'error' ? '#dc2626' : 'var(--success,#22c55e)';
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position:fixed;bottom:2rem;right:2rem;background:${bg};color:#fff;padding:0.75rem 1.25rem;border-radius:8px;z-index:9999;font-size:0.875rem;box-shadow:0 4px 12px rgba(0,0,0,.15);max-width:420px;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), type === 'warning' ? 6000 : 3000);
}

export function setupInvoiceJobsTab() {
  const loadBtn = document.getElementById('load-invoice-jobs-btn');
  const refreshBtn = document.getElementById('refresh-invoice-jobs-btn');
  const saveBtn = document.getElementById('save-invoice-edit-btn');
  const searchEl = document.getElementById('invoice-jobs-search');
  const container = document.getElementById('invoice-jobs-container');
  const editModal = document.getElementById('invoice-edit-modal');

  loadBtn?.addEventListener('click', loadInvoiceJobs);
  refreshBtn?.addEventListener('click', loadInvoiceJobs);
  saveBtn?.addEventListener('click', saveInvoiceEdit);

  // Live search — re-filter without hitting the API
  searchEl?.addEventListener('input', () => renderTable(getFiltered()));

  // Inline amount save, file copy, and row actions
  container?.addEventListener('click', handleInvoiceJobsTableClick);
  container?.addEventListener('keydown', handleInvoiceJobsTableKeydown);
  editModal?.addEventListener('click', (event) => {
    const copyBtn = event.target.closest('.copy-file-btn');
    if (copyBtn?.dataset.url) {
      void navigator.clipboard.writeText(copyBtn.dataset.url).then(
        () => showToast('File URL copied'),
        () => showToast('Could not copy URL', 'error')
      );
    }
  });

  // Expose sort handler for inline onclick in dynamically generated table headers
  window._invoiceSortBy = setSort;
}
