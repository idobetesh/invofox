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

  // Typing confirmation input
  let confirmInput = document.getElementById('confirm-type-input');
  if (options.requireTyping) {
    if (!confirmInput) {
      const wrapper = document.createElement('div');
      wrapper.id = 'confirm-type-wrapper';
      wrapper.style.cssText = 'margin: 12px 0 4px; text-align: left;';
      wrapper.innerHTML = `
        <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
          Type <strong style="color:var(--text-primary);font-size:12px;">${options.requireTyping}</strong> to confirm
        </label>
        <input id="confirm-type-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="${options.requireTyping}"
          style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;outline:none;" />
      `;
      messageEl.after(wrapper);
    } else {
      confirmInput.value = '';
      document.getElementById('confirm-type-wrapper').querySelector('label').innerHTML =
        `Type <strong style="color:var(--text-primary);font-size:12px;">${options.requireTyping}</strong> to confirm`;
    }
  } else {
    document.getElementById('confirm-type-wrapper')?.remove();
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

  if (options.requireTyping) {
    newYesBtn.disabled = true;
    newYesBtn.style.opacity = '0.5';
    // Re-query after clone
    const typeInput = document.getElementById('confirm-type-input');
    typeInput.value = '';
    typeInput.oninput = () => {
      const match = typeInput.value === options.requireTyping;
      newYesBtn.disabled = !match;
      newYesBtn.style.opacity = match ? '1' : '0.5';
    };
    setTimeout(() => typeInput.focus(), 50);
  }

  const closeModal = () => {
    modal.classList.remove('show');
    document.getElementById('confirm-type-wrapper')?.remove();
  };

  newYesBtn.onclick = () => {
    if (options.requireTyping && document.getElementById('confirm-type-input')?.value !== options.requireTyping) return;
    closeModal();
    onConfirm();
  };

  newNoBtn.onclick = closeModal;

  if (backdrop) {
    backdrop.onclick = closeModal;
  }
}

/**
 * Format date for display
 */
export function formatDate(dateValue) {
  if (!dateValue) return '-';
  let date;
  if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else if (dateValue.toMillis) {
    date = new Date(dateValue.toMillis());
  } else if (dateValue.toDate) {
    date = dateValue.toDate();
  } else {
    // Firestore Timestamp serialized as { _seconds, _nanoseconds } or { seconds, nanoseconds }
    const secs = dateValue._seconds ?? dateValue.seconds;
    date = typeof secs === 'number' ? new Date(secs * 1000) : new Date(dateValue);
  }
  if (isNaN(date.getTime())) return '-';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
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
