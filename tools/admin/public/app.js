/**
 * Admin Panel Main Application
 * Entry point for the admin panel application
 */

import { API_BASE, getAuthHeaders, formatBytes } from './js/utils.js';
import * as Firestore from './js/firestore.js';
import * as Storage from './js/storage.js';
import * as Customers from './js/customers.js';
import * as Invites from './js/invites.js';

/**
 * Load status snapshot
 */
async function loadStatusSnapshot() {
  const snapshot = document.getElementById('status-snapshot');
  if (!snapshot) return;

  try {
    const response = await fetch(`${API_BASE}/health`, getAuthHeaders());

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      throw new Error('Failed to parse response as JSON');
    }

    // Validate response structure
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format');
    }

    // Ensure services is an array
    if (!Array.isArray(data.services)) {
      console.warn('Services is not an array:', data);
      data.services = [];
    }

    const overallStatus = data.overall === 'healthy' ? 'healthy' : 'unhealthy';
    const overallIcon =
      overallStatus === 'healthy'
        ? '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

    // Safely handle services array
    const services = data.services || [];
    const servicesHtml = services
      .map((service) => {
        const serviceStatus = service.status === 'healthy' ? 'healthy' : 'unhealthy';
        const serviceIcon =
          serviceStatus === 'healthy'
            ? '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>'
            : '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

        return `
        <div class="service-status ${serviceStatus}">
          ${serviceIcon}
          <div class="service-info">
            <span class="service-name">${service.name}</span>
            <span class="service-message">${service.message || serviceStatus}</span>
          </div>
        </div>
      `;
      })
      .join('');

    // Storage statistics
    const storageStats = data.storage;
    const storageStatsHtml = storageStats
      ? `
      <div class="storage-stats">
        <div class="stat-item">
          <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          <div class="stat-details">
            <span class="stat-label">Total Storage</span>
            <span class="stat-value">${formatBytes(storageStats.totalSize)}</span>
          </div>
        </div>
        <div class="stat-item">
          <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <div class="stat-details">
            <span class="stat-label">Total Objects</span>
            <span class="stat-value">${storageStats.totalObjects.toLocaleString()}</span>
          </div>
        </div>
      </div>
    `
      : '';

    snapshot.innerHTML = `
      <div class="status-content ${overallStatus}">
        <div class="status-header">
          <div class="overall-status">
            ${overallIcon}
            <div class="status-info">
              <span class="status-label">System Status</span>
              <span class="status-value">${
                overallStatus === 'healthy' ? 'All Systems Operational' : 'Issues Detected'
              }</span>
            </div>
          </div>
          <div class="header-right">
            ${storageStatsHtml}
            <div class="version-info">
              <svg class="version-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
              </svg>
              <div class="version-details">
                <span class="version-label">Version</span>
                <a href="https://github.com/idobetesh/invofox" target="_blank" rel="noopener noreferrer" class="version-link"><code class="version-sha" title="${
                  data.version?.sha || 'unknown'
                }">${data.version?.shortSha || 'unknown'}</code></a>
              </div>
            </div>
          </div>
        </div>
        <div class="services-list">
          ${servicesHtml}
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading status snapshot:', error);
    snapshot.innerHTML = `
      <div class="status-content unhealthy">
        <div class="status-error">
          <svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Failed to load status: ${
            error instanceof Error ? error.message : 'Unknown error'
          }</span>
        </div>
      </div>
    `;
  }
}

/**
 * Setup tab switching
 */
function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update buttons
      document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      document.getElementById(`${tab}-tab`).classList.add('active');
    });
  });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Firestore
  document
    .getElementById('load-collection-btn')
    .addEventListener('click', Firestore.loadCollectionDocuments);
  document
    .getElementById('refresh-collection-btn')
    .addEventListener('click', Firestore.loadCollectionDocuments);
  document
    .getElementById('delete-selected-firestore')
    .addEventListener('click', () => Firestore.deleteSelectedFirestore());
  document
    .getElementById('clear-selection-firestore')
    .addEventListener('click', Firestore.clearFirestoreSelection);

  // Storage
  document
    .getElementById('load-bucket-btn')
    .addEventListener('click', Storage.loadBucketObjects);
  document
    .getElementById('refresh-bucket-btn')
    .addEventListener('click', Storage.loadBucketObjects);
  document
    .getElementById('delete-selected-storage')
    .addEventListener('click', () => Storage.deleteSelectedStorage());
  document
    .getElementById('clear-selection-storage')
    .addEventListener('click', Storage.clearStorageSelection);

  // Modal
  document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('show');
  });
}

/**
 * Initialize application
 */
document.addEventListener('DOMContentLoaded', () => {
  // Load status on initial page load/refresh (manual action by user)
  loadStatusSnapshot();

  // Setup core functionality
  setupTabs();
  setupEventListeners();

  // Load initial data
  Firestore.loadCollections();
  Storage.loadBuckets();

  // Setup module-specific functionality
  Customers.setupCustomerManagement();
  Invites.setupInviteCodesTab();

  // Expose functions to window for onclick handlers in dynamically generated HTML
  window.viewFirestoreDocument = Firestore.viewFirestoreDocument;
  window.deleteFirestoreDocument = Firestore.deleteFirestoreDocument;
  window.viewStorageObject = Storage.viewStorageObject;
  window.deleteStorageObject = Storage.deleteStorageObject;
  window.showOffboardingPreview = Customers.showOffboardingPreview;
  window.copyInviteCode = Invites.copyInviteCode;
  window.revokeInviteCode = Invites.revokeInviteCode;
  window.deleteInviteCode = Invites.deleteInviteCode;
  window.cleanupSession = Invites.cleanupSession;
  window.deleteAll = Invites.deleteAll;

  // Auto-refresh disabled to save GCP API costs
  // Only loads when user manually refreshes the page (Cmd+R)
  // setInterval(loadStatusSnapshot, 30000);
});
