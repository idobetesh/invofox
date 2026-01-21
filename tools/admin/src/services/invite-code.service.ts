import { Firestore, Timestamp } from '@google-cloud/firestore';

export interface InviteCode {
  code: string;
  createdBy: {
    userId: number;
    username: string;
  };
  createdAt: Timestamp;
  expiresAt: Timestamp;
  used: boolean;
  usedBy: {
    chatId: number;
    chatTitle: string;
  } | null;
  usedAt: Timestamp | null;
  note: string;
  revoked: boolean;
}

export interface CreateInviteCodeRequest {
  adminUserId: number;
  adminUsername: string;
  note?: string;
  expiresInDays?: number;
}

export class InviteCodeService {
  private readonly COLLECTION_NAME = 'invite_codes';
  private readonly ONBOARDING_SESSIONS_COLLECTION = 'onboarding_sessions';

  constructor(private firestore: Firestore) {}

  /**
   * Generate a cryptographically secure invite code
   * Format: INV-XXXXXX (6 characters, no confusing chars)
   */
  private generateInviteCode(): string {
    // Character set excludes confusing characters (0/O, 1/I/l)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const length = 6;

    let code = 'INV-';
    const crypto = require('crypto');
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
      code += chars[randomBytes[i] % chars.length];
    }

    return code;
  }

  /**
   * Create a new invite code
   */
  async createInviteCode(request: CreateInviteCodeRequest): Promise<InviteCode> {
    // Generate unique code
    let code: string;
    let exists: boolean;

    // Retry until we get a unique code (collision is extremely rare with 1B+ combinations)
    do {
      code = this.generateInviteCode();
      const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(code);
      const doc = await docRef.get();
      exists = doc.exists;
    } while (exists);

    const now = Timestamp.now();
    const expiresInDays = request.expiresInDays || 7;
    const expiresAt = Timestamp.fromMillis(now.toMillis() + expiresInDays * 24 * 60 * 60 * 1000);

    const inviteCode: InviteCode = {
      code,
      createdBy: {
        userId: request.adminUserId,
        username: request.adminUsername,
      },
      createdAt: now,
      expiresAt,
      used: false,
      usedBy: null,
      usedAt: null,
      note: request.note || '',
      revoked: false,
    };

    await this.firestore.collection(this.COLLECTION_NAME).doc(code).set(inviteCode);

    console.log(`[InviteCodeService] Created invite code: ${code} by ${request.adminUsername}`);

    return inviteCode;
  }

  /**
   * List all invite codes
   */
  async listInviteCodes(status?: 'active' | 'used' | 'expired' | 'all'): Promise<InviteCode[]> {
    let query: FirebaseFirestore.Query = this.firestore
      .collection(this.COLLECTION_NAME)
      .orderBy('createdAt', 'desc');

    // Apply filters based on status
    if (status === 'used') {
      query = query.where('used', '==', true);
    } else if (status === 'active') {
      query = query.where('used', '==', false).where('revoked', '==', false);
    }

    const snapshot = await query.get();
    const codes = snapshot.docs.map((doc) => doc.data() as InviteCode);

    // Filter expired codes in-memory (Firestore doesn't support dynamic time comparisons)
    if (status === 'expired') {
      const now = Timestamp.now().toMillis();
      return codes.filter((code) => !code.used && !code.revoked && code.expiresAt.toMillis() < now);
    } else if (status === 'active') {
      const now = Timestamp.now().toMillis();
      return codes.filter((code) => code.expiresAt.toMillis() >= now);
    }

    return codes;
  }

  /**
   * Get a specific invite code by code
   */
  async getInviteCode(code: string): Promise<InviteCode | null> {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(code);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as InviteCode;
  }

  /**
   * Revoke an invite code
   */
  async revokeInviteCode(code: string): Promise<void> {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(code);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Invite code not found');
    }

    const invite = doc.data() as InviteCode;
    if (invite.used) {
      throw new Error('Cannot revoke used invite code');
    }

    await docRef.update({
      revoked: true,
    });

    console.log(`[InviteCodeService] Revoked invite code: ${code}`);
  }

  /**
   * Delete an invite code
   */
  async deleteInviteCode(code: string): Promise<void> {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(code);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Invite code not found');
    }

    const invite = doc.data() as InviteCode;
    if (invite.used) {
      throw new Error('Cannot delete used invite code');
    }

    await docRef.delete();

    console.log(`[InviteCodeService] Deleted invite code: ${code}`);
  }

  /**
   * Get onboarding session status for an invite code
   */
  async getOnboardingStatus(code: string): Promise<{
    exists: boolean;
    status?: 'in_progress' | 'stuck' | 'completed';
    age?: number;
    step?: string;
    chatId?: number;
  }> {
    // Get invite code
    const inviteCode = await this.getInviteCode(code);

    if (!inviteCode || !inviteCode.used || !inviteCode.usedBy) {
      return { exists: false, status: 'completed' };
    }

    const chatId = inviteCode.usedBy.chatId;

    // Check onboarding session
    const sessionRef = this.firestore
      .collection(this.ONBOARDING_SESSIONS_COLLECTION)
      .doc(chatId.toString());
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return { exists: false, status: 'completed', chatId };
    }

    const data = sessionDoc.data();
    if (!data) {
      return { exists: false, status: 'completed', chatId };
    }

    // Calculate age
    const startedAt = data.startedAt;
    let ageHours = 0;

    if (startedAt && typeof startedAt === 'object' && 'toMillis' in startedAt) {
      const ageMs = Date.now() - startedAt.toMillis();
      ageHours = ageMs / (1000 * 60 * 60);
    } else if (startedAt instanceof Date) {
      const ageMs = Date.now() - startedAt.getTime();
      ageHours = ageMs / (1000 * 60 * 60);
    }

    // Consider stuck if older than 24 hours
    const status = ageHours > 24 ? 'stuck' : 'in_progress';

    return {
      exists: true,
      status,
      age: Math.round(ageHours * 10) / 10,
      step: data.step as string,
      chatId,
    };
  }

  /**
   * Clean onboarding session only (keep invite code)
   */
  async cleanupOnboardingSession(code: string): Promise<void> {
    const inviteCode = await this.getInviteCode(code);

    if (!inviteCode || !inviteCode.used || !inviteCode.usedBy) {
      throw new Error('Invite code not used or not found');
    }

    const chatId = inviteCode.usedBy.chatId;
    const sessionRef = this.firestore
      .collection(this.ONBOARDING_SESSIONS_COLLECTION)
      .doc(chatId.toString());

    await sessionRef.delete();

    console.log(
      `[InviteCodeService] Cleaned onboarding session for chatId: ${chatId}, code: ${code}`
    );
  }

  /**
   * Delete both invite code and onboarding session
   */
  async deleteCodeAndSession(code: string): Promise<void> {
    const inviteCode = await this.getInviteCode(code);

    if (!inviteCode) {
      throw new Error('Invite code not found');
    }

    const batch = this.firestore.batch();

    // Delete invite code
    const codeRef = this.firestore.collection(this.COLLECTION_NAME).doc(code);
    batch.delete(codeRef);

    // Delete onboarding session if exists
    if (inviteCode.used && inviteCode.usedBy) {
      const chatId = inviteCode.usedBy.chatId;
      const sessionRef = this.firestore
        .collection(this.ONBOARDING_SESSIONS_COLLECTION)
        .doc(chatId.toString());
      batch.delete(sessionRef);
    }

    await batch.commit();

    console.log(`[InviteCodeService] Deleted invite code and session for code: ${code}`);
  }
}
