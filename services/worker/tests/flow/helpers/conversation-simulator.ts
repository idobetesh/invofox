/**
 * Conversation Simulator for flow tests.
 *
 * TelegramCapture records every call to telegram.service and tracks the
 * "current keyboard" the user sees (last sendMessage or editMessageReplyMarkup).
 *
 * ConversationSimulator wraps supertest and lets tests click real buttons
 * (extracted from the recorded keyboard) rather than hard-coding callback data.
 *
 * Usage:
 *   const capture = new TelegramCapture();
 *   setupTelegramMock(telegramService, capture);
 *   const sim = new ConversationSimulator(app, capture, CHAT_ID, USER_ID);
 *   await sim.sendCommand('/new');
 *   await sim.clickButton('קבלה');
 *   sim.expectButtons(['I-001 | Test | ₪500']);
 */

import request from 'supertest';
import type { Express } from 'express';

type InlineButton = { text: string; callback_data?: string };
type InlineKeyboard = InlineButton[][];

// ─── TelegramCapture ────────────────────────────────────────────────────────

export class TelegramCapture {
  private _currentKeyboard: InlineKeyboard | null = null;
  private _lastMessageText: string | null = null;
  private _sendDocumentCalled = false;

  /** Called by sendMessage mock */
  onSendMessage = (
    _chatId: number,
    text: string,
    options?: { replyMarkup?: { inline_keyboard: InlineKeyboard } }
  ): { message_id: number } => {
    this._lastMessageText = text;
    // If the message has a keyboard, show it; otherwise user sees no keyboard
    if (options?.replyMarkup?.inline_keyboard) {
      this._currentKeyboard = options.replyMarkup.inline_keyboard;
    } else {
      this._currentKeyboard = null;
    }
    return { message_id: 999 };
  };

  /** Called by editMessageReplyMarkup mock — updates the visible keyboard */
  onEditMessageReplyMarkup = (
    _chatId: number,
    _messageId: number,
    replyMarkup: { inline_keyboard: InlineKeyboard }
  ): void => {
    this._currentKeyboard = replyMarkup.inline_keyboard;
  };

  /** Called by editMessageText mock — updates text; keyboard only changes if replyMarkup supplied */
  onEditMessageText = (
    _chatId: number,
    _messageId: number,
    text: string,
    options?: { replyMarkup?: { inline_keyboard: InlineKeyboard } }
  ): void => {
    this._lastMessageText = text;
    if (options?.replyMarkup?.inline_keyboard) {
      this._currentKeyboard = options.replyMarkup.inline_keyboard;
    }
    // Note: editMessageText without replyMarkup does NOT clear _currentKeyboard
    // because the user is focused on the NEW message, not the edited one
  };

  /** Called by sendDocument mock */
  onSendDocument = (
    _chatId: number,
    _document: Buffer,
    _filename: string,
    _options?: unknown
  ): { message_id: number } => {
    this._sendDocumentCalled = true;
    return { message_id: 998 };
  };

  // ── Query helpers ────────────────────────────────────────────────────────

  /** Flat list of all button texts currently shown */
  getVisibleButtons(): string[] {
    return this._currentKeyboard?.flat().map((b) => b.text) ?? [];
  }

  /**
   * Find a button by exact text and parse its callback_data.
   * Returns null if the button doesn't exist or has no parsable JSON callback_data.
   */
  getButtonCallbackData(buttonText: string): Record<string, unknown> | null {
    const keyboard = this._currentKeyboard;
    if (!keyboard) {
      return null;
    }
    const button = keyboard.flat().find((b) => b.text === buttonText);
    if (!button?.callback_data || button.callback_data === 'noop') {
      return null;
    }
    try {
      return JSON.parse(button.callback_data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  getLastMessageText(): string | null {
    return this._lastMessageText;
  }

  wasSendDocumentCalled(): boolean {
    return this._sendDocumentCalled;
  }

  /** Reset all state (call in beforeEach) */
  reset(): void {
    this._currentKeyboard = null;
    this._lastMessageText = null;
    this._sendDocumentCalled = false;
  }
}

// ─── setupTelegramMock ───────────────────────────────────────────────────────

/**
 * Wire a TelegramCapture into the telegram.service mock.
 * Call this in beforeEach after creating a fresh TelegramCapture.
 */
export function setupTelegramMock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  telegramService: Record<string, jest.Mock>,
  capture: TelegramCapture
): void {
  telegramService.sendMessage.mockImplementation(capture.onSendMessage);
  telegramService.editMessageReplyMarkup.mockImplementation(capture.onEditMessageReplyMarkup);
  telegramService.editMessageText.mockImplementation(capture.onEditMessageText);
  telegramService.sendDocument.mockImplementation(capture.onSendDocument);
  telegramService.answerCallbackQuery.mockResolvedValue(undefined);
  telegramService.deleteMessage.mockResolvedValue(undefined);
}

// ─── ConversationSimulator ───────────────────────────────────────────────────

export class ConversationSimulator {
  private _msgCounter = 10;
  private _cbqCounter = 0;

  constructor(
    private readonly app: Express,
    private readonly capture: TelegramCapture,
    public readonly chatId: number,
    public readonly userId: number,
    private readonly username = 'testuser',
    private readonly chatTitle = 'Test Chat'
  ) {}

  /** Send a /new (or any) invoice command */
  async sendCommand(text = '/new') {
    const res = await request(this.app).post('/invoice/command').send({
      type: 'command',
      chatId: this.chatId,
      userId: this.userId,
      username: this.username,
      firstName: 'Test',
      chatTitle: this.chatTitle,
      messageId: ++this._msgCounter,
      text,
      receivedAt: new Date().toISOString(),
    });
    return res;
  }

  /** Send a /report command */
  async sendReportCommand() {
    return request(this.app).post('/report/command').send({
      type: 'command',
      chatId: this.chatId,
      userId: this.userId,
      username: this.username,
      firstName: 'Test',
      chatTitle: this.chatTitle,
      messageId: ++this._msgCounter,
      text: '/report',
      receivedAt: new Date().toISOString(),
    });
  }

  /** Send a text message during an invoice conversation */
  async sendMessage(text: string) {
    return request(this.app).post('/invoice/message').send({
      type: 'message',
      chatId: this.chatId,
      userId: this.userId,
      username: this.username,
      firstName: 'Test',
      messageId: ++this._msgCounter,
      text,
      receivedAt: new Date().toISOString(),
    });
  }

  /** Send a /onboard command */
  async sendOnboardCommand(inviteCode?: string) {
    return request(this.app)
      .post('/onboard/command')
      .send({
        type: 'command',
        chatId: this.chatId,
        userId: this.userId,
        username: this.username,
        firstName: 'Test',
        chatTitle: this.chatTitle,
        messageId: ++this._msgCounter,
        text: inviteCode ? `/onboard ${inviteCode}` : '/onboard',
        receivedAt: new Date().toISOString(),
      });
  }

  /** Send a text message during onboarding */
  async sendOnboardMessage(text: string) {
    return request(this.app).post('/onboard/message').send({
      type: 'message',
      chatId: this.chatId,
      userId: this.userId,
      username: this.username,
      firstName: 'Test',
      messageId: ++this._msgCounter,
      text,
      receivedAt: new Date().toISOString(),
    });
  }

  /** Send an onboarding callback (e.g. language or tax selection) */
  async sendOnboardCallback(callbackData: string) {
    return request(this.app)
      .post('/onboard/callback')
      .send({
        type: 'callback',
        chatId: this.chatId,
        userId: this.userId,
        username: this.username,
        callbackQueryId: `cbq_${++this._cbqCounter}`,
        messageId: this._msgCounter,
        data: callbackData,
        receivedAt: new Date().toISOString(),
      });
  }

  /**
   * Click a button from the current keyboard and post to /callback (process controller).
   * Used for correction flow buttons: edit_invoice, edit_field, edit_cancel.
   */
  async clickProcessButton(buttonText: string) {
    const callbackData = this.capture.getButtonCallbackData(buttonText);
    if (!callbackData) {
      const available = this.capture.getVisibleButtons();
      throw new Error(
        `Button "${buttonText}" not found in current keyboard.\n` +
          `Available buttons: [${available.map((b) => `"${b}"`).join(', ')}]`
      );
    }

    return request(this.app)
      .post('/callback')
      .send({
        callbackQueryId: `cbq_process_${++this._cbqCounter}`,
        data: JSON.stringify(callbackData),
        botMessageChatId: this.chatId,
        botMessageId: this._msgCounter,
      });
  }

  /**
   * Send an edit_invoice callback directly — simulates a user clicking the ✏️ Edit
   * button on an already-processed invoice success message.
   * @param jobId       Firestore job document ID (format: chatId_messageId)
   * @param successMessageId  Telegram message ID of the success message
   */
  async sendEditCallback(jobId: string, successMessageId: number) {
    return request(this.app)
      .post('/callback')
      .send({
        callbackQueryId: `cbq_edit_${++this._cbqCounter}`,
        data: JSON.stringify({ a: 'ei', j: jobId }),
        botMessageChatId: this.chatId,
        botMessageId: successMessageId,
      });
  }

  /**
   * Click a button by its exact label text.
   * Extracts the callback_data from the REAL keyboard that was sent by the bot.
   * Throws with clear diagnostics if the button is not found.
   */
  async clickButton(buttonText: string) {
    const callbackData = this.capture.getButtonCallbackData(buttonText);
    if (!callbackData) {
      const available = this.capture.getVisibleButtons();
      throw new Error(
        `Button "${buttonText}" not found in current keyboard.\n` +
          `Available buttons: [${available.map((b) => `"${b}"`).join(', ')}]`
      );
    }

    return request(this.app)
      .post('/invoice/callback')
      .send({
        type: 'callback',
        chatId: this.chatId,
        userId: this.userId,
        username: this.username,
        callbackQueryId: `cbq_${++this._cbqCounter}`,
        messageId: this._msgCounter,
        data: JSON.stringify(callbackData),
        receivedAt: new Date().toISOString(),
      });
  }

  // ── Assertion helpers ──────────────────────────────────────────────────────

  /**
   * Assert that currently visible INTERACTIVE buttons include the expected texts.
   * Pass [] to assert that no interactive buttons are visible.
   * "Interactive" means the button has valid JSON callback_data (not "noop").
   */
  expectButtons(expected: string[]): void {
    const visible = this.capture.getVisibleButtons();
    if (expected.length === 0) {
      // Check that no interactive buttons are visible
      const interactive = visible.filter((b) => this.capture.getButtonCallbackData(b) !== null);
      expect(interactive).toHaveLength(0);
    } else {
      expect(visible).toEqual(expect.arrayContaining(expected));
    }
  }

  /** Assert the last message sent to the user contains a substring */
  expectMessageContains(substr: string): void {
    expect(this.capture.getLastMessageText()).toContain(substr);
  }
}
