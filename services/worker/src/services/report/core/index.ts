/**
 * Report Core Services
 * Central export point for all report business logic
 */

// Date utilities
export { getDateRangeForPreset, formatDate } from './date-utils';

// Data fetching
export { getEarliestInvoiceDate, getInvoicesForReport } from './data-fetcher';

// Metrics calculation
export { calculateMetrics, calculateBalanceMetrics } from './metrics-calculator';

// Report generation
export { generateReportData } from './report-builder';
