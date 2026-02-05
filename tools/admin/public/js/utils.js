/**
 * Utility Functions Module
 * Common helper functions used throughout the application
 */

// API configuration
export const API_BASE = '/api';
export const ADMIN_PASSWORD = null; // Set if you configured ADMIN_PASSWORD env var

/**
 * Get authorization headers for API requests
 */
export function getAuthHeaders() {
  const headers = {};
  if (ADMIN_PASSWORD) {
    headers['Authorization'] = `Bearer ${ADMIN_PASSWORD}`;
  }
  return { headers };
}

/**
 * Show loading overlay
 */
export function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

/**
 * Show error message
 */
export function showError(message) {
  console.error('Error:', message); // Log to console for debugging
  const container = document.querySelector('.container');
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.innerHTML = `
    <svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span>${message}</span>
  `;
  container.insertBefore(errorDiv, container.firstChild);

  // Scroll to top to ensure message is visible
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    errorDiv.style.opacity = '0';
    errorDiv.style.transform = 'translateY(-10px)';
    setTimeout(() => errorDiv.remove(), 300);
  }, 10000); // Increased from 5s to 10s for errors
}

/**
 * Show success message
 */
export function showSuccess(message) {
  const container = document.querySelector('.container');
  const successDiv = document.createElement('div');
  successDiv.className = 'success';
  successDiv.innerHTML = `
    <svg class="icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
    <span>${message}</span>
  `;
  container.insertBefore(successDiv, container.firstChild);

  // Scroll to top to ensure message is visible
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    successDiv.style.opacity = '0';
    successDiv.style.transform = 'translateY(-10px)';
    setTimeout(() => successDiv.remove(), 300);
  }, 7000); // Increased from 3s to 7s
}

/**
 * Show confirmation modal
 */
export function showConfirmModal(message, onConfirm, options = {}) {
  const modal = document.getElementById('confirm-modal');
  const messageEl = document.getElementById('confirm-message');

  // Build detailed message
  let fullMessage = message;
  if (options.count !== undefined) {
    fullMessage = `<strong>${options.count}</strong> ${message}`;
  }
  if (options.details) {
    fullMessage += `<br><br><small style="color: var(--text-muted);">${options.details}</small>`;
  }
  if (options.warning) {
    fullMessage += `<br><br><div style="color: var(--danger); font-weight: 600; margin-top: 8px;">⚠️ ${options.warning}</div>`;
  }

  messageEl.innerHTML = fullMessage;
  modal.classList.add('show');

  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');
  const backdrop = modal.querySelector('.modal-backdrop');

  // Update button text if provided
  if (options.confirmText) {
    yesBtn.innerHTML = `<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
    <span>${options.confirmText}</span>`;
  }

  // Remove old listeners by cloning
  const newYesBtn = yesBtn.cloneNode(true);
  const newNoBtn = noBtn.cloneNode(true);
  yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
  noBtn.parentNode.replaceChild(newNoBtn, noBtn);

  newYesBtn.onclick = () => {
    modal.classList.remove('show');
    onConfirm();
  };

  newNoBtn.onclick = () => {
    modal.classList.remove('show');
  };

  if (backdrop) {
    backdrop.onclick = () => {
      modal.classList.remove('show');
    };
  }
}

/**
 * Format date for display
 */
export function formatDate(dateValue) {
  if (!dateValue) return '-';
  if (typeof dateValue === 'string') return new Date(dateValue).toLocaleString();
  if (dateValue.toMillis) return new Date(dateValue.toMillis()).toLocaleString();
  if (dateValue.toDate) return dateValue.toDate().toLocaleString();
  return new Date(dateValue).toLocaleString();
}

/**
 * Format bytes to human readable format
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
