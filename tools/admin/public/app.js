// API base URL
const API_BASE = '/api';
const ADMIN_PASSWORD = null; // Set if you configured ADMIN_PASSWORD env var

// Load status snapshot
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

    const overallStatus = (data.overall === 'healthy') ? 'healthy' : 'unhealthy';
    const overallIcon = overallStatus === 'healthy' 
      ? '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

    // Safely handle services array
    const services = data.services || [];
    const servicesHtml = services.map(service => {
      const serviceStatus = service.status === 'healthy' ? 'healthy' : 'unhealthy';
      const serviceIcon = serviceStatus === 'healthy'
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
    }).join('');

    // Storage statistics
    const storageStats = data.storage;
    const storageStatsHtml = storageStats ? `
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
    ` : '';

    snapshot.innerHTML = `
      <div class="status-content ${overallStatus}">
        <div class="status-header">
          <div class="overall-status">
            ${overallIcon}
            <div class="status-info">
              <span class="status-label">System Status</span>
              <span class="status-value">${overallStatus === 'healthy' ? 'All Systems Operational' : 'Issues Detected'}</span>
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
                <code class="version-sha" title="${data.version?.sha || 'unknown'}">${data.version?.shortSha || 'unknown'}</code>
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
          <span>Failed to load status: ${error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      </div>
    `;
  }
}

// State
let currentCollection = null;
let currentBucket = null;
let selectedFirestoreDocs = new Set();
let selectedStorageObjects = new Set();
let firestoreCursor = null;
let storagePageToken = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load status on initial page load/refresh (manual action by user)
  loadStatusSnapshot();

  setupTabs();
  loadCollections();
  loadBuckets();
  setupEventListeners();

  // Auto-refresh disabled to save GCP API costs
  // Only loads when user manually refreshes the page (F5/Cmd+R)
  // setInterval(loadStatusSnapshot, 30000);
});

// Tab switching
function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Update buttons
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`${tab}-tab`).classList.add('active');
    });
  });
}

// Load Firestore collections
async function loadCollections() {
  try {
    const response = await fetch(`${API_BASE}/firestore/collections`, getAuthHeaders());
    const data = await response.json();
    
    const select = document.getElementById('collection-select');
    select.innerHTML = '<option value="">Select a collection...</option>';
    data.collections.forEach(col => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load collections: ' + error.message);
  }
}

// Load Cloud Storage buckets
async function loadBuckets() {
  try {
    const response = await fetch(`${API_BASE}/storage/buckets`, getAuthHeaders());
    const data = await response.json();
    
    const select = document.getElementById('bucket-select');
    select.innerHTML = '<option value="">Select a bucket...</option>';
    data.buckets.forEach(bucket => {
      const option = document.createElement('option');
      option.value = bucket.name;
      option.textContent = `${bucket.name} (${bucket.location})`;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load buckets: ' + error.message);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Firestore
  document.getElementById('load-collection-btn').addEventListener('click', loadCollectionDocuments);
  document.getElementById('refresh-collection-btn').addEventListener('click', loadCollectionDocuments);
  document.getElementById('delete-selected-firestore').addEventListener('click', () => deleteSelectedFirestore());
  document.getElementById('clear-selection-firestore').addEventListener('click', clearFirestoreSelection);
  
  // Storage
  document.getElementById('load-bucket-btn').addEventListener('click', loadBucketObjects);
  document.getElementById('refresh-bucket-btn').addEventListener('click', loadBucketObjects);
  document.getElementById('delete-selected-storage').addEventListener('click', () => deleteSelectedStorage());
  document.getElementById('clear-selection-storage').addEventListener('click', clearStorageSelection);
  
  // Modal
  document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('show');
  });
}

// Load Firestore documents
async function loadCollectionDocuments() {
  const collectionName = document.getElementById('collection-select').value;
  if (!collectionName) {
    showError('Please select a collection');
    return;
  }
  
  currentCollection = collectionName;
  firestoreCursor = null;
  selectedFirestoreDocs.clear();
  updateFirestoreSelection();
  
  showLoading();
  try {
    const response = await fetch(
      `${API_BASE}/firestore/collections/${collectionName}?limit=50${firestoreCursor ? `&startAfter=${firestoreCursor}` : ''}`,
      getAuthHeaders()
    );
    const data = await response.json();
    
    displayFirestoreDocuments(data.documents);
    firestoreCursor = data.nextCursor;
    updateFirestorePagination(data.hasMore);
    
    document.getElementById('refresh-collection-btn').style.display = 'inline-block';
  } catch (error) {
    showError('Failed to load documents: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Display Firestore documents
function displayFirestoreDocuments(documents) {
  const container = document.getElementById('documents-container');
  
  if (documents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>No documents found</p>
      </div>
    `;
    return;
  }
  
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th class="checkbox-cell"><input type="checkbox" id="select-all-firestore"></th>
        <th>ID</th>
        <th>Status/Type</th>
        <th>Created</th>
        <th>Updated</th>
        <th class="action-cell">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  documents.forEach(doc => {
    const row = document.createElement('tr');
    const status = doc.data.status || doc.data.documentType || '-';
    const createdAt = formatDate(doc.data.createdAt);
    const updatedAt = formatDate(doc.data.updatedAt);
    
    row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="doc-checkbox" data-id="${doc.id}">
      </td>
      <td><code>${doc.id}</code></td>
      <td>${status}</td>
      <td>${createdAt}</td>
      <td>${updatedAt}</td>
      <td class="action-cell">
        <button class="action-btn" onclick="viewFirestoreDocument('${currentCollection}', '${doc.id}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="deleteFirestoreDocument('${currentCollection}', '${doc.id}')">
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
  document.getElementById('select-all-firestore').addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.doc-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) {
        selectedFirestoreDocs.add(cb.dataset.id);
      } else {
        selectedFirestoreDocs.delete(cb.dataset.id);
      }
    });
    updateFirestoreSelection();
  });
  
  // Individual checkboxes
  document.querySelectorAll('.doc-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedFirestoreDocs.add(e.target.dataset.id);
      } else {
        selectedFirestoreDocs.delete(e.target.dataset.id);
      }
      updateFirestoreSelection();
    });
  });
}

// View Firestore document
let currentEditingDocument = null;
let originalDocumentData = null;

async function viewFirestoreDocument(collectionName, documentId) {
  showLoading();
  try {
    const response = await fetch(
      `${API_BASE}/firestore/collections/${collectionName}/${documentId}`,
      getAuthHeaders()
    );
    const data = await response.json();
    
    currentEditingDocument = { collectionName, documentId };
    originalDocumentData = JSON.stringify(data.data, null, 2);
    
    const detailsSection = document.getElementById('document-details-section');
    const detailsDiv = document.getElementById('document-details');
    
    detailsDiv.innerHTML = `
      <div style="margin-bottom: 20px; padding: 16px; background: #0f172a; border-radius: 8px; border: 1px solid #334155;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <p style="margin-bottom: 8px;"><strong style="color: #94a3b8; display: inline-block; min-width: 120px;">Collection:</strong> <code>${collectionName}</code></p>
            <p><strong style="color: #94a3b8; display: inline-block; min-width: 120px;">Document ID:</strong> <code>${documentId}</code></p>
          </div>
          <button id="edit-document-btn" class="btn btn-primary">
            <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Edit</span>
          </button>
        </div>
      </div>
      <div id="json-viewer-container">
        <div class="json-viewer" id="json-viewer">${originalDocumentData}</div>
      </div>
      <div id="json-editor-container" style="display: none;">
        <div style="margin-bottom: 12px; display: flex; gap: 8px; justify-content: flex-end;">
          <button id="cancel-edit-btn" class="btn btn-ghost">Cancel</button>
          <button id="save-document-btn" class="btn btn-primary">
            <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>Save Changes</span>
          </button>
        </div>
        <textarea id="json-editor" class="json-editor" spellcheck="false">${originalDocumentData}</textarea>
        <div id="json-error" class="json-error" style="display: none;"></div>
      </div>
    `;
    
    // Setup edit button
    document.getElementById('edit-document-btn').addEventListener('click', () => {
      enableDocumentEditing();
    });
    
    detailsSection.style.display = 'block';
    detailsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showError('Failed to load document: ' + error.message);
  } finally {
    hideLoading();
  }
}

function enableDocumentEditing() {
  document.getElementById('json-viewer-container').style.display = 'none';
  document.getElementById('json-editor-container').style.display = 'block';
  document.getElementById('edit-document-btn').style.display = 'none';
  
  const editor = document.getElementById('json-editor');
  editor.focus();
  
  // Setup cancel button
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    cancelDocumentEditing();
  });
  
  // Setup save button
  document.getElementById('save-document-btn').addEventListener('click', () => {
    saveDocumentChanges();
  });
  
  // Validate JSON on input
  editor.addEventListener('input', validateJson);
  
  // Enable tab key for indentation
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      
      if (e.shiftKey) {
        // Shift+Tab: Remove indentation
        const lines = value.substring(0, start).split('\n');
        const currentLine = lines[lines.length - 1];
        if (currentLine.startsWith('  ')) {
          const newValue = value.substring(0, start - 2) + value.substring(start);
          editor.value = newValue;
          editor.setSelectionRange(start - 2, end - 2);
        }
      } else {
        // Tab: Add indentation
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        editor.value = newValue;
        editor.setSelectionRange(start + 2, start + 2);
      }
      validateJson();
    }
  });
}

function cancelDocumentEditing() {
  document.getElementById('json-viewer-container').style.display = 'block';
  document.getElementById('json-editor-container').style.display = 'none';
  document.getElementById('edit-document-btn').style.display = 'inline-flex';
  document.getElementById('json-error').style.display = 'none';
  
  // Reset editor content
  const editor = document.getElementById('json-editor');
  editor.value = originalDocumentData;
}

function validateJson() {
  const editor = document.getElementById('json-editor');
  const errorDiv = document.getElementById('json-error');
  const saveBtn = document.getElementById('save-document-btn');
  
  try {
    const jsonText = editor.value.trim();
    if (!jsonText) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'JSON cannot be empty';
      saveBtn.disabled = true;
      return false;
    }
    
    JSON.parse(jsonText);
    errorDiv.style.display = 'none';
    saveBtn.disabled = false;
    return true;
  } catch (error) {
    errorDiv.style.display = 'block';
    errorDiv.textContent = `Invalid JSON: ${error.message}`;
    saveBtn.disabled = true;
    return false;
  }
}

async function saveDocumentChanges() {
  const editor = document.getElementById('json-editor');
  const errorDiv = document.getElementById('json-error');
  
  if (!validateJson()) {
    return;
  }
  
  if (!currentEditingDocument) {
    showError('No document being edited');
    return;
  }
  
  showLoading();
  try {
    const jsonText = editor.value.trim();
    const data = JSON.parse(jsonText);
    
    const response = await fetch(
      `${API_BASE}/firestore/collections/${currentEditingDocument.collectionName}/${currentEditingDocument.documentId}`,
      {
        method: 'PUT',
        headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, confirm: true })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update document');
    }
    
    const result = await response.json();
    showSuccess('Document updated successfully');
    
    // Update the viewer with new data
    originalDocumentData = JSON.stringify(result.document.data, null, 2);
    document.getElementById('json-viewer').textContent = originalDocumentData;
    
    // Exit edit mode
    cancelDocumentEditing();
    
    // Reload the document list to reflect changes
    if (currentCollection === currentEditingDocument.collectionName) {
      loadCollectionDocuments();
    }
  } catch (error) {
    showError('Failed to update document: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Delete Firestore document
function deleteFirestoreDocument(collectionName, documentId) {
  showConfirmModal(
    `document from collection "${collectionName}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/firestore/collections/${collectionName}/${documentId}`,
          {
            method: 'DELETE',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
          }
        );
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }
        
        showSuccess('Document deleted successfully');
        loadCollectionDocuments();
      } catch (error) {
        showError('Failed to delete document: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: 1,
      details: `Document ID: <code>${documentId}</code>`,
      warning: 'This action cannot be undone!',
      confirmText: 'Delete Document'
    }
  );
}

// Delete selected Firestore documents
function deleteSelectedFirestore() {
  if (selectedFirestoreDocs.size === 0) {
    showError('No documents selected');
    return;
  }
  
  const count = selectedFirestoreDocs.size;
  showConfirmModal(
    `document(s) from collection "${currentCollection}"`,
    async () => {
      showLoading();
      try {
        const response = await fetch(
          `${API_BASE}/firestore/collections/${currentCollection}/delete-multiple`,
          {
            method: 'POST',
            headers: { ...getAuthHeaders().headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentIds: Array.from(selectedFirestoreDocs),
              confirm: true
            })
          }
        );
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete');
        }
        
        showSuccess(`${count} document(s) deleted successfully`);
        selectedFirestoreDocs.clear();
        updateFirestoreSelection();
        loadCollectionDocuments();
      } catch (error) {
        showError('Failed to delete documents: ' + error.message);
      } finally {
        hideLoading();
      }
    },
    {
      count: count,
      details: `Collection: <code>${currentCollection}</code>`,
      warning: 'This action cannot be undone! All selected documents will be permanently deleted.',
      confirmText: `Delete ${count} Document${count > 1 ? 's' : ''}`
    }
  );
}

// Update Firestore selection UI
function updateFirestoreSelection() {
  const count = selectedFirestoreDocs.size;
  const bulkActions = document.getElementById('bulk-actions-firestore');
  const countSpan = document.getElementById('selected-count');
  
  if (count > 0) {
    bulkActions.style.display = 'flex';
    countSpan.textContent = `${count} selected`;
  } else {
    bulkActions.style.display = 'none';
  }
}

function clearFirestoreSelection() {
  selectedFirestoreDocs.clear();
  document.querySelectorAll('.doc-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('select-all-firestore').checked = false;
  updateFirestoreSelection();
}

// Load Storage objects
async function loadBucketObjects() {
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

// Display Storage objects
function displayStorageObjects(objects) {
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
  objects.forEach(obj => {
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
        <button class="action-btn" onclick="viewStorageObject('${currentBucket}', '${obj.name}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="deleteStorageObject('${currentBucket}', '${obj.name}')">
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
    checkboxes.forEach(cb => {
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
  document.querySelectorAll('.obj-checkbox').forEach(cb => {
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

// View Storage object
async function viewStorageObject(bucketName, objectPath) {
  showLoading();
  try {
    // Encode each path segment separately to preserve slashes
    const pathSegments = objectPath.split('/');
    const encodedSegments = pathSegments.map(segment => encodeURIComponent(segment));
    const encodedPath = encodedSegments.join('/');
    const url = `${API_BASE}/storage/buckets/${bucketName}/objects/${encodedPath}`;
    
    const response = await fetch(url, getAuthHeaders());
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
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
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Size:</strong> ${formatBytes(data.size)}</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Type:</strong> ${data.contentType || 'Unknown'}</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Created:</strong> ${formatDate(data.timeCreated)}</div>
        <div><strong style="color: #94a3b8; display: block; margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Updated:</strong> ${formatDate(data.updated)}</div>
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

// Delete Storage object
function deleteStorageObject(bucketName, objectPath) {
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
            body: JSON.stringify({ confirm: true })
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
      confirmText: 'Delete Object'
    }
  );
}

// Delete selected Storage objects
function deleteSelectedStorage() {
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
              confirm: true
            })
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
      confirmText: `Delete ${count} Object${count > 1 ? 's' : ''}`
    }
  );
}

// Update Storage selection UI
function updateStorageSelection() {
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

function clearStorageSelection() {
  selectedStorageObjects.clear();
  document.querySelectorAll('.obj-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('select-all-storage').checked = false;
  updateStorageSelection();
}

// Pagination
function updateFirestorePagination(hasMore) {
  const pagination = document.getElementById('pagination-firestore');
  pagination.innerHTML = '';
  
  if (firestoreCursor || hasMore) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = !firestoreCursor;
    prevBtn.onclick = () => {
      // Simple implementation - reload from start
      firestoreCursor = null;
      loadCollectionDocuments();
    };
    pagination.appendChild(prevBtn);
    
    if (hasMore) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.onclick = () => loadCollectionDocuments();
      pagination.appendChild(nextBtn);
    }
  }
}

function updateStoragePagination(hasMore) {
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

// Utility functions
function getAuthHeaders() {
  const headers = {};
  if (ADMIN_PASSWORD) {
    headers['Authorization'] = `Bearer ${ADMIN_PASSWORD}`;
  }
  return { headers };
}

function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function showError(message) {
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
  setTimeout(() => {
    errorDiv.style.opacity = '0';
    errorDiv.style.transform = 'translateY(-10px)';
    setTimeout(() => errorDiv.remove(), 300);
  }, 5000);
}

function showSuccess(message) {
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
  setTimeout(() => {
    successDiv.style.opacity = '0';
    successDiv.style.transform = 'translateY(-10px)';
    setTimeout(() => successDiv.remove(), 300);
  }, 3000);
}

function showConfirmModal(message, onConfirm, options = {}) {
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

function formatDate(dateValue) {
  if (!dateValue) return '-';
  if (typeof dateValue === 'string') return new Date(dateValue).toLocaleString();
  if (dateValue.toMillis) return new Date(dateValue.toMillis()).toLocaleString();
  if (dateValue.toDate) return dateValue.toDate().toLocaleString();
  return new Date(dateValue).toLocaleString();
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============================================================================
// Customer Management
// ============================================================================

let currentOffboardingChatId = null;

async function loadCustomers() {
  const container = document.getElementById('customers-container');
  container.innerHTML = '<div class="loading-state"><div class="spinner-small"></div><p>Loading customers...</p></div>';

  try {
    const response = await fetch('/api/customers', getAuthHeaders());

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

function displayCustomers(customers) {
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
      ${customers.map(customer => `
        <tr>
          <td><code>${customer.chatId}</code></td>
          <td><strong>${escapeHtml(customer.name)}</strong></td>
          <td>${escapeHtml(customer.taxId)}</td>
          <td>${escapeHtml(customer.email)}</td>
          <td>${escapeHtml(customer.phone)}</td>
          <td>${customer.hasLogo ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-secondary">✗</span>'}</td>
          <td>${customer.hasSheet ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-secondary">✗</span>'}</td>
          <td>${formatDate(customer.updatedAt)}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="showOffboardingPreview(${customer.chatId})">
              <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              <span>Offboard</span>
            </button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);
}

async function showOffboardingPreview(chatId) {
  currentOffboardingChatId = chatId;
  const modal = document.getElementById('offboard-modal');
  const content = document.getElementById('offboard-preview-content');

  content.innerHTML = '<div class="loading-state"><div class="spinner-small"></div><p>Scanning customer data...</p></div>';
  modal.classList.add('show');

  try {
    const response = await fetch(`/api/customers/${chatId}/offboarding-preview`, getAuthHeaders());

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

function displayOffboardingPreview(preview) {
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
    items.push({ label: 'Invoice Counters', detail: `${summary.counters.count} document${summary.counters.count !== 1 ? 's' : ''}` });
  }
  if (summary.generatedInvoices.count > 0) {
    items.push({ label: 'Generated Invoices', detail: `${summary.generatedInvoices.count} document${summary.generatedInvoices.count !== 1 ? 's' : ''}` });
  }
  if (summary.generatedPDFs.count > 0) {
    items.push({ label: 'Generated PDFs', detail: `${summary.generatedPDFs.count} file${summary.generatedPDFs.count !== 1 ? 's' : ''}` });
  }
  if (summary.receivedInvoices.count > 0) {
    items.push({ label: 'Received Invoices', detail: `${summary.receivedInvoices.count} file${summary.receivedInvoices.count !== 1 ? 's' : ''}` });
  }
  if (summary.userMappings.count > 0) {
    items.push({ label: 'User Mappings', detail: `${summary.userMappings.count} user${summary.userMappings.count !== 1 ? 's' : ''}` });
  }
  if (summary.processingJobs.count > 0) {
    items.push({ label: 'Processing Jobs', detail: `${summary.processingJobs.count} job${summary.processingJobs.count !== 1 ? 's' : ''}` });
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
        ${items.map(item => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f3f4f6; border-radius: 6px; font-size: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #10b981; font-weight: bold;">✓</span>
              <span style="font-weight: 500; color: #111827;">${item.label}</span>
            </div>
            ${item.detail ? `<span style="color: #4b5563; font-size: 13px;">${item.detail}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; text-align: center;">
      <p style="margin: 0; font-weight: 700; color: #991b1b; font-size: 15px;">
        Total items to delete: ${totalItems}
      </p>
    </div>
  `;
}

async function confirmOffboarding() {
  if (!currentOffboardingChatId) return;

  const confirmBtn = document.getElementById('offboard-confirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<div class="spinner-small"></div> Deleting...';

  try {
    const response = await fetch(`/api/customers/${currentOffboardingChatId}/offboard`, {
      method: 'DELETE',
      ...getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Failed to offboard customer');
    }

    const result = await response.json();

    // Close modal
    document.getElementById('offboard-modal').classList.remove('show');

    // Show success message
    alert(`✅ Customer ${currentOffboardingChatId} has been successfully offboarded.\n\nTotal items deleted: ${result.deleted}`);

    // Reload customers list
    loadCustomers();
    currentOffboardingChatId = null;
  } catch (error) {
    console.error('Error offboarding customer:', error);
    alert(`❌ Error: ${error.message}`);
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Permanently Delete All Data</span>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Customer management event listeners - set up after DOM loads
document.addEventListener('DOMContentLoaded', () => {
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

  // Invite codes functionality
  setupInviteCodesTab();
});

// ============================================================================
// Invite Codes Management
// ============================================================================

let currentInviteStatus = 'active';

async function loadAdminConfig() {
  try {
    const response = await fetch('/api/config');
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

function setupInviteCodesTab() {
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
  statusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      statusButtons.forEach(b => b.classList.remove('active'));
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

async function generateInviteCode() {
  const adminId = document.getElementById('invite-admin-id').value;
  const adminUsername = document.getElementById('invite-admin-username').value;
  const note = document.getElementById('invite-note').value;
  const expiresInDays = document.getElementById('invite-expires').value;

  if (!adminId || !adminUsername) {
    // Show error in a better way (could create a toast or inline error, but for now keep alert for validation)
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
    const response = await fetch('/api/invite-codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        adminUserId: parseInt(adminId),
        adminUsername,
        note,
        expiresInDays: parseInt(expiresInDays)
      })
    });

    if (!response.ok) {
      throw new Error('Failed to generate invite code');
    }

    const result = await response.json();
    const code = result.inviteCode.code;

    // Show success message in UI
    const successDiv = document.getElementById('invite-success');
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
        copyBtn.innerHTML = '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
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
    generateBtn.innerHTML = '<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><span>Generate Code</span>';
  }
}

async function loadInviteCodes(status = 'active') {
  const container = document.getElementById('invites-container');

  container.innerHTML = `
    <div class="loading">
      <div class="spinner-small"></div>
      <span>Loading invite codes...</span>
    </div>
  `;

  try {
    const response = await fetch(`/api/invite-codes?status=${status}`, getAuthHeaders());

    if (!response.ok) {
      throw new Error('Failed to load invite codes');
    }

    const data = await response.json();

    // Fetch onboarding status for used codes
    const codesWithStatus = await Promise.all(
      data.inviteCodes.map(async (code) => {
        if (code.used) {
          try {
            const statusResponse = await fetch(`/api/invite-codes/${code.code}/onboarding-status`, getAuthHeaders());
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

function renderInviteCodes(codes) {
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

  const html = codes.map(code => {
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
    const onboardingBadge = code.onboardingStatus && code.onboardingStatus.exists
      ? code.onboardingStatus.status === 'stuck'
        ? `<span class="status-badge" style="background: #ef4444; color: white;">🔴 Stuck (${code.onboardingStatus.age}h old)</span>`
        : `<span class="status-badge" style="background: #f59e0b; color: white;">🟡 In Progress (${code.onboardingStatus.step})</span>`
      : code.used
      ? '<span class="status-badge" style="background: #10b981; color: white;">🟢 Completed</span>'
      : '';

    const usageInfo = code.used
      ? `
        <div style="margin-top: 12px; padding: 16px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; line-height: 1.8;">
          <div><strong style="color: var(--text-primary);">Used by:</strong> <span style="color: var(--text-secondary);">${escapeHtml(code.usedBy.chatTitle)} (Chat ID: ${code.usedBy.chatId})</span></div>
          <div><strong style="color: var(--text-primary);">Used at:</strong> <span style="color: var(--text-secondary);">${usedAt.toLocaleString()}</span></div>
          <div style="margin-top: 8px;"><strong style="color: var(--text-primary);">Onboarding:</strong> ${onboardingBadge}</div>
        </div>
      `
      : '';

    // Actions for unused codes
    const unusedActions = !code.used && !code.revoked
      ? `
        <button class="btn btn-small btn-secondary" onclick="copyInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
        <button class="btn btn-small btn-warning" onclick="revokeInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          Revoke
        </button>
        <button class="btn btn-small btn-danger" onclick="deleteInviteCode('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      `
      : '';

    // Actions for stuck/in-progress onboarding
    const sessionActions = code.onboardingStatus && code.onboardingStatus.exists
      ? `
        <button class="btn btn-small btn-warning" onclick="cleanupSession('${code.code}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Clean Session
        </button>
        <button class="btn btn-small btn-danger" onclick="deleteAll('${code.code}')">
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
            <div><strong style="color: var(--text-primary);">Created by:</strong> ${escapeHtml(code.createdBy.username)} (User ID: ${code.createdBy.userId})</div>
            <div><strong style="color: var(--text-primary);">Created:</strong> ${createdAt.toLocaleString()}</div>
            <div><strong style="color: var(--text-primary);">Expires:</strong> ${expiresAt.toLocaleString()}</div>
            ${code.note ? `<div><strong style="color: var(--text-primary);">Note:</strong> ${escapeHtml(code.note)}</div>` : ''}
          </div>
          ${usageInfo}
        </div>
        ${actions ? `<div class="list-item-actions">${actions}</div>` : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function copyInviteCode(code) {
  const command = `/onboard ${code}`;
  navigator.clipboard.writeText(command).then(() => {
    alert(`✅ Copied to clipboard:\n${command}\n\nShare this with the customer to start onboarding.`);
  }).catch(err => {
    alert(`Code: ${code}\n\nCommand: ${command}`);
  });
}

async function revokeInviteCode(code) {
  if (!confirm(`Revoke invite code ${code}?\n\nThis will prevent it from being used for onboarding.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/invite-codes/${code}/revoke`, {
      method: 'POST',
      ...getAuthHeaders()
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

async function deleteInviteCode(code) {
  if (!confirm(`Are you sure you want to delete invite code ${code}?\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/invite-codes/${code}`, {
      method: 'DELETE',
      ...getAuthHeaders()
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

async function cleanupSession(code) {
  if (!confirm(`Clean onboarding session for ${code}?\n\nThis will delete the stuck session but keep the invite code for audit trail.\n\nThe user can start onboarding again.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/invite-codes/${code}/cleanup-session`, {
      method: 'POST',
      ...getAuthHeaders()
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

async function deleteAll(code) {
  if (!confirm(`Delete BOTH invite code AND onboarding session for ${code}?\n\n⚠️ WARNING: This will:\n- Delete the invite code permanently\n- Delete the onboarding session\n- Remove all traces from the system\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/invite-codes/${code}/delete-all`, {
      method: 'POST',
      ...getAuthHeaders()
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
