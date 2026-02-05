/**
 * Caching Module
 * Handles client-side caching to minimize API calls
 */

import { API_BASE, getAuthHeaders } from './utils.js';

// Cache storage
const cache = {
  customers: {
    data: null,
    timestamp: null,
    ttl: 5 * 60 * 1000, // 5 minutes
  },
  invoicesByCustomer: new Map(), // chatId -> { data, timestamp }
};

/**
 * Get all customers (cached)
 */
export async function getCachedCustomers(forceRefresh = false) {
  const now = Date.now();

  // Return cached data if valid
  if (
    !forceRefresh &&
    cache.customers.data &&
    cache.customers.timestamp &&
    now - cache.customers.timestamp < cache.customers.ttl
  ) {
    return cache.customers.data;
  }

  // Fetch fresh data
  const response = await fetch(`${API_BASE}/customers`, getAuthHeaders());

  if (!response.ok) {
    throw new Error('Failed to fetch customers');
  }

  const data = await response.json();

  // Update cache
  cache.customers.data = data.customers;
  cache.customers.timestamp = now;

  return data.customers;
}

/**
 * Get invoices for a specific customer (cached)
 * Only fetches unpaid/partial invoices for receipt linking
 */
export async function getCachedInvoicesForCustomer(chatId, forceRefresh = false) {
  const now = Date.now();
  const cached = cache.invoicesByCustomer.get(chatId);

  // Return cached data if valid
  if (
    !forceRefresh &&
    cached &&
    cached.timestamp &&
    now - cached.timestamp < cache.customers.ttl
  ) {
    return cached.data;
  }

  // Fetch fresh data
  const response = await fetch(
    `${API_BASE}/invoices?chatId=${chatId}&status=unpaid,partial`,
    getAuthHeaders()
  );

  if (!response.ok) {
    throw new Error('Failed to fetch invoices');
  }

  const data = await response.json();

  // Update cache
  cache.invoicesByCustomer.set(chatId, {
    data: data.invoices,
    timestamp: now,
  });

  return data.invoices;
}

/**
 * Clear all cached data
 */
export function clearCache() {
  cache.customers.data = null;
  cache.customers.timestamp = null;
  cache.invoicesByCustomer.clear();
}

/**
 * Clear customer cache only
 */
export function clearCustomerCache() {
  cache.customers.data = null;
  cache.customers.timestamp = null;
}

/**
 * Clear invoice cache for specific customer
 */
export function clearInvoiceCacheForCustomer(chatId) {
  cache.invoicesByCustomer.delete(chatId);
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    customers: {
      cached: !!cache.customers.data,
      age: cache.customers.timestamp
        ? Date.now() - cache.customers.timestamp
        : null,
    },
    invoices: {
      customerCount: cache.invoicesByCustomer.size,
      customers: Array.from(cache.invoicesByCustomer.keys()),
    },
  };
}
