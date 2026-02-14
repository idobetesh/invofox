/**
 * Keyboards Service Multi-Invoice Tests
 * Tests for multi-select invoice keyboard UI generation
 */

import { buildInvoiceSelectionKeyboard } from '../../src/services/document-generator/keyboards.service';
import { OpenInvoice } from '../../src/services/document-generator/open-invoices.service';

describe('Keyboards Service - Multi-Invoice', () => {
  const mockOpenInvoices: OpenInvoice[] = [
    {
      invoiceNumber: 'I-2026-100',
      customerName: 'רבקה לוי',
      date: '01/01/2026',
      amount: 3000,
      paidAmount: 0,
      remainingBalance: 3000,
      currency: 'ILS',
    },
    {
      invoiceNumber: 'I-2026-101',
      customerName: 'רבקה לוי',
      date: '02/01/2026',
      amount: 2500,
      paidAmount: 0,
      remainingBalance: 2500,
      currency: 'ILS',
    },
    {
      invoiceNumber: 'I-2026-102',
      customerName: 'דוד כהן',
      date: '03/01/2026',
      amount: 1500,
      paidAmount: 0,
      remainingBalance: 1500,
      currency: 'ILS',
    },
    {
      invoiceNumber: 'I-2026-103',
      customerName: 'רבקה לוי',
      date: '04/01/2026',
      amount: 4000,
      paidAmount: 0,
      remainingBalance: 4000,
      currency: 'ILS',
    },
  ];

  // Helper to convert selected invoice numbers to selectedInvoiceData
  const toSelectedData = (invoiceNumbers: string[], invoices: OpenInvoice[] = mockOpenInvoices) => {
    return invoiceNumbers.map((num) => {
      const invoice = invoices.find((inv) => inv.invoiceNumber === num);
      if (!invoice) {
        throw new Error(`Invoice ${num} not found in mock data`);
      }
      return {
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        remainingBalance: invoice.remainingBalance,
        date: invoice.date,
        currency: invoice.currency,
      };
    });
  };

  describe('buildInvoiceSelectionKeyboard', () => {
    it('should show no prefix for unselected invoices', () => {
      const keyboard = buildInvoiceSelectionKeyboard(mockOpenInvoices, [], [], 0, 4);

      expect(keyboard.inline_keyboard).toBeDefined();
      const buttons = keyboard.inline_keyboard.flat();

      // Unselected invoice buttons should have NO prefix (clean look)
      const invoiceButtons = buttons.filter((btn) => btn.text.includes('I-2026-'));
      invoiceButtons.forEach((btn) => {
        expect(btn.text).not.toContain('✓');
        expect(btn.text).not.toContain('⛔');
      });
    });

    it('should show checkmark for selected invoice', () => {
      const selected = ['I-2026-100'];
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();
      const selectedButton = buttons.find((btn) => btn.text.includes('I-2026-100'));
      const unselectedButton = buttons.find((btn) => btn.text.includes('I-2026-101'));

      expect(selectedButton?.text).toContain('✓');
      expect(unselectedButton?.text).not.toContain('✓');
    });

    it('should show checkmarks for multiple selected invoices', () => {
      const selected = ['I-2026-100', 'I-2026-101', 'I-2026-103'];
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();

      const button100 = buttons.find((btn) => btn.text.includes('I-2026-100'));
      const button101 = buttons.find((btn) => btn.text.includes('I-2026-101'));
      const button102 = buttons.find((btn) => btn.text.includes('I-2026-102'));
      const button103 = buttons.find((btn) => btn.text.includes('I-2026-103'));

      expect(button100?.text).toContain('✓');
      expect(button101?.text).toContain('✓');
      expect(button102?.text).not.toContain('✓'); // Unselected - no prefix
      expect(button103?.text).toContain('✓');
    });

    it('should use toggle_invoice callback action', () => {
      const keyboard = buildInvoiceSelectionKeyboard(mockOpenInvoices, [], [], 0, 4);

      const buttons = keyboard.inline_keyboard.flat();
      const invoiceButton = buttons.find((btn) => btn.text.includes('I-2026-100'));

      expect(invoiceButton?.callback_data).toBeDefined();
      const callbackData = JSON.parse(invoiceButton!.callback_data!);
      expect(callbackData.action).toBe('toggle_invoice');
      expect(callbackData.invoiceNumber).toBe('I-2026-100');
    });

    it('should disable invoices from different customers with ⛔ prefix', () => {
      const selected = ['I-2026-100']; // רבקה לוי
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();

      const sameCustomerButton = buttons.find((btn) => btn.text.includes('I-2026-101'));
      const differentCustomerButton = buttons.find((btn) => btn.text.includes('I-2026-102'));

      // Same customer - should be selectable (no ⛔)
      expect(sameCustomerButton?.text).not.toContain('⛔');

      // Different customer - should be disabled (⛔)
      expect(differentCustomerButton?.text).toContain('⛔');
    });

    it('should show summary row when invoices are selected', () => {
      const selected = ['I-2026-100', 'I-2026-101'];
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();
      const summaryButton = buttons.find((btn) => btn.text.includes('נבחרו'));

      expect(summaryButton).toBeDefined();
      expect(summaryButton?.text).toContain('2 חשבוניות');
      expect(summaryButton?.text).toContain('₪5500.00'); // 3000 + 2500 = 5500.00
    });

    it('should show continue button when 2+ invoices selected', () => {
      const selected = ['I-2026-100', 'I-2026-101'];
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();
      const continueButton = buttons.find((btn) => btn.text.includes('המשך'));

      expect(continueButton).toBeDefined();
      const callbackData = JSON.parse(continueButton!.callback_data!);
      expect(callbackData.action).toBe('confirm_selection');
    });

    it('should show continue button with single-invoice text when 1 invoice selected', () => {
      const selected = ['I-2026-100'];
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();
      const continueButton = buttons.find((btn) => btn.text.includes('המשך'));

      expect(continueButton).toBeDefined();
      expect(continueButton?.text).toBe('▶️ המשך עם חשבונית זו');
    });

    it('should show helper text when no invoices selected', () => {
      const keyboard = buildInvoiceSelectionKeyboard(mockOpenInvoices, [], [], 0, 4);

      const buttons = keyboard.inline_keyboard.flat();
      const helperButton = buttons.find((btn) => btn.text.includes('💡'));

      expect(helperButton).toBeDefined();
      expect(helperButton?.text).toContain('בחר חשבונית אחת או יותר');
    });

    it('should calculate correct total for multiple invoices with different amounts', () => {
      const selected = ['I-2026-100', 'I-2026-103']; // 3000 + 4000 = 7000
      const keyboard = buildInvoiceSelectionKeyboard(
        mockOpenInvoices,
        selected,
        toSelectedData(selected),
        0,
        4
      );

      const buttons = keyboard.inline_keyboard.flat();
      const summaryButton = buttons.find((btn) => btn.text.includes('נבחרו'));

      expect(summaryButton?.text).toContain('₪7000.00'); // 3000 + 4000 = 7000.00
    });

    it('should show cancel button', () => {
      const keyboard = buildInvoiceSelectionKeyboard(mockOpenInvoices, [], [], 0, 4);

      const buttons = keyboard.inline_keyboard.flat();
      const cancelButton = buttons.find((btn) => btn.text.includes('❌'));

      expect(cancelButton).toBeDefined();
      const callbackData = JSON.parse(cancelButton!.callback_data!);
      expect(callbackData.action).toBe('cancel');
    });

    it('should show pagination buttons when total > page size', () => {
      const manyInvoices: OpenInvoice[] = Array.from({ length: 15 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
        amount: 2000 + i * 100,
        paidAmount: 0,
        remainingBalance: 2000 + i * 100,
        currency: 'ILS',
      }));

      const keyboard = buildInvoiceSelectionKeyboard(manyInvoices.slice(0, 10), [], [], 0, 15);

      const buttons = keyboard.inline_keyboard.flat();
      const showMoreButton = buttons.find((btn) => btn.text.includes('הצג עוד'));

      expect(showMoreButton).toBeDefined();
      const callbackData = JSON.parse(showMoreButton!.callback_data!);
      expect(callbackData.action).toBe('show_more');
    });

    it('should disable invoices when max limit (10) reached', () => {
      const tenInvoices: OpenInvoice[] = Array.from({ length: 12 }, (_, i) => ({
        invoiceNumber: `I-2026-${100 + i}`,
        customerName: 'רבקה לוי',
        date: `${String(i + 1).padStart(2, '0')}/01/2026`,
        amount: 2000 + i * 100,
        paidAmount: 0,
        remainingBalance: 2000 + i * 100,
        currency: 'ILS',
      }));

      const selected = tenInvoices.slice(0, 10).map((inv) => inv.invoiceNumber);
      const keyboard = buildInvoiceSelectionKeyboard(
        tenInvoices,
        selected,
        toSelectedData(selected, tenInvoices),
        0,
        12
      );

      const buttons = keyboard.inline_keyboard.flat();

      // First 10 should have checkmarks
      const checkedButtons = buttons.filter((btn) => btn.text.includes('✓'));
      expect(checkedButtons).toHaveLength(10);

      // Remaining invoices should have 'noop' callback_data (disabled)
      const disabledButtons = buttons.filter(
        (btn) =>
          btn.text.includes('I-2026-') && !btn.text.includes('✓') && btn.callback_data === 'noop'
      );
      expect(disabledButtons.length).toBe(2); // 2 unselected invoices (110, 111)
    });

    it('should handle USD currency correctly in summary', () => {
      const usdInvoices: OpenInvoice[] = [
        {
          invoiceNumber: 'I-2026-200',
          customerName: 'John Doe',
          date: '01/01/2026',
          amount: 1000,
          paidAmount: 0,
          remainingBalance: 1000,
          currency: 'USD',
        },
        {
          invoiceNumber: 'I-2026-201',
          customerName: 'John Doe',
          date: '02/01/2026',
          amount: 1500,
          paidAmount: 0,
          remainingBalance: 1500,
          currency: 'USD',
        },
      ];

      const selected = ['I-2026-200', 'I-2026-201'];
      const keyboard = buildInvoiceSelectionKeyboard(
        usdInvoices,
        selected,
        toSelectedData(selected, usdInvoices),
        0,
        2
      );

      const buttons = keyboard.inline_keyboard.flat();
      const summaryButton = buttons.find((btn) => btn.text.includes('נבחרו'));

      expect(summaryButton?.text).toContain('USD2500.00'); // Shows currency code for non-ILS
    });
  });
});
