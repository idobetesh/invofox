/**
 * Firestore Operations Module
 * Handles Firestore collection and document operations
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
} from './utils.js';

// State
export let currentCollection = null;
export let selectedFirestoreDocs = new Set();
export let firestoreCursor = null;
let currentEditingDocument = null;
let originalDocumentData = null;

/**
 * Load Firestore collections
 */
export async function loadCollections() {
  try {
    const response = await fetch(`${API_BASE}/firestore/collections`, getAuthHeaders());
    const data = await response.json();

    const select = document.getElementById('collection-select');
    select.innerHTML = '<option value="">Select a collection...</option>';
    data.collections.forEach((col) => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      select.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load collections: ' + error.message);
  }
}

/**
 * Load documents from a collection
 */
export async function loadCollectionDocuments() {
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
      `${API_BASE}/firestore/collections/${collectionName}?limit=50${
        firestoreCursor ? `&startAfter=${firestoreCursor}` : ''
      }`,
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

/**
 * Display Firestore documents in table
 */
export function displayFirestoreDocuments(documents) {
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
  documents.forEach((doc) => {
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
        <button class="action-btn" onclick="window.viewFirestoreDocument('${currentCollection}', '${doc.id}')">
          <svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>View</span>
        </button>
        <button class="action-btn delete" onclick="window.deleteFirestoreDocument('${currentCollection}', '${doc.id}')">
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
    checkboxes.forEach((cb) => {
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
  document.querySelectorAll('.doc-checkbox').forEach((cb) => {
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

/**
 * View Firestore document details
 */
export async function viewFirestoreDocument(collectionName, documentId) {
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

/**
 * Enable document editing mode
 */
export function enableDocumentEditing() {
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

/**
 * Cancel document editing
 */
export function cancelDocumentEditing() {
  document.getElementById('json-viewer-container').style.display = 'block';
  document.getElementById('json-editor-container').style.display = 'none';
  document.getElementById('edit-document-btn').style.display = 'inline-flex';
  document.getElementById('json-error').style.display = 'none';

  // Reset editor content
  const editor = document.getElementById('json-editor');
  editor.value = originalDocumentData;
}

/**
 * Validate JSON in editor
 */
export function validateJson() {
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

/**
 * Save document changes
 */
export async function saveDocumentChanges() {
  const editor = document.getElementById('json-editor');

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
        body: JSON.stringify({ data, confirm: true }),
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

/**
 * Delete a Firestore document
 */
export function deleteFirestoreDocument(collectionName, documentId) {
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
            body: JSON.stringify({ confirm: true }),
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
      confirmText: 'Delete Document',
    }
  );
}

/**
 * Delete selected Firestore documents
 */
export function deleteSelectedFirestore() {
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
              confirm: true,
            }),
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
      warning:
        'This action cannot be undone! All selected documents will be permanently deleted.',
      confirmText: `Delete ${count} Document${count > 1 ? 's' : ''}`,
    }
  );
}

/**
 * Update selection UI
 */
export function updateFirestoreSelection() {
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

/**
 * Clear selection
 */
export function clearFirestoreSelection() {
  selectedFirestoreDocs.clear();
  document.querySelectorAll('.doc-checkbox').forEach((cb) => (cb.checked = false));
  document.getElementById('select-all-firestore').checked = false;
  updateFirestoreSelection();
}

/**
 * Update pagination
 */
export function updateFirestorePagination(hasMore) {
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
