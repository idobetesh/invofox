/**
 * Shared invoice job amount update flow (Firestore + Google Sheet reminder)
 * API runs ONLY after user confirms in the modal.
 */

import { API_BASE, getAuthHeaders, showConfirmModal, escapeHtml } from './utils.js';

let customersCache = null;

function buildSheetUrlFromId(sheetId) {
  const encoded = encodeURIComponent(String(sheetId).trim());
  return `https://docs.google.com/spreadsheets/d/${encoded}/edit?gid=0#gid=0`;
}

function getDefaultSheetUrl() {
  return window.__ADMIN_CONFIG__?.defaultSheetUrl ?? null;
}

async function getSheetUrlForChat(chatId) {
  if (chatId !== undefined && chatId !== null && chatId !== '') {
    try {
      if (!customersCache) {
        const res = await fetch(`${API_BASE}/customers`, getAuthHeaders());
        if (res.ok) {
          const data = await res.json();
          customersCache = data.customers || [];
        }
      }

      const customer = customersCache?.find((c) => Number(c.chatId) === Number(chatId));
      if (customer?.sheetId) {
        return buildSheetUrlFromId(customer.sheetId);
      }
    } catch {
      // fall through to default
    }
  }

  return getDefaultSheetUrl();
}

function amountsEqual(previousAmount, newAmount) {
  if (previousAmount === null || previousAmount === undefined) {
    return false;
  }
  return Number(previousAmount) === Number(newAmount);
}

function formatMoney(amount, currency = 'ILS') {
  const value = Number(amount);
  const formatted = Number.isNaN(value)
    ? String(amount)
    : value.toLocaleString('en-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  if (currency === 'ILS') {
    return `₪${formatted}`;
  }
  if (currency === 'USD') {
    return `$${formatted}`;
  }
  if (currency === 'EUR') {
    return `€${formatted}`;
  }
  return `${formatted} ${currency}`;
}

function buildAmountChangeSummary(previousAmount, newAmount, currency = 'ILS') {
  return `${escapeHtml(formatMoney(previousAmount, currency))} → ${escapeHtml(formatMoney(newAmount, currency))}`;
}

function buildSheetLinkHtml(sheetUrl) {
  if (!sheetUrl) {
    return '<span data-sheet-link-placeholder style="color:var(--text-muted);font-size:0.875rem;">Loading Google Sheet link…</span>';
  }
  return `<a href="${escapeHtml(sheetUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;margin-top:4px;text-decoration:none;font-size:0.875rem;">
    Open Google Sheet ↗
  </a>`;
}

function formatAmountForInput(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return '';
  }
  const n = Number(amount);
  return Number.isNaN(n) ? String(amount) : String(n);
}

function resolveAmountInput(inputEl, inputLookup) {
  if (inputEl?.isConnected) {
    return inputEl;
  }
  if (!inputLookup) {
    return inputEl ?? null;
  }
  if (inputLookup.kind === 'firestore') {
    return document.querySelector(
      `.firestore-amount-input[data-doc-id="${CSS.escape(String(inputLookup.id))}"]`
    );
  }
  if (inputLookup.kind === 'invoice-job') {
    return document.querySelector(
      `.invoice-amount-input[data-job-id="${CSS.escape(String(inputLookup.id))}"]`
    );
  }
  if (inputLookup.kind === 'edit') {
    return document.getElementById('edit-amount');
  }
  return inputEl ?? null;
}

function revertAmountInput(inputEl, savedAmount, inputLookup) {
  const el = resolveAmountInput(inputEl, inputLookup);
  if (!el) {
    return;
  }
  const fromDataset = el.dataset.savedAmount;
  const amount =
    savedAmount !== null && savedAmount !== undefined
      ? savedAmount
      : fromDataset !== undefined
        ? fromDataset
        : '';
  el.value = formatAmountForInput(amount);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function showAmountConfirmModal({
  savedAmount,
  previousAmount,
  newAmount,
  currency,
  sheetUrl,
  chatId,
  sheetRowId,
  inputEl,
  inputLookup,
  onConfirm,
  onDismiss,
}) {
  const currentAmount = savedAmount ?? previousAmount;
  const rowHint =
    sheetRowId !== null && sheetRowId !== undefined && sheetRowId !== ''
      ? ` Update sheet row <strong>${escapeHtml(String(sheetRowId))}</strong> as well.`
      : ' Update the matching row in the sheet as well.';

  const changeSummary = buildAmountChangeSummary(currentAmount, newAmount, currency);

  showConfirmModal(
    'This will update Firestore only. You must also update Google Sheets manually.',
    onConfirm,
    {
      title: 'Confirm amount change',
      summary: changeSummary,
      details: buildSheetLinkHtml(sheetUrl ?? null),
      warning: `${rowHint} Firestore and the sheet are not synced automatically.`,
      confirmText: 'Confirm',
      confirmVariant: 'primary',
      onCancel: () => {
        revertAmountInput(inputEl, currentAmount, inputLookup);
        onDismiss?.();
      },
    }
  );

  if (!sheetUrl) {
    void getSheetUrlForChat(chatId).then((url) => {
      const modal = document.getElementById('confirm-modal');
      const messageEl = document.getElementById('confirm-message');
      if (!modal?.classList.contains('show') || !messageEl) {
        return;
      }
      const placeholder = messageEl.querySelector('[data-sheet-link-placeholder]');
      if (!placeholder) {
        return;
      }
      placeholder.outerHTML = url
        ? buildSheetLinkHtml(url)
        : '<span style="color:var(--text-muted);font-size:0.875rem;">Google Sheet link unavailable (set SHEET_ID in .env)</span>';
    });
  }
}

async function performAmountSave(jobId, amount, inputEl) {
  if (inputEl) {
    inputEl.disabled = true;
  }

  try {
    const res = await fetch(`${API_BASE}/invoice-jobs/${encodeURIComponent(jobId)}/correction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(getAuthHeaders().headers || {}) },
      body: JSON.stringify({ totalAmount: amount }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  } finally {
    if (inputEl) {
      inputEl.disabled = false;
    }
  }
}

/**
 * Show confirmation modal first; PUT runs only if user confirms.
 * No modal and no API when amount is unchanged.
 */
export async function promptAndSaveInvoiceJobAmount({
  jobId,
  newAmountRaw,
  previousAmount,
  chatId,
  sheetRowId,
  currency = 'ILS',
  inputEl,
  inputLookup,
  onSaved,
  showToast,
}) {
  const n = parseFloat(String(newAmountRaw).trim());
  if (Number.isNaN(n) || n <= 0) {
    showToast('Invalid amount', 'error');
    return false;
  }

  if (amountsEqual(previousAmount, n)) {
    return true;
  }

  const savedAmount = previousAmount;
  const lookup =
    inputLookup ??
    (inputEl?.dataset?.docId
      ? { kind: 'firestore', id: inputEl.dataset.docId }
      : inputEl?.dataset?.jobId
        ? { kind: 'invoice-job', id: inputEl.dataset.jobId }
        : { kind: 'invoice-job', id: jobId });

  showAmountConfirmModal({
    savedAmount,
    previousAmount: savedAmount,
    newAmount: n,
    currency,
    chatId,
    sheetRowId,
    inputEl,
    inputLookup: lookup,
    onConfirm: async () => {
      const liveInput = resolveAmountInput(inputEl, lookup);
      const finalAmount = liveInput ? parseFloat(String(liveInput.value).trim()) : n;
      if (amountsEqual(savedAmount, finalAmount)) {
        return;
      }
      try {
        await performAmountSave(jobId, finalAmount, liveInput ?? inputEl);
        if (liveInput) {
          liveInput.dataset.savedAmount = formatAmountForInput(finalAmount);
        }
        onSaved?.(finalAmount);
        showToast('Amount saved to Firestore', 'success');
      } catch (err) {
        showToast(`Save failed: ${err.message}`, 'error');
      }
    },
  });

  return false;
}

/**
 * Save from the full edit modal. Amount change uses the same blocking confirm modal.
 */
export async function promptAndSaveInvoiceJobCorrection({
  jobId,
  updates,
  previousAmount,
  chatId,
  sheetRowId,
  currency = 'ILS',
  inputEl,
  inputLookup,
  showToast,
  onSaved,
}) {
  const amountChanged =
    updates.totalAmount !== undefined && !amountsEqual(previousAmount, updates.totalAmount);

  const runSave = async () => {
    const res = await fetch(`${API_BASE}/invoice-jobs/${encodeURIComponent(jobId)}/correction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(getAuthHeaders().headers || {}) },
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  };

  if (!amountChanged) {
    try {
      await runSave();
      onSaved?.();
      showToast('Saved to Firestore', 'success');
      return true;
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
      return false;
    }
  }

  const sheetUrl = await getSheetUrlForChat(chatId);

  return new Promise((resolve) => {
    const lookup =
      inputLookup ??
      (inputEl?.id === 'edit-amount'
        ? { kind: 'edit' }
        : { kind: 'invoice-job', id: jobId });

    showAmountConfirmModal({
      savedAmount: previousAmount,
      previousAmount,
      newAmount: updates.totalAmount,
      currency,
      sheetUrl,
      sheetRowId,
      inputEl,
      inputLookup: lookup,
      onConfirm: async () => {
        try {
          await runSave();
          const liveInput = resolveAmountInput(inputEl, lookup);
          if (liveInput && updates.totalAmount !== undefined) {
            liveInput.dataset.savedAmount = formatAmountForInput(updates.totalAmount);
          }
          onSaved?.();
          showToast('Saved to Firestore', 'success');
          resolve(true);
        } catch (err) {
          showToast(`Save failed: ${err.message}`, 'error');
          resolve(false);
        }
      },
      onDismiss: () => resolve(false),
    });
  });
}
