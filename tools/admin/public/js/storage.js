/**
 * Cloud Storage Operations Module
 * Handles Cloud Storage bucket and object operations
 */

import {
  API_BASE,
  getAuthHeaders,
  showLoading,
  hideLoading,
  showError,
  showSuccess,
  showConfirmModal,
  formatDate,
  formatBytes,
} from './utils.js';

// State
export let currentBucket = null;
export let selectedStorageObjects = new Set();
export let storagePageToken = null;
let storageSortColumn = 'created'; // default sort
let storageSortDirection = 'desc'; // newest first
let currentStorageObjects = [];

/**
 * Load Cloud Storage buckets
 */
export async function loadBuckets() {
  try {
    const response = await fetch(`${API_BASE}/storage/buckets`, getAuthHeaders());
    const data = await response.json();

    const select = document.getElementById('bucket-select');
    select.innerHTML = '<option value="">Select a bucket...</option>';
    data.buckets.forEach((bucket) => {
      const option = document.createElement('option');
      option.value = bucket.name;
      option.textContent = `${bucket.name} (${bucket.location})`;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load buckets: ' + error.message);
  }
}

/**
 * Load objects from a bucket (newest by create date first).
 * @param {object} options
 * @param {boolean} options.reset - When true, reload from the first page
 */
export async function loadBucketObjects({ reset = true } = {}) {
  const bucketName = document.getElementById('bucket-select').value;
  if (!bucketName) {
    showError('Please select a bucket');
    return;
  }

  currentBucket = bucketName;

  if (reset) {
    storagePageToken = null;
    selectedStorageObjects.clear();
    updateStorageSelection();
    storageSortColumn = 'created';
    storageSortDirection = 'desc';
  }

  const prefix = document.getElementById('prefix-filter').value;

  showLoading();
  try {
    let url = `${API_BASE}/storage/buckets/${bucketName}/objects?maxResults=100`;
    if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`;
    if (storagePageToken) url += `&pageToken=${encodeURIComponent(storagePageToken)}`;

    const response = await fetch(url, getAuthHeaders());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.objects)) {
      throw new Error('Invalid response format: objects array not found');
    }

    currentStorageObjects = data.objects;
    displayStorageObjects(currentStorageObjects);
    storagePageToken = data.nextPageToken || null;
    updateStoragePagination(data.hasMore || false);

    document.getElementById('refresh-bucket-btn').style.display = 'inline-block';
  } catch (error) {
    showError('Failed to load objects: ' + error.message);
    console.error('Error loading objects:', error);
  } finally {
    hideLoading();
  }
}

/**
 * Sort storage objects by current sort state
 */
function sortStorageObjects(objects) {
  return [...objects].sort((a, b) => {
    let aVal, bVal;
    if (storageSortColumn === 'name') {
      aVal = a.name.toLowerCase();
      bVal = b.name.toLowerCase();
    } else {
      aVal = new Date(a.timeCreated).getTime();
      bVal = new Date(b.timeCreated).getTime();
    }
    if (aVal < bVal) return storageSortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return storageSortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Display Storage objects in table
 */
export function displayStorageObjects(objects) {
  const container = document.getElementById('objects-container');

  if (objects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>
        <p>No objects found</p>
      </div>
    `;
    return;
  }

  const sorted = sortStorageObjects(objects);

  const sortIndicator = (col) => {
    if (storageSortColumn !== col) return ' <span style="color:#475569;font-size:11px;">⇅</span>';
    return storageSortDirection === 'asc'
      ? ' <span style="color:#818cf8;font-size:11px;">↑</span>'
      : ' <span style="color:#818cf8;font-size:11px;">↓</span>';
  };

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th class="checkbox-cell"><input type="checkbox" id="select-all-storage"></th>
        <th id="sort-name" style="${thStyle}">Name${sortIndicator('name')}</th>
        <th>Size</th>
        <th>Type</th>
        <th id="sort-created" style="${thStyle}">Created${sortIndicator('created')}</th>
        <th class="action-cell">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  sorted.forEach((obj) => {
    const row = document.createElement('tr');
    const size = formatBytes(obj.size);
    const created = formatDate(obj.timeCreated);

    row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="obj-checkbox" data-path="${obj.name}">
      </td>
      <td><code>${obj.name}</code></td>
      <td>${size}</td>
      <td>${obj.contentType || '-'}</td>
      <td>${created}</td>
      <td class="action-cell">
        <button class="action-btn" onclick="window.viewStorageObject('${currentBucket}', '${obj.name}', this)">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="window.deleteStorageObject('${currentBucket}', '${obj.name}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          <span>Delete</span>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(table);

  // Sort header clicks
  table.querySelector('#sort-name').addEventListener('click', () => {
    if (storageSortColumn === 'name') {
      storageSortDirection = storageSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      storageSortColumn = 'name';
      storageSortDirection = 'asc';
    }
    displayStorageObjects(currentStorageObjects);
  });

  table.querySelector('#sort-created').addEventListener('click', () => {
    if (storageSortColumn === 'created') {
      storageSortDirection = storageSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      storageSortColumn = 'created';
      storageSortDirection = 'desc';
    }
    displayStorageObjects(currentStorageObjects);
  });

  // Select all checkbox
  document.getElementById('select-all-storage').addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.obj-checkbox');
    checkboxes.forEach((cb) => {
      cb.checked = e.target.checked;
      if (e.target.checked) {
        selectedStorageObjects.add(cb.dataset.path);
      } else {
        selectedStorageObjects.delete(cb.dataset.path);
      }
    });
    updateStorageSelection();
  });

  // Individual checkboxes
  document.querySelectorAll('.obj-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedStorageObjects.add(e.target.dataset.path);
      } else {
        selectedStorageObjects.delete(e.target.dataset.path);
      }
      updateStorageSelection();
    });
  });
}

/**
 * View Storage object details — expands inline below the row
 */
export async function viewStorageObject(bucketName, objectPath, triggerBtn) {
  const clickedRow = triggerBtn ? triggerBtn.closest('tr') : null;
  const existingExpand = document.getElementById('storage-expand-row');

  // Toggle off if clicking the same row again
  if (existingExpand) {
    const isSame = existingExpand.dataset.objPath === objectPath;
    existingExpand.remove();
    if (isSame) return;
  }

  showLoading();
  try {
    const pathSegments = objectPath.split('/');
    const encodedPath = pathSegments.map((s) => encodeURIComponent(s)).join('/');
    const url = `${API_BASE}/storage/buckets/${bucketName}/objects/${encodedPath}`;

    const response = await fetch(url, getAuthHeaders());
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !data.publicUrl) throw new Error('Invalid response: missing publicUrl');

    const escapedUrl = data.publicUrl.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    let preview = '';
    if (data.contentType?.startsWith('image/')) {
      preview = `<div class="object-preview"><img src="${escapedUrl}" alt="Preview"></div>`;
    } else if (data.contentType === 'application/pdf') {
      preview = `<div class="object-preview"><iframe src="${escapedUrl}" width="100%" height="500px"></iframe></div>`;
    }

    const expandRow = document.createElement('tr');
    expandRow.id = 'storage-expand-row';
    expandRow.dataset.objPath = objectPath;
    expandRow.style.cssText = 'background:#0f172a;';

    const expandCell = document.createElement('td');
    expandCell.colSpan = 6;
    expandCell.style.cssText = 'padding:16px;border-top:1px solid #1e293b;';

    expandCell.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;flex:1;margin-right:16px;">
          <div><span style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">Path</span><code style="word-break:break-all;font-size:12px;">${objectPath}</code></div>
          <div><span style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">Size</span>${formatBytes(data.size)}</div>
          <div><span style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">Type</span>${data.contentType || 'Unknown'}</div>
          <div><span style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">Created</span>${formatDate(data.timeCreated)}</div>
          <div><span style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">Updated</span>${formatDate(data.updated)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0;">
          <button class="action-btn" onclick="window.open('${escapedUrl}','_blank','noopener,noreferrer')">
            <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span>Open</span>
          </button>
          <button id="close-storage-expand-btn" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
        </div>
      </div>
      ${preview}
      ${Object.keys(data.metadata || {}).length ? `
        <div style="margin-top:16px;">
          <h3 style="font-size:13px;font-weight:600;margin-bottom:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Metadata</h3>
          <div class="json-viewer" style="font-size:12px;">${JSON.stringify(data.metadata, null, 2)}</div>
        </div>` : ''}
    `;

    expandRow.appendChild(expandCell);

    if (clickedRow) {
      clickedRow.after(expandRow);
    } else {
      document.querySelector('#objects-container tbody')?.appendChild(expandRow);
    }

    document.getElementById('close-storage-expand-btn').addEventListener('click', () => expandRow.remove());
  } catch (error) {
    showError('Failed to load object: ' + error.message);
    console.error('Error loading object:', error);
  } finally {
    hideLoading();
  }
}

/**
 * Delete a Storage object
 */
export function deleteStorageObject(bucketName, objectPath) {
  showConfirmModal(
    `object from bucket "${bucketName}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/storage/buckets/${bucketName}/objects/${objectPath}`,
          {
            method: 'DELETE',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }

        showSuccess('Object deleted successfully');
        loadBucketObjects();
      } catch (error) {
        showError('Failed to delete object: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: 1,
      details: `Object: <code>${objectPath}</code><br>Bucket: <code>${bucketName}</code>`,
      warning: 'This action cannot be undone! To fully remove this expense, also delete the matching document from the <strong>invoice_jobs</strong> Firestore collection and remove the row from the <strong>Google Sheet</strong>.',
      confirmText: 'Delete Object',
      requireTyping: 'delete',
    }
  );
}

/**
 * Delete selected Storage objects
 */
export function deleteSelectedStorage() {
  if (selectedStorageObjects.size === 0) {
    showError('No objects selected');
    return;
  }

  const count = selectedStorageObjects.size;
  showConfirmModal(
    `object(s) from bucket "${currentBucket}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/storage/buckets/${currentBucket}/delete-multiple`,
          {
            method: 'POST',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              objectPaths: Array.from(selectedStorageObjects),
              confirm: true,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }

        showSuccess(`${count} object(s) deleted successfully`);
        selectedStorageObjects.clear();
        updateStorageSelection();
        loadBucketObjects();
      } catch (error) {
        showError('Failed to delete objects: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: count,
      details: `Bucket: <code>${currentBucket}</code>`,
      warning: 'This action cannot be undone! All selected objects will be permanently deleted.',
      confirmText: `Delete ${count} Object${count > 1 ? 's' : ''}`,
    }
  );
}

/**
 * Update selection UI
 */
export function updateStorageSelection() {
  const count = selectedStorageObjects.size;
  const bulkActions = document.getElementById('bulk-actions-storage');
  const countSpan = document.getElementById('selected-count-storage');

  if (count > 0) {
    bulkActions.style.display = 'flex';
    countSpan.textContent = `${count} selected`;
  } else {
    bulkActions.style.display = 'none';
  }
}

/**
 * Clear selection
 */
export function clearStorageSelection() {
  selectedStorageObjects.clear();
  document.querySelectorAll('.obj-checkbox').forEach((cb) => (cb.checked = false));
  document.getElementById('select-all-storage').checked = false;
  updateStorageSelection();
}

/**
 * Update pagination
 */
export function updateStoragePagination(hasMore) {
  const pagination = document.getElementById('pagination-storage');
  pagination.innerHTML = '';

  if (storagePageToken || hasMore) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = !storagePageToken;
    prevBtn.onclick = () => loadBucketObjects({ reset: true });
    pagination.appendChild(prevBtn);

    if (hasMore) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.onclick = () => loadBucketObjects({ reset: false });
      pagination.appendChild(nextBtn);
    }
  }
}
