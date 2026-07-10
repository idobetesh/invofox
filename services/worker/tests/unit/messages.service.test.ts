import type { InvoiceSession } from '../../../../shared/types';
import { buildEditFieldPrompt } from '../../src/services/document-generator/messages.service';

describe('buildEditFieldPrompt', () => {
  const baseSession: InvoiceSession = {
    status: 'reviewing',
    documentType: 'invoice_receipt',
    customerName: 'דור',
    description: 'שלושה ספרים',
    amount: 557,
    currency: 'ILS',
    paymentMethod: 'מזומן',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('includes the current value when editing a populated field', () => {
    const prompt = buildEditFieldPrompt('customerName', baseSession, 'he');

    expect(prompt).toContain('שלח שם לקוח');
    expect(prompt).toContain('ערך נוכחי: דור');
  });

  it('omits the current value line when the field is empty', () => {
    const prompt = buildEditFieldPrompt('description', { ...baseSession, description: '' }, 'he');

    expect(prompt).toBe('✏️ שלח תיאור:');
    expect(prompt).not.toContain('ערך נוכחי');
  });

  it('formats amount with currency symbol', () => {
    const prompt = buildEditFieldPrompt('amount', baseSession, 'he');

    expect(prompt).toContain('ערך נוכחי: ₪557');
  });
});
