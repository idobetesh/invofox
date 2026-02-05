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
 * Load objects from a bucket
 */
export async function loadBucketObjects() {
  const bucketName = document.getElementById('bucket-select').value;
  if (!bucketName) {
    showError('Please select a bucket');
    return;
  }

  currentBucket = bucketName;
  storagePageToken = null;
  selectedStorageObjects.clear();
  updateStorageSelection();

  const prefix = document.getElementById('prefix-filter').value;

  showLoading();
  try {
    let url = `${API_BASE}/storage/buckets/${bucketName}/objects?maxResults=100`;
    if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`;
    if (storagePageToken) url += `&pageToken=${storagePageToken}`;

    const response = await fetch(url, getAuthHeaders());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.objects)) {
      throw new Error('Invalid response format: objects array not found');
    }

    displayStorageObjects(data.objects);
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

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th class="checkbox-cell"><input type="checkbox" id="select-all-storage"></th>
        <th>Name</th>
        <th>Size</th>
        <th>Type</th>
        <th>Created</th>
        <th class="action-cell">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  objects.forEach((obj) => {
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
        <button class="action-btn" onclick="window.viewStorageObject('${currentBucket}', '${obj.name}')">
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
 * View Storage object details
 */
export async function viewStorageObject(bucketName, objectPath) {
  showLoading();
  try {
    // Encode each path segment separately to preserve slashes
    const pathSegments = objectPath.split('/');
    const encodedSegments = pathSegments.map((segment) => encodeURIComponent(segment));
    const encodedPath = encodedSegments.join('/');
    const url = `${API_BASE}/storage/buckets/${bucketName}/objects/${encodedPath}`;

    const response = await fetch(url, getAuthHeaders());

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(
        errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data || !data.publicUrl) {
      throw new Error('Invalid response: missing publicUrl');
    }

    const detailsSection = document.getElementById('object-details-section');
    const detailsDiv = document.getElementById('object-details');

    // Escape the URL for use in HTML attributes
    const escapedUrl = data.publicUrl.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    let preview = '';
    if (data.contentType?.startsWith('image/')) {
      preview = `<div class="object-preview"><img src="${escapedUrl}" alt="Preview"></div>`;
    } else if (data.contentType === 'application/pdf') {
      preview = `<div class="object-preview"><iframe src="${escapedUrl}" width="100%" height="600px"></iframe></div>`;
    }

    detailsDiv.innerHTML = `
      <div style="margin-bottom: 20px; padding: 16px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Bucket:</strong> <code>${bucketName}</code></div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Size:</strong> ${formatBytes(
          data.size
        )}</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Type:</strong> ${
          data.contentType || 'Unknown'
        }</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Created:</strong> ${formatDate(
          data.timeCreated
        )}</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Updated:</strong> ${formatDate(
          data.updated
        )}</div>
        <div style="grid-column: 1 / -1;"><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Path:</strong> <code style="word-break: break-all;">${objectPath}</code></div>
      </div>
      ${preview}
      <div style="text-align: center; margin: 20px 0;">
        <button
          class="action-btn"
          onclick="window.open('${escapedUrl}', '_blank', 'noopener,noreferrer')"
          style="display: inline-flex; align-items: center; gap: 8px;"
        >
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          <span>Open in New Tab</span>
        </button>
        <a
          href="${escapedUrl}"
          target="_blank"
          rel="noopener noreferrer"
          class="object-link"
          style="margin-left: 12px; display: inline-flex; align-items: center; gap: 8px; color: #60a5fa; text-decoration: none;"
        >
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          <span>Direct Link</span>
        </a>
      </div>
      <div style="margin-top: 24px;">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #94a3b8;">Metadata</h3>
        <div class="json-viewer">${JSON.stringify(data.metadata || {}, null, 2)}</div>
      </div>
    `;

    detailsSection.style.display = 'block';
    detailsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      warning: 'This action cannot be undone!',
      confirmText: 'Delete Object',
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
    prevBtn.onclick = () => {
      storagePageToken = null;
      loadBucketObjects();
    };
    pagination.appendChild(prevBtn);

    if (hasMore) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.onclick = () => loadBucketObjects();
      pagination.appendChild(nextBtn);
    }
  }
}
