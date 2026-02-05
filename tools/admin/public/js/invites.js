/**
 * Invite Codes Management Module
 * Handles invite code generation, listing, and management
 */

import { API_BASE, getAuthHeaders, escapeHtml } from './utils.js';

let currentInviteStatus = 'active';

/**
 * Load admin configuration
 */
export async function loadAdminConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`);
    if (!response.ok) {
      console.warn('Failed to load admin config');
      return;
    }

    const config = await response.json();

    // Auto-fill admin credentials if available
    const adminIdField = document.getElementById('invite-admin-id');
    const adminUsernameField = document.getElementById('invite-admin-username');

    if (config.adminUserId && adminIdField) {
      adminIdField.value = config.adminUserId;
      adminIdField.readOnly = true;
      adminIdField.style.opacity = '0.7';
      adminIdField.title = 'Loaded from environment variables';
    }

    if (config.adminUsername && adminUsernameField) {
      adminUsernameField.value = config.adminUsername;
      adminUsernameField.readOnly = true;
      adminUsernameField.style.opacity = '0.7';
      adminUsernameField.title = 'Loaded from environment variables';
    }
  } catch (error) {
    console.error('Error loading admin config:', error);
  }
}

/**
 * Setup invite codes tab
 */
export function setupInviteCodesTab() {
  // Load admin config on setup
  loadAdminConfig();

  // Generate invite code button
  const generateBtn = document.getElementById('generate-invite-btn');
  if (generateBtn) {
    generateBtn.addEventListener('click', generateInviteCode);
  }

  // Refresh button
  const refreshBtn = document.getElementById('refresh-invites-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadInviteCodes(currentInviteStatus));
  }

  // Status filter buttons
  const statusButtons = document.querySelectorAll('#invites-tab .filter-button[data-status]');
  statusButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Update active state
      statusButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Load codes with selected status
      currentInviteStatus = btn.dataset.status;
      loadInviteCodes(currentInviteStatus);
    });
  });

  // Load invite codes when tab is activated
  const invitesTab = document.querySelector('[data-tab="invites"]');
  if (invitesTab) {
    invitesTab.addEventListener('click', () => {
      loadInviteCodes(currentInviteStatus);
    });
  }
}

/**
 * Generate new invite code
 */
export async function generateInviteCode() {
  const adminId = document.getElementById('invite-admin-id').value;
  const adminUsername = document.getElementById('invite-admin-username').value;
  const note = document.getElementById('invite-note').value;
  const expiresInDays = document.getElementById('invite-expires').value;

  if (!adminId || !adminUsername) {
    alert('Please enter your Telegram User ID and Username');
    return;
  }

  // Hide previous success message
  const successDiv = document.getElementById('invite-success');
  if (successDiv) {
    successDiv.style.display = 'none';
  }

  const generateBtn = document.getElementById('generate-invite-btn');
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<div class="spinner-small"></div> Generating...';

  try {
    const response = await fetch(`${API_BASE}/invite-codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders().headers,
      },
      body: JSON.stringify({
        adminUserId: parseInt(adminId),
        adminUsername,
        note,
        expiresInDays: parseInt(expiresInDays),
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate invite code');
    }

    const result = await response.json();
    const code = result.inviteCode.code;

    // Show success message in UI
    const codeDisplay = document.getElementById('generated-code');
    const onboardCommand = document.getElementById('onboard-command');
    const copyBtn = document.getElementById('copy-code-btn');

    codeDisplay.textContent = code;
    onboardCommand.textContent = `/onboard ${code}`;
    successDiv.style.display = 'block';

    // Setup copy button
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(`/onboard ${code}`);
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML =
          '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.innerHTML = originalHTML;
          copyBtn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    };

    // Clear form
    document.getElementById('invite-note').value = '';

    // Reload list
    loadInviteCodes(currentInviteStatus);

    // Scroll to success message
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    console.error('Error generating invite code:', error);
    alert(`❌ Error: ${error.message}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML =
      '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><span>Generate Code</span>';
  }
}

/**
 * Load invite codes
 */
export async function loadInviteCodes(status = 'active') {
  const container = document.getElementById('invites-container');

  container.innerHTML = `
    <div class="loading">
      <div class="spinner-small"></div>
      <span>Loading invite codes...</span>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE}/invite-codes?status=${status}`, getAuthHeaders());

    if (!response.ok) {
      throw new Error('Failed to load invite codes');
    }

    const data = await response.json();

    // Fetch onboarding status for used codes
    const codesWithStatus = await Promise.all(
      data.inviteCodes.map(async (code) => {
        if (code.used) {
          try {
            const statusResponse = await fetch(
              `${API_BASE}/invite-codes/${code.code}/onboarding-status`,
              getAuthHeaders()
            );
            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              return { ...code, onboardingStatus: statusData.status };
            }
          } catch (err) {
            console.warn(`Failed to get onboarding status for ${code.code}:`, err);
          }
        }
        return code;
      })
    );

    renderInviteCodes(codesWithStatus);
  } catch (error) {
    console.error('Error loading invite codes:', error);
    container.innerHTML = `
      <div class="error">
        <p>❌ Error loading invite codes: ${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

/**
 * Render invite codes list
 */
export function renderInviteCodes(codes) {
  const container = document.getElementById('invites-container');

  if (codes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <p>No invite codes found</p>
      </div>
    `;
    return;
  }

  const html = codes
    .map((code) => {
      const createdAt = new Date(code.createdAt._seconds * 1000);
      const expiresAt = new Date(code.expiresAt._seconds * 1000);
      const usedAt = code.usedAt ? new Date(code.usedAt._seconds * 1000) : null;

      const statusBadge = code.used
        ? '<span class="status-badge status-used">Used</span>'
        : code.revoked
        ? '<span class="status-badge status-revoked">Revoked</span>'
        : expiresAt < new Date()
        ? '<span class="status-badge status-expired">Expired</span>'
        : '<span class="status-badge status-active">Active</span>';

      // Onboarding status badge
      const onboardingBadge =
        code.onboardingStatus && code.onboardingStatus.exists
          ? code.onboardingStatus.status === 'stuck'
            ? `<span class="status-badge" style="background: #ef4444; color: white;">🔴 Stuck (${code.onboardingStatus.age}h old)</span>`
            : `<span class="status-badge" style="background: #f59e0b; color: white;">🟡 In Progress (${code.onboardingStatus.step})</span>`
          : code.used
          ? '<span class="status-badge" style="background: #10b981; color: white;">🟢 Completed</span>'
          : '';

      const usageInfo = code.used
        ? `
        <div style="margin-top: 12px; padding: 16px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; line-height: 1.8;">
          <div><strong style="color: var(--text-primary);">Used by:</strong> <span style="color: var(--text-secondary);">${escapeHtml(
            code.usedBy.chatTitle
          )} (Chat ID: ${code.usedBy.chatId})</span></div>
          <div><strong style="color: var(--text-primary);">Used at:</strong> <span style="color: var(--text-secondary);">${usedAt.toLocaleString()}</span></div>
          <div style="margin-top: 8px;"><strong style="color: var(--text-primary);">Onboarding:</strong> ${onboardingBadge}</div>
        </div>
      `
        : '';

      // Actions for unused codes
      const unusedActions =
        !code.used && !code.revoked
          ? `
        <button class="btn btn-small btn-secondary" onclick="window.copyInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
        <button class="btn btn-small btn-warning" onclick="window.revokeInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          Revoke
        </button>
        <button class="btn btn-small btn-danger" onclick="window.deleteInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      `
          : '';

      // Actions for stuck/in-progress onboarding
      const sessionActions =
        code.onboardingStatus && code.onboardingStatus.exists
          ? `
        <button class="btn btn-small btn-warning" onclick="window.cleanupSession('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Clean Session
        </button>
        <button class="btn btn-small btn-danger" onclick="window.deleteAll('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          Delete All
        </button>
      `
          : '';

      const actions = unusedActions + sessionActions;

      return `
      <div class="list-item">
        <div class="list-item-content">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 16px;">
            <code class="code-inline">${code.code}</code>
            ${statusBadge}
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
            <div><strong style="color: var(--text-primary);">Created by:</strong> ${escapeHtml(
              code.createdBy.username
            )} (User ID: ${code.createdBy.userId})</div>
            <div><strong style="color: var(--text-primary);">Created:</strong> ${createdAt.toLocaleString()}</div>
            <div><strong style="color: var(--text-primary);">Expires:</strong> ${expiresAt.toLocaleString()}</div>
            ${
              code.note
                ? `<div><strong style="color: var(--text-primary);">Note:</strong> ${escapeHtml(
                    code.note
                  )}</div>`
                : ''
            }
          </div>
          ${usageInfo}
        </div>
        ${actions ? `<div class="list-item-actions">${actions}</div>` : ''}
      </div>
    `;
    })
    .join('');

  container.innerHTML = html;
}

/**
 * Copy invite code to clipboard
 */
export function copyInviteCode(code) {
  const command = `/onboard ${code}`;
  navigator.clipboard
    .writeText(command)
    .then(() => {
      alert(
        `✅ Copied to clipboard:\n${command}\n\nShare this with the customer to start onboarding.`
      );
    })
    .catch((err) => {
      alert(`Code: ${code}\n\nCommand: ${command}`);
    });
}

/**
 * Revoke invite code
 */
export async function revokeInviteCode(code) {
  if (!confirm(`Revoke invite code ${code}?\n\nThis will prevent it from being used for onboarding.`)) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/invite-codes/${code}/revoke`, {
      method: 'POST',
      ...getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to revoke invite code');
    }

    alert(`✅ Invite code ${code} has been revoked`);
    loadInviteCodes(currentInviteStatus);
  } catch (error) {
    console.error('Error revoking invite code:', error);
    alert(`❌ Error: ${error.message}`);
  }
}

/**
 * Delete invite code
 */
export async function deleteInviteCode(code) {
  if (
    !confirm(
      `Are you sure you want to delete invite code ${code}?\n\nThis action cannot be undone.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/invite-codes/${code}`, {
      method: 'DELETE',
      ...getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to delete invite code');
    }

    alert(`✅ Invite code ${code} has been deleted`);
    loadInviteCodes(currentInviteStatus);
  } catch (error) {
    console.error('Error deleting invite code:', error);
    alert(`❌ Error: ${error.message}`);
  }
}

/**
 * Cleanup onboarding session
 */
export async function cleanupSession(code) {
  if (
    !confirm(
      `Clean onboarding session for ${code}?\n\nThis will delete the stuck session but keep the invite code for audit trail.\n\nThe user can start onboarding again.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/invite-codes/${code}/cleanup-session`, {
      method: 'POST',
      ...getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to cleanup session');
    }

    alert(`✅ Onboarding session cleaned for ${code}`);
    loadInviteCodes(currentInviteStatus);
  } catch (error) {
    console.error('Error cleaning session:', error);
    alert(`❌ Error: ${error.message}`);
  }
}

/**
 * Delete all (code + session)
 */
export async function deleteAll(code) {
  if (
    !confirm(
      `Delete BOTH invite code AND onboarding session for ${code}?\n\n⚠️ WARNING: This will:\n- Delete the invite code permanently\n- Delete the onboarding session\n- Remove all traces from the system\n\nThis action cannot be undone.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/invite-codes/${code}/delete-all`, {
      method: 'POST',
      ...getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to delete all');
    }

    alert(`✅ Invite code and session deleted for ${code}`);
    loadInviteCodes(currentInviteStatus);
  } catch (error) {
    console.error('Error deleting all:', error);
    alert(`❌ Error: ${error.message}`);
  }
}
