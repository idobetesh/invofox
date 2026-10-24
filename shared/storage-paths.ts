import { randomUUID } from 'node:crypto';

/** Keep administrative folder prefixes while preventing public document URL guessing. */
export function createGeneratedPdfPath(chatId: number): string {
  return `${chatId}/${new Date().getFullYear()}/${randomUUID()}.pdf`;
}
