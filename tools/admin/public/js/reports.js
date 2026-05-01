/**
 * Reports Module
 * Generate and download reports against real Firestore + Cloud Storage data.
 *
 * The Type and Format button groups are MULTI-SELECT (any group with
 * `data-multi-select="true"` toggles each button independently). The backend
 * generates the cartesian product of (types × formats); a single combination
 * downloads as the native file (PDF/Excel/CSV), more than one downloads as a
 * .zip with all of them.
 */

import {
  API_BASE,
  getAuthHeaders,
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  escapeHtml,
} from './utils.js';

const STATE = {
  reportTypes: new Set(['revenue']),
  formats: new Set(['pdf']),
  dateMode: 'preset',
  sortOrder: 'asc',
};

/**
 * Initialize the Reports tab: load customers, wire up event listeners.
 */
export function setupReportsTab() {
  loadReportCustomers();
  wireMultiSelectGroup('report-type-group', 'reportType', STATE.reportTypes);
  wireMultiSelectGroup('report-format-group', 'reportFormat', STATE.formats);
  wireDateModeSwitch();
  wireSingleSelectGroup('report-sort-order-group', 'sortOrder', (value) => {
    STATE.sortOrder = value;
  });
  wireGenerateButton();
}

async function loadReportCustomers() {
  const select = document.getElementById('report-customer-select');
  if (!select) return;

  try {
    const response = await fetch(`${API_BASE}/customers`, getAuthHeaders());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const customers = Array.isArray(data.customers) ? data.customers : [];

    if (customers.length === 0) {
      select.innerHTML = '<option value="">No customers found</option>';
      return;
    }

    customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const options = ['<option value="">Select a customer...</option>']
      .concat(
        customers.map(
          (c) =>
            `<option value="${c.chatId}">${escapeHtml(c.name || 'Unknown')} (${c.chatId})</option>`
        )
      )
      .join('');

    select.innerHTML = options;
  } catch (error) {
    console.error('Failed to load customers for reports:', error);
    select.innerHTML = '<option value="">Failed to load customers</option>';
  }
}

/**
 * Wire a toggle group as single-select (mutually-exclusive). Calls `onChange`
 * with the new value whenever the user picks a different button.
 */
function wireSingleSelectGroup(groupId, datasetKey, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;

  group.querySelectorAll('.filter-button').forEach((btn) => {
    const value = btn.dataset[datasetKey];
    if (!value) return;

    btn.addEventListener('click', () => {
      group.querySelectorAll('.filter-button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(value);
    });
  });
}

/**
 * Wire a toggle group as multi-select: clicking a button flips its `.active`
 * class and adds/removes its dataset value from `selectionSet`. We refuse to
 * deselect the last remaining button so the form is never in an invalid state.
 */
function wireMultiSelectGroup(groupId, datasetKey, selectionSet) {
  const group = document.getElementById(groupId);
  if (!group) return;

  group.querySelectorAll('.filter-button').forEach((btn) => {
    const value = btn.dataset[datasetKey];
    if (!value) return;

    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) {
        if (selectionSet.size <= 1) {
          // Last one — keep it on so the user always has at least one selection.
          return;
        }
        btn.classList.remove('active');
        selectionSet.delete(value);
      } else {
        btn.classList.add('active');
        selectionSet.add(value);
      }
    });
  });
}

function wireDateModeSwitch() {
  const modeGroup = document.getElementById('report-date-mode-group');
  const presetGroup = document.getElementById('report-preset-group');
  const customGroup = document.getElementById('report-custom-group');
  if (!modeGroup || !presetGroup || !customGroup) return;

  modeGroup.querySelectorAll('.filter-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      modeGroup
        .querySelectorAll('.filter-button')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.dateMode = btn.dataset.dateMode;

      if (STATE.dateMode === 'preset') {
        presetGroup.style.display = '';
        customGroup.style.display = 'none';
      } else {
        presetGroup.style.display = 'none';
        customGroup.style.display = '';
      }
    });
  });
}

function wireGenerateButton() {
  const btn = document.getElementById('generate-report-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const status = document.getElementById('report-status');
    if (status) {
      status.style.display = 'none';
    }

    const payload = collectPayload();
    if (!payload) return;

    try {
      btn.disabled = true;
      showLoading();

      const auth = getAuthHeaders();
      const response = await fetch(`${API_BASE}/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth.headers || {}) },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          /* response wasn't JSON, keep status code */
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = extractFilename(response.headers.get('Content-Disposition'), payload);
      triggerDownload(blob, filename);

      const fileCount = payload.reportTypes.length * payload.formats.length;
      const summary =
        fileCount > 1
          ? `Downloaded ${fileCount} reports as ${filename}`
          : `Downloaded ${filename}`;
      showSuccess(summary);
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `<p>Generated <code>${escapeHtml(filename)}</code> (${formatKb(blob.size)}${fileCount > 1 ? `, ${fileCount} files` : ''})</p>`;
      }
    } catch (error) {
      console.error('Failed to generate report:', error);
      showError(error instanceof Error ? error.message : 'Failed to generate report');
    } finally {
      btn.disabled = false;
      hideLoading();
    }
  });
}

function collectPayload() {
  const customerSelect = document.getElementById('report-customer-select');
  const chatIdRaw = customerSelect?.value;
  if (!chatIdRaw) {
    showError('Please select a customer');
    return null;
  }
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId) || !Number.isInteger(chatId)) {
    showError('Selected customer has an invalid chatId');
    return null;
  }

  if (STATE.reportTypes.size === 0) {
    showError('Select at least one report type');
    return null;
  }
  if (STATE.formats.size === 0) {
    showError('Select at least one format');
    return null;
  }

  const businessNameRaw = document.getElementById('report-business-name')?.value || '';
  const includeLogo = Boolean(document.getElementById('report-include-logo')?.checked);

  const payload = {
    chatId,
    reportTypes: Array.from(STATE.reportTypes),
    formats: Array.from(STATE.formats),
    includeLogo,
    sortOrder: STATE.sortOrder,
  };

  const trimmedName = businessNameRaw.trim();
  if (trimmedName) {
    payload.businessName = trimmedName;
  }

  if (STATE.dateMode === 'custom') {
    const start = document.getElementById('report-custom-start')?.value;
    const end = document.getElementById('report-custom-end')?.value;
    if (!start || !end) {
      showError('Please pick both start and end dates');
      return null;
    }
    if (start > end) {
      showError('Start date must be on or before end date');
      return null;
    }
    payload.customStart = start;
    payload.customEnd = end;
  } else {
    payload.datePreset = document.getElementById('report-preset-select')?.value || 'this_month';
  }

  return payload;
}

function extractFilename(headerValue, payload) {
  if (headerValue) {
    const match = headerValue.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) {
      return match[1];
    }
  }
  // Fallback: synthesize a name. Single combination → use the report's own
  // extension; multi → .zip.
  const fileCount = payload.reportTypes.length * payload.formats.length;
  const range =
    payload.customStart && payload.customEnd
      ? `${payload.customStart}_${payload.customEnd}`
      : payload.datePreset || 'report';
  if (fileCount === 1) {
    const fmt = payload.formats[0];
    const ext = fmt === 'excel' ? 'xlsx' : fmt;
    return `report_${payload.reportTypes[0]}_${range}.${ext}`;
  }
  return `reports_${payload.chatId}_${range}.zip`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke to next tick so the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatKb(bytes) {
  if (!bytes) return '0 KB';
  return `${Math.round(bytes / 1024)} KB`;
}
