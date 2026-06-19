/**
 * System Alerts panel — cached in localStorage, refresh on demand only.
 */

import { API_BASE, getAuthHeaders, escapeHtml } from './utils.js';

const CACHE_KEY = 'invofox-alerts-cache';
const SEEN_KEY = 'invofox-alerts-seen';

function severityColor(severity) {
  if (severity === 'critical') return 'var(--danger)';
  if (severity === 'warning') return 'var(--warning)';
  return 'var(--muted)';
}

function severityIcon(severity) {
  if (severity === 'critical') {
    return '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }
  if (severity === 'warning') {
    return '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
  }
  return '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function humanizeErrorCode(code) {
  const map = {
    model_not_found: 'Model not found (deprecated or wrong GEMINI_MODEL)',
    rate_limit: 'Rate limit / quota',
    auth: 'API key / auth failure',
    json_parse: 'Invalid JSON from Gemini',
    empty_response: 'Empty Gemini response',
    health_endpoint_legacy: 'Old worker — redeploy for Gemini monitoring',
  };
  return map[code] || code || 'unknown';
}

function geminiStatusLabel(gemini) {
  if (!gemini) return 'No data';
  if (gemini.status === 'ok') return `Healthy — ${gemini.model || 'unknown model'}`;
  if (gemini.status === 'unconfigured') return 'Not configured (no GEMINI_API_KEY)';
  if (gemini.status === 'unknown') return 'Not reporting (old worker deploy)';
  const err = humanizeErrorCode(gemini.errorCode);
  return `Unavailable — ${err}`;
}

/** Stable fingerprint for "have I seen these alerts?" */
function computeAlertSignature(data) {
  if (!data) return '';
  const actionable = (data.alerts || []).filter((a) => a.severity !== 'info');
  const parts = actionable.map((a) => `${a.id}:${a.severity}:${a.timestamp || ''}`);
  return `${data.summary?.alertCount || 0}|${parts.join(';')}`;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        data,
        fetchedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.warn('Failed to cache alerts:', err);
  }
}

function readSeenSignature() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw).signature ?? null;
  } catch {
    return null;
  }
}

function markAlertsSeen(data) {
  try {
    localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({
        signature: computeAlertSignature(data),
        seenAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.warn('Failed to save alerts seen state:', err);
  }
}

function getUnseenCount(data) {
  if (!data?.summary) return 0;
  const signature = computeAlertSignature(data);
  if (!signature || signature === readSeenSignature()) {
    return 0;
  }
  return data.summary.alertCount || 0;
}

function setTabBadge(count) {
  const btn = document.querySelector('.tab-button[data-tab="alerts"]');
  if (!btn) return;

  let badge = btn.querySelector('.tab-alert-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-alert-badge';
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
    badge.style.display = 'inline-flex';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

function syncBadgeFromCache() {
  const cached = readCache();
  setTabBadge(cached ? getUnseenCount(cached.data) : 0);
}

function isAlertsTabActive() {
  return document.getElementById('alerts-tab')?.classList.contains('active');
}

function renderStatsRow(stats) {
  if (!stats) return '';
  return `
    <div class="alerts-stats-row">
      <div class="alerts-stat-card">
        <span class="alerts-stat-value">${stats.openaiCount}</span>
        <span class="alerts-stat-label">OpenAI (recent)</span>
      </div>
      <div class="alerts-stat-card">
        <span class="alerts-stat-value">${stats.geminiCount}</span>
        <span class="alerts-stat-label">Gemini (recent)</span>
      </div>
      <div class="alerts-stat-card">
        <span class="alerts-stat-value">${stats.openAiStreak}</span>
        <span class="alerts-stat-label">OpenAI streak</span>
      </div>
      <div class="alerts-stat-card">
        <span class="alerts-stat-value">${stats.processedCount}</span>
        <span class="alerts-stat-label">Jobs scanned</span>
      </div>
    </div>`;
}

function renderGeminiStatus(data) {
  const { gemini, workerConfigured, workerReachable, workerVersion, diagnostics } = data;

  if (!workerConfigured) {
    return `
      <div class="alert-gemini-card alert-gemini-unknown">
        <span class="alert-gemini-label">Production worker</span>
        <span class="alert-gemini-value">Not monitored — set WORKER_URL in .env</span>
      </div>`;
  }

  const cls = !workerReachable
    ? 'alert-gemini-bad'
    : gemini?.status === 'ok'
      ? 'alert-gemini-ok'
      : gemini?.status === 'unconfigured'
        ? 'alert-gemini-warn'
        : 'alert-gemini-bad';

  const details = [];
  if (diagnostics?.workerUrl) {
    details.push(`<div><strong>Worker URL:</strong> <code>${escapeHtml(diagnostics.workerUrl)}</code></div>`);
  }
  details.push(`<div><strong>Reachable:</strong> ${workerReachable ? 'Yes' : 'No'}</div>`);
  if (workerVersion) {
    details.push(`<div><strong>Worker version:</strong> <code>${escapeHtml(workerVersion)}</code></div>`);
  }
  if (gemini) {
    details.push(`<div><strong>Status:</strong> ${escapeHtml(geminiStatusLabel(gemini))}</div>`);
    if (gemini.model) details.push(`<div><strong>Model:</strong> <code>${escapeHtml(gemini.model)}</code></div>`);
    if (gemini.errorCode) details.push(`<div><strong>Issue:</strong> ${escapeHtml(humanizeErrorCode(gemini.errorCode))}</div>`);
    if (gemini.errorMessage) details.push(`<div class="alert-gemini-error-detail">${escapeHtml(gemini.errorMessage)}</div>`);
    if (gemini.checkedAt) details.push(`<div><strong>Last checked:</strong> ${formatWhen(gemini.checkedAt)}</div>`);
  }

  return `
    <div class="alert-gemini-card ${cls}">
      <div class="alert-gemini-header">
        <span class="alert-gemini-label">Gemini (production worker)</span>
        <span class="alert-gemini-value">${escapeHtml(gemini ? geminiStatusLabel(gemini) : workerReachable ? 'No Gemini data' : 'Unreachable')}</span>
      </div>
      <div class="alert-gemini-details">${details.join('')}</div>
    </div>`;
}

function renderRecommendedActions(actions) {
  if (!actions?.length) return '';
  return `
    <div class="alerts-actions-box">
      <h3 class="alerts-section-title">What to do</h3>
      <ul class="alerts-actions-list">
        ${actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
      </ul>
    </div>`;
}

function renderAlertsList(alerts) {
  const actionable = (alerts || []).filter((a) => a.severity !== 'info');
  const info = (alerts || []).filter((a) => a.severity === 'info');

  let html = '';
  if (!actionable.length) {
    html += `
      <div class="empty-state alert-all-clear">
        <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px;color:var(--success)">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <p><strong>All clear</strong> — no critical or warning alerts.</p>
      </div>`;
  } else {
    html += `
      <div class="alerts-list">
        ${actionable
          .map(
            (a) => `
          <div class="alert-item alert-severity-${a.severity}">
            <div class="alert-item-icon" style="color:${severityColor(a.severity)}">${severityIcon(a.severity)}</div>
            <div class="alert-item-body">
              <div class="alert-item-title">${escapeHtml(a.title)}</div>
              <div class="alert-item-message">${escapeHtml(a.message)}</div>
              ${a.timestamp ? `<div class="alert-item-time">${formatWhen(a.timestamp)}</div>` : ''}
            </div>
          </div>`
          )
          .join('')}
      </div>`;
  }

  if (info.length) {
    html += `
      <h4 class="alerts-subsection-title">Notes</h4>
      <div class="alerts-list">
        ${info
          .map(
            (a) => `
          <div class="alert-item alert-severity-info">
            <div class="alert-item-body">
              <div class="alert-item-title">${escapeHtml(a.title)}</div>
              <div class="alert-item-message">${escapeHtml(a.message)}</div>
            </div>
          </div>`
          )
          .join('')}
      </div>`;
  }

  return html;
}

function providerBadge(provider, fallbackFrom) {
  const p = provider || 'unknown';
  const color =
    p === 'gemini' ? 'var(--success)' : p === 'openai' ? 'var(--warning)' : 'var(--muted)';
  const suffix = fallbackFrom === 'gemini' ? ' (fallback)' : '';
  return `<span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:${color}20;color:${color};">${escapeHtml(p + suffix)}</span>`;
}

function renderRecentLlmJobs(jobs, stats) {
  if (!jobs?.length) {
    return '<p class="form-hint" style="margin:0">No processed invoice jobs with LLM metadata in Firestore yet.</p>';
  }

  const hint =
    stats?.lastOpenAiAt && !stats?.lastGeminiAt
      ? `<p class="form-hint">Last OpenAI job: ${formatWhen(stats.lastOpenAiAt)}. No Gemini jobs in the last ${stats.scannedJobs} scanned jobs.</p>`
      : stats?.lastGeminiAt
        ? `<p class="form-hint">Last Gemini: ${formatWhen(stats.lastGeminiAt)} · Last OpenAI: ${formatWhen(stats.lastOpenAiAt) || '—'}</p>`
        : '';

  return `
    ${hint}
    <table class="data-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Vendor</th>
          <th>Chat</th>
          <th>LLM</th>
          <th>Fallback reason</th>
        </tr>
      </thead>
      <tbody>
        ${jobs
          .map(
            (j) => `
          <tr>
            <td>${formatWhen(j.createdAt)}</td>
            <td>${escapeHtml(j.vendorName || '?')}</td>
            <td>${escapeHtml(j.chatTitle || j.jobId)}</td>
            <td>${providerBadge(j.llmProvider, j.llmFallbackFrom)}</td>
            <td class="alert-reason-cell" title="${escapeHtml(j.llmFallbackReason || '')}">${escapeHtml(j.llmFallbackReason ? j.llmFallbackReason.slice(0, 100) + (j.llmFallbackReason.length > 100 ? '…' : '') : '—')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderFallbacksTable(fallbacks) {
  if (!fallbacks.length) {
    return `<p class="form-hint" style="margin:0">No explicit fallback records yet. Jobs processed before the latest worker deploy won't have <code>llmFallbackReason</code> — check the table above for OpenAI usage.</p>`;
  }

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Vendor</th>
          <th>Chat</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${fallbacks
          .map(
            (f) => `
          <tr>
            <td>${formatWhen(f.createdAt || f.receivedAt)}</td>
            <td>${escapeHtml(f.vendorName || '?')}</td>
            <td>${escapeHtml(f.chatTitle || String(f.jobId))}</td>
            <td class="alert-reason-cell">${escapeHtml(f.fallbackReason || 'Gemini failed → OpenAI')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderAlertsData(data, { fetchedAt, fromCache = false } = {}) {
  const cacheNote = fetchedAt
    ? `<p class="alerts-cache-note">${fromCache ? 'Showing cached data' : 'Fetched'} · ${formatWhen(fetchedAt)} · click <strong>Refresh</strong> to update</p>`
    : '';

  return `
    ${cacheNote}
    ${renderGeminiStatus(data)}
    ${renderStatsRow(data.llmStats)}
    ${renderRecommendedActions(data.diagnostics?.recommendedActions)}
    <h3 class="alerts-section-title">Active alerts</h3>
    ${renderAlertsList(data.alerts || [])}
    <h3 class="alerts-section-title" style="margin-top:1.5rem">Recent invoice LLM usage</h3>
    ${renderRecentLlmJobs(data.recentLlmJobs || [], data.llmStats)}
    <h3 class="alerts-section-title" style="margin-top:1.5rem">Recorded Gemini fallbacks</h3>
    ${renderFallbacksTable(data.recentFallbacks || [])}
  `;
}

function renderEmptyPrompt() {
  return `
    <div class="empty-state">
      <p>No cached alerts yet.</p>
      <p class="form-hint">Click <strong>Refresh</strong> to fetch live data from production (Firestore + worker).</p>
    </div>`;
}

function displayCachedAlerts({ markSeen = false } = {}) {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  const cached = readCache();
  if (!cached) {
    container.innerHTML = renderEmptyPrompt();
    setTabBadge(0);
    return;
  }

  container.innerHTML = renderAlertsData(cached.data, {
    fetchedAt: cached.fetchedAt,
    fromCache: true,
  });

  if (markSeen) {
    markAlertsSeen(cached.data);
    setTabBadge(0);
  } else {
    setTabBadge(getUnseenCount(cached.data));
  }
}

/** Fetch from API, cache locally, update badge if user hasn't seen yet */
export async function refreshAlerts() {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  const refreshBtn = document.getElementById('refresh-alerts-btn');
  if (refreshBtn) refreshBtn.disabled = true;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner-small"></div>
      <p>Refreshing alerts...</p>
    </div>`;

  try {
    const res = await fetch(`${API_BASE}/alerts`, getAuthHeaders());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const fetchedAt = new Date().toISOString();
    writeCache(data);

    container.innerHTML = renderAlertsData(data, { fetchedAt, fromCache: false });

    if (isAlertsTabActive()) {
      markAlertsSeen(data);
      setTabBadge(0);
    } else {
      setTabBadge(getUnseenCount(data));
    }
  } catch (err) {
    const cached = readCache();
    if (cached) {
      container.innerHTML = `
        <div class="empty-state" style="color:var(--danger);margin-bottom:1rem">
          Refresh failed: ${escapeHtml(err.message)}
        </div>
        ${renderAlertsData(cached.data, { fetchedAt: cached.fetchedAt, fromCache: true })}`;
    } else {
      container.innerHTML = `
        <div class="empty-state" style="color:var(--danger)">
          Failed to load alerts: ${escapeHtml(err.message)}
        </div>`;
    }
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

export function setupAlertsTab() {
  const refreshBtn = document.getElementById('refresh-alerts-btn');
  const alertsTabBtn = document.querySelector('.tab-button[data-tab="alerts"]');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshAlerts);
  }

  if (alertsTabBtn) {
    alertsTabBtn.addEventListener('click', () => {
      displayCachedAlerts({ markSeen: true });
    });
  }

  syncBadgeFromCache();

  if (isAlertsTabActive()) {
    displayCachedAlerts({ markSeen: true });
  }
}
