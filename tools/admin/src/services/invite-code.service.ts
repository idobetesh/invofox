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
}
