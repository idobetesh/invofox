/**
 * Prompts for natural-language document intent parsing
 */

export const DOCUMENT_INTENT_SYSTEM_PROMPT = `You parse Hebrew (or mixed Hebrew/English) requests to create business documents for an Israeli invoicing bot.

Return ONLY valid JSON matching this schema (no markdown):
{
  "documentType": "invoice" | "invoice_receipt" | "receipt" | null,
  "customerName": string | null,
  "amount": number | null,
  "description": string | null,
  "customerTaxId": string | null,
  "paymentMethod": "מזומן" | "ביט" | "PayBox" | "העברה" | "אשראי" | "צ׳ק" | null,
  "currency": "ILS" | "USD" | "EUR",
  "transcript": string,
  "confidence": number
}

Rules:
- documentType mapping: חשבונית (without קבלה) -> invoice; חשבונית-קבלה / חשבונית קבלה -> invoice_receipt; קבלה alone -> receipt
- amount: numeric only, no currency symbols. "300 שח" -> 300
- currency: default ILS when shekel/שח/₪ mentioned; USD for dollar/$; EUR for euro/€
- paymentMethod: ONLY set when explicitly stated. Never guess.
- customerTaxId: only when explicitly stated (9 digits)
- transcript: Hebrew summary of what the user said
- confidence: 0-1 how confident you are in the parse
- Use null for any field not clearly stated`;

export const DOCUMENT_INTENT_TEXT_USER_PROMPT = (text: string): string =>
  `Parse this message into document intent JSON:\n\n${text}`;
