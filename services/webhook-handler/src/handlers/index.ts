/**
 * Handlers barrel export
 * Re-exports all webhook handlers for cleaner imports
 */

export { handleCallbackQuery } from './callback.handler';
export { handleInvoiceCommand } from './invoice-command.handler';
export { handleOnboardCommand } from './onboard-command.handler';
export { handleReportCommand } from './report-command.handler';
export { handleTextMessage } from './text-message.handler';
