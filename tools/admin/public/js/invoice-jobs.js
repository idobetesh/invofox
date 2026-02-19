/**
 * Invoice Jobs Module
 * List and correct OCR-processed invoice jobs
 */

import { API_BASE, getAuthHeaders } from './utils.js';

let allJobs = [];
let sortKey = 'receivedAt';
let sortDir = -1; // -1 = desc, 1 = asc

const COLUMNS = [
  { key: 'receivedAt',  label: 'Received' },
  { key: 'vendorName',  label: 'Vendor' },
  { key: 'totalAmount', label: 'Amount' },
  { key: 'currency',    label: 'Currency' },
  { key: 'invoiceDate', label: 'Date' },
  { key: 'uploaderUsername', label: 'Uploader' },
  { key: 'chatTitle',   label: 'Chat' },
  { key: 'status',      label: 'Status' },
  { key: null,          label: 'Link' },
  { key: null,          label: 'Actions' },
];

function formatDate(isoString) {
  if (!isoString) return '?';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return isoString;
  }
}

function statusBadge(status) {
  const colors = {
    processed: 'var(--success)',
    failed: 'var(--error)',
    pending_decision: 'var(--warning)',
    processing: 'var(--info, #3b82f6)',
  };
  const color = colors[status] || 'var(--muted)';
  return `<span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:${color}20;color:${color};white-space:nowrap;">${status}</span>`;
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

    // Date sort for receivedAt / invoiceDate
    if (sortKey === 'receivedAt' || sortKey === 'invoiceDate') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
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

  const rows = sorted.map(j => `
    <tr>
      <td style="white-space:nowrap;font-size:0.8rem;">${formatDate(j.receivedAt)}</td>
      <td>${j.vendorName || '?'}</td>
      <td>${j.totalAmount !== null ? j.totalAmount : '?'}</td>
      <td>${j.currency || ''}</td>
      <td>${formatDate(j.invoiceDate)}</td>
      <td>${j.uploaderUsername || '?'}</td>
      <td>${j.chatTitle || j.chatId || '?'}</td>
      <td>${statusBadge(j.status)}</td>
      <td>
        ${j.driveLink && /^https?:\/\//i.test(j.driveLink) ? `<a href="${j.driveLink}" target="_blank" rel="noopener noreferrer" style="font-size:0.8rem;">View</a>` : ''}
      </td>
      <td>
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;" onclick="openInvoiceEditModal('${j.jobId}')">Edit</button>
      </td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="data-table" style="width:100%;font-size:0.85rem;">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem;">${sorted.length} jobs shown</p>
  `;
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
  document.getElementById('edit-date').value = job.invoiceDate ? job.invoiceDate.split('T')[0] : '';
  document.getElementById('edit-vendor').value = job.vendorName || '';

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

  const updates = {};
  if (amountRaw) {
    const n = parseFloat(amountRaw);
    if (isNaN(n) || n <= 0) { alert('Invalid amount'); return; }
    updates.totalAmount = n;
  }
  if (dateRaw) updates.invoiceDate = dateRaw;
  if (vendorRaw) updates.vendorName = vendorRaw;

  if (!Object.keys(updates).length) { alert('No changes to save'); return; }

  const btn = document.getElementById('save-invoice-edit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetch(`${API_BASE}/invoice-jobs/${encodeURIComponent(jobId)}/correction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(getAuthHeaders().headers || {}) },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    await res.json();
    closeInvoiceEditModal();

    // Update local cache and re-render
    const idx = allJobs.findIndex(j => j.jobId === jobId);
    if (idx !== -1) {
      if (updates.totalAmount !== undefined) allJobs[idx].totalAmount = updates.totalAmount;
      if (updates.invoiceDate !== undefined) allJobs[idx].invoiceDate = updates.invoiceDate;
      if (updates.vendorName !== undefined) allJobs[idx].vendorName = updates.vendorName;
    }
    renderTable(getFiltered());

    showToast('✅ Saved — note: changes are not reflected in Google Sheets', 'warning');
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function showToast(message, type = 'success') {
  const bg = type === 'warning' ? '#d97706' : 'var(--success,#22c55e)';
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

  loadBtn?.addEventListener('click', loadInvoiceJobs);
  refreshBtn?.addEventListener('click', loadInvoiceJobs);
  saveBtn?.addEventListener('click', saveInvoiceEdit);

  // Live search — re-filter without hitting the API
  searchEl?.addEventListener('input', () => renderTable(getFiltered()));

  // Expose sort handler for inline onclick in dynamically generated table headers
  window._invoiceSortBy = setSort;
}
