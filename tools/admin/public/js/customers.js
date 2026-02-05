/**
 * Customer Management Module
 * Handles customer listing and offboarding operations
 */

import {
  API_BASE,
  getAuthHeaders,
  formatDate,
  escapeHtml,
} from './utils.js';

let currentOffboardingChatId = null;

/**
 * Load all customers
 */
export async function loadCustomers() {
  const container = document.getElementById('customers-container');
  container.innerHTML =
    '<div class="loading-state"><div class="spinner-small"></div><p>Loading customers...</p></div>';

  try {
    const response = await fetch(`${API_BASE}/customers`, getAuthHeaders());

    if (!response.ok) {
      throw new Error('Failed to fetch customers');
    }

    const data = await response.json();
    displayCustomers(data.customers);
  } catch (error) {
    console.error('Error loading customers:', error);
    container.innerHTML = `<div class="empty-state"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Error loading customers</p></div>`;
  }
}

/**
 * Display customers in table
 */
export function displayCustomers(customers) {
  const container = document.getElementById('customers-container');

  if (customers.length === 0) {
    container.innerHTML = `<div class="empty-state"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>No customers found</p></div>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Chat ID</th>
        <th>Business Name</th>
        <th>Tax ID</th>
        <th>Email</th>
        <th>Phone</th>
        <th>Logo</th>
        <th>Sheet</th>
        <th>Updated</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${customers
        .map(
          (customer) => `
        <tr>
          <td><code>${customer.chatId}</code></td>
          <td><strong>${escapeHtml(customer.name)}</strong></td>
          <td>${escapeHtml(customer.taxId)}</td>
          <td>${escapeHtml(customer.email)}</td>
          <td>${escapeHtml(customer.phone)}</td>
          <td>${
            customer.hasLogo
              ? '<span class="badge badge-success">✓</span>'
              : '<span class="badge badge-secondary">✗</span>'
          }</td>
          <td>${
            customer.hasSheet
              ? '<span class="badge badge-success">✓</span>'
              : '<span class="badge badge-secondary">✗</span>'
          }</td>
          <td>${formatDate(customer.updatedAt)}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="window.showOffboardingPreview(${
              customer.chatId
            })">
              <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              <span>Offboard</span>
            </button>
          </td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);
}

/**
 * Show offboarding preview modal
 */
export async function showOffboardingPreview(chatId) {
  currentOffboardingChatId = chatId;
  const modal = document.getElementById('offboard-modal');
  const content = document.getElementById('offboard-preview-content');

  content.innerHTML =
    '<div class="loading-state"><div class="spinner-small"></div><p>Scanning customer data...</p></div>';
  modal.classList.add('show');

  try {
    const response = await fetch(
      `${API_BASE}/customers/${chatId}/offboarding-preview`,
      getAuthHeaders()
    );

    if (!response.ok) {
      throw new Error('Failed to load preview');
    }

    const preview = await response.json();
    displayOffboardingPreview(preview);
  } catch (error) {
    console.error('Error loading preview:', error);
    content.innerHTML = `<p style="color: #dc2626;">Error loading preview: ${error.message}</p>`;
  }
}

/**
 * Display offboarding preview details
 */
export function displayOffboardingPreview(preview) {
  const content = document.getElementById('offboard-preview-content');
  const { summary, totalItems, customerName } = preview;

  // Build list of items to delete (only show items that exist)
  const items = [];

  if (summary.businessConfig) {
    items.push({ label: 'Business Configuration', detail: '' });
  }
  if (summary.logo.exists) {
    const filename = summary.logo.path?.split('/').pop() || 'logo file';
    items.push({ label: 'Logo', detail: filename });
  }
  if (summary.onboardingSession) {
    items.push({ label: 'Onboarding Session', detail: '' });
  }
  if (summary.counters.count > 0) {
    items.push({
      label: 'Invoice Counters',
      detail: `${summary.counters.count} document${summary.counters.count !== 1 ? 's' : ''}`,
    });
  }
  if (summary.generatedInvoices.count > 0) {
    items.push({
      label: 'Generated Invoices',
      detail: `${summary.generatedInvoices.count} document${
        summary.generatedInvoices.count !== 1 ? 's' : ''
      }`,
    });
  }
  if (summary.generatedPDFs.count > 0) {
    items.push({
      label: 'Generated PDFs',
      detail: `${summary.generatedPDFs.count} file${summary.generatedPDFs.count !== 1 ? 's' : ''}`,
    });
  }
  if (summary.receivedInvoices.count > 0) {
    items.push({
      label: 'Received Invoices',
      detail: `${summary.receivedInvoices.count} file${
        summary.receivedInvoices.count !== 1 ? 's' : ''
      }`,
    });
  }
  if (summary.userMappings.count > 0) {
    items.push({
      label: 'User Mappings',
      detail: `${summary.userMappings.count} user${summary.userMappings.count !== 1 ? 's' : ''}`,
    });
  }
  if (summary.processingJobs.count > 0) {
    items.push({
      label: 'Processing Jobs',
      detail: `${summary.processingJobs.count} job${summary.processingJobs.count !== 1 ? 's' : ''}`,
    });
  }

  content.innerHTML = `
    <div style="margin-bottom: 24px;">
      <p style="margin-bottom: 12px; font-size: 15px;">
        <strong>Customer:</strong> ${escapeHtml(customerName)}
        <span style="color: #6b7280;">(Chat ID: ${preview.chatId})</span>
      </p>
      <p style="color: #dc2626; font-weight: 600; font-size: 14px; line-height: 1.5;">
        ⚠️ This will permanently delete ALL data for this customer. This action cannot be undone!
      </p>
    </div>

    <div style="margin-bottom: 20px;">
      <h4 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;">
        Data to be deleted:
      </h4>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${items
          .map(
            (item) => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f3f4f6; border-radius: 6px; font-size: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #10b981; font-weight: bold;">✓</span>
              <span style="font-weight: 500; color: #111827;">${item.label}</span>
            </div>
            ${item.detail ? `<span style="color: #4b5563; font-size: 13px;">${item.detail}</span>` : ''}
          </div>
        `
          )
          .join('')}
      </div>
    </div>

    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; text-align: center;">
      <p style="margin: 0; font-weight: 700; color: #991b1b; font-size: 15px;">
        Total items to delete: ${totalItems}
      </p>
    </div>
  `;
}

/**
 * Confirm and execute offboarding
 */
export async function confirmOffboarding() {
  if (!currentOffboardingChatId) return;

  const confirmBtn = document.getElementById('offboard-confirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<div class="spinner-small"></div> Deleting...';

  try {
    const response = await fetch(`${API_BASE}/customers/${currentOffboardingChatId}/offboard`, {
      method: 'DELETE',
      ...getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to offboard customer');
    }

    const result = await response.json();

    // Close modal
    document.getElementById('offboard-modal').classList.remove('show');

    // Show success message
    alert(
      `✅ Customer ${currentOffboardingChatId} has been successfully offboarded.\n\nTotal items deleted: ${result.deleted}`
    );

    // Reload customers list
    loadCustomers();
    currentOffboardingChatId = null;
  } catch (error) {
    console.error('Error offboarding customer:', error);
    alert(`❌ Error: ${error.message}`);
    confirmBtn.disabled = false;
    confirmBtn.innerHTML =
      '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Permanently Delete All Data</span>';
  }
}

/**
 * Setup customer management event listeners
 */
export function setupCustomerManagement() {
  // Refresh button
  const refreshBtn = document.getElementById('refresh-customers-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadCustomers);
  }

  // Offboarding modal buttons
  const offboardConfirm = document.getElementById('offboard-confirm');
  if (offboardConfirm) {
    offboardConfirm.addEventListener('click', confirmOffboarding);
  }

  const offboardCancel = document.getElementById('offboard-cancel');
  if (offboardCancel) {
    offboardCancel.addEventListener('click', () => {
      document.getElementById('offboard-modal').classList.remove('show');
      currentOffboardingChatId = null;
    });
  }

  // Load customers when customers tab is activated
  const customersTab = document.querySelector('[data-tab="customers"]');
  if (customersTab) {
    customersTab.addEventListener('click', () => {
      loadCustomers();
    });
  }
}
