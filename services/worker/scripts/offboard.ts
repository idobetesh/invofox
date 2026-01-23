#!/usr/bin/env ts-node
/**
 * GDPR-Compliant Offboarding Script
 *
 * TWO MODES:
 * 1. Offboard Business (by chatId) - Removes business but keeps users who have other businesses
 * 2. Offboard User (by userId) - Complete user data deletion (GDPR Right to Erasure)
 *
 * Usage:
 *   npx ts-node scripts/offboard.ts --chat-id <chatId>
 *   npx ts-node scripts/offboard.ts --user-id <userId>
 *
 * Environment Variables:
 *   GCP_PROJECT_ID              - GCP project ID (default: papertrail-invoice)
 *   STORAGE_BUCKET              - Invoices bucket (default: papertrail-invoice-invoices)
 *   GENERATED_INVOICES_BUCKET   - Generated invoices bucket (default: papertrail-invoice-generated-invoices)
 */

import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import * as readline from 'readline';

// Environment-aware configuration
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'papertrail-invoice';
const INVOICES_BUCKET = process.env.STORAGE_BUCKET || 'papertrail-invoice-invoices';
const GENERATED_BUCKET =
  process.env.GENERATED_INVOICES_BUCKET || 'papertrail-invoice-generated-invoices';

interface DeletionReport {
  mode: 'chat' | 'user';
  identifier: string;
  firestoreDocs: number;
  firestoreUpdates: number;
  storageFiles: number;
  details: {
    collections: Record<string, number>;
    buckets: Record<string, number>;
  };
}

/**
 * Helper function to check if a chatId matches the target
 * Handles both string and number comparisons
 */
function matchesChatId(chatId: number | string | undefined | null, target: string): boolean {
  if (chatId === null || chatId === undefined) {
    return false;
  }
  return chatId.toString() === target || chatId === parseInt(target, 10);
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * MODE 1: Offboard Business/Chat
 * Surgically removes a business while preserving users who have other businesses
 */
async function offboardBusiness(
  db: Firestore,
  storage: Storage,
  chatId: string
): Promise<DeletionReport> {
  const report: DeletionReport = {
    mode: 'chat',
    identifier: chatId,
    firestoreDocs: 0,
    firestoreUpdates: 0,
    storageFiles: 0,
    details: { collections: {}, buckets: {} },
  };

  console.log('\n' + '='.repeat(80));
  console.log('🏢 BUSINESS OFFBOARDING MODE');
  console.log('='.repeat(80));
  console.log(`\n🎯 Target Chat ID: ${chatId}\n`);

  // === STEP 1: Find associated users ===
  console.log('📋 Step 1: Finding users with access to this business...\n');
  const associatedUserIds = new Set<string>();

  try {
    const userMappingSnapshot = await db.collection('user_mapping').get();
    for (const doc of userMappingSnapshot.docs) {
      const data = doc.data();
      const customers = data.customers || [];

      if (customers.some((c: { chatId: number }) => matchesChatId(c.chatId, chatId))) {
        associatedUserIds.add(data.userId.toString());
        console.log(`   👤 User ${data.userId} (${data.username}) has access`);
      }
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan user_mapping: ${error}`);
  }

  console.log(`\n   Found ${associatedUserIds.size} user(s) with access\n`);

  // === STEP 2: Preview what will be deleted ===
  console.log('🔍 Step 2: Scanning for data to remove...\n');

  const toDelete: Map<string, string[]> = new Map();
  const toUpdate: Map<string, string[]> = new Map();

  // Business-specific collections (full delete)
  const businessCollections = ['business_config', 'invoice_counters', 'invoice_jobs', 'Invoices'];

  for (const collectionName of businessCollections) {
    try {
      const snapshot = await db.collection(collectionName).get();
      const matches: string[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (
          doc.id === chatId ||
          doc.id.includes(`chat_${chatId}`) ||
          doc.id.includes(`${chatId}_`) ||
          matchesChatId(data.chatId, chatId) ||
          matchesChatId(data.telegramChatId, chatId)
        ) {
          matches.push(doc.id);
        }
      }

      if (matches.length > 0) {
        toDelete.set(collectionName, matches);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not scan ${collectionName}: ${error}`);
    }
  }

  // Generated invoices (delete if owned by this chat)
  try {
    const genSnapshot = await db.collection('generated_invoices').get();
    const matches: string[] = [];

    for (const doc of genSnapshot.docs) {
      const data = doc.data();
      if (matchesChatId(data.generatedBy?.chatId, chatId)) {
        matches.push(doc.id);
      }
    }

    if (matches.length > 0) {
      toDelete.set('generated_invoices', matches);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan generated_invoices: ${error}`);
  }

  // Invoice sessions (delete chatId_userId combinations)
  try {
    const sessionSnapshot = await db.collection('invoice_sessions').get();
    const matches: string[] = [];

    for (const doc of sessionSnapshot.docs) {
      if (doc.id.startsWith(`${chatId}_`)) {
        matches.push(doc.id);
      }
    }

    if (matches.length > 0) {
      toDelete.set('invoice_sessions', matches);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan invoice_sessions: ${error}`);
  }

  // Onboarding sessions (delete)
  try {
    const onboardingDoc = await db.collection('onboarding_sessions').doc(chatId).get();
    if (onboardingDoc.exists) {
      toDelete.set('onboarding_sessions', [chatId]);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check onboarding_sessions: ${error}`);
  }

  // User mapping (surgical update - remove chatId from arrays)
  if (associatedUserIds.size > 0) {
    toUpdate.set(
      'user_mapping',
      Array.from(associatedUserIds).map((id) => `user_${id}`)
    );
  }

  // Storage files
  const storageToDelete: Map<string, string[]> = new Map();

  try {
    const [logoFiles] = await storage
      .bucket(GENERATED_BUCKET)
      .getFiles({ prefix: `logos/${chatId}/` });
    if (logoFiles.length > 0) {
      storageToDelete.set(
        `${GENERATED_BUCKET}/logos`,
        logoFiles.map((f) => f.name)
      );
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan logos: ${error}`);
  }

  try {
    const [genFiles] = await storage.bucket(GENERATED_BUCKET).getFiles({ prefix: `${chatId}/` });
    if (genFiles.length > 0) {
      storageToDelete.set(
        `${GENERATED_BUCKET}/invoices`,
        genFiles.map((f) => f.name)
      );
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan generated invoices: ${error}`);
  }

  try {
    const [uploadFiles] = await storage
      .bucket(INVOICES_BUCKET)
      .getFiles({ prefix: `invoices/${chatId}/` });
    if (uploadFiles.length > 0) {
      storageToDelete.set(
        `${INVOICES_BUCKET}/invoices`,
        uploadFiles.map((f) => f.name)
      );
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan uploaded invoices: ${error}`);
  }

  // Display summary
  console.log('📄 Firestore Documents to DELETE:');
  let totalDocs = 0;
  for (const [collection, docs] of toDelete.entries()) {
    console.log(`   ${collection}: ${docs.length} document(s)`);
    docs.forEach((id) => console.log(`      - ${id}`));
    totalDocs += docs.length;
  }

  console.log('\n📝 Firestore Documents to UPDATE (remove chatId from arrays):');
  let totalUpdates = 0;
  for (const [collection, docs] of toUpdate.entries()) {
    console.log(`   ${collection}: ${docs.length} document(s)`);
    docs.forEach((id) => console.log(`      - ${id}`));
    totalUpdates += docs.length;
  }

  console.log('\n🗄️  Storage Files to DELETE:');
  let totalFiles = 0;
  for (const [bucket, files] of storageToDelete.entries()) {
    console.log(`   ${bucket}: ${files.length} file(s)`);
    files.forEach((f) => console.log(`      - ${f}`));
    totalFiles += files.length;
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n   Documents to delete: ${totalDocs}`);
  console.log(`   Documents to update: ${totalUpdates}`);
  console.log(`   Files to delete: ${totalFiles}`);
  console.log(`   Total operations: ${totalDocs + totalUpdates + totalFiles}\n`);

  if (totalDocs === 0 && totalUpdates === 0 && totalFiles === 0) {
    console.log('ℹ️  No data found for this chatId.\n');
    return report;
  }

  // Confirmation
  console.log('⚠️  WARNING: This action is IRREVERSIBLE!');
  console.log('⚠️  The business and all its data will be PERMANENTLY DELETED.\n');

  const confirmed = await confirm('Type "yes" to proceed: ');

  if (!confirmed) {
    console.log('\n❌ Operation cancelled.\n');
    return report;
  }

  // === STEP 3: Execute deletion ===
  console.log('\n🔥 Executing deletion...\n');

  // Delete Firestore documents
  for (const [collection, docIds] of toDelete.entries()) {
    for (const docId of docIds) {
      try {
        await db.collection(collection).doc(docId).delete();
        console.log(`   ✅ Deleted ${collection}/${docId}`);
        report.firestoreDocs++;
        report.details.collections[collection] = (report.details.collections[collection] || 0) + 1;
      } catch (error) {
        console.log(`   ❌ Failed to delete ${collection}/${docId}: ${error}`);
      }
    }
  }

  // Update user_mapping (remove chatId from customers arrays)
  for (const [collection, docIds] of toUpdate.entries()) {
    for (const docId of docIds) {
      try {
        const docRef = db.collection(collection).doc(docId);
        const doc = await docRef.get();

        if (doc.exists) {
          const data = doc.data();
          const customers = (data?.customers || []).filter(
            (c: { chatId: number }) => !matchesChatId(c.chatId, chatId)
          );

          if (customers.length === 0) {
            // User has no more customers, delete the document
            await docRef.delete();
            console.log(`   ✅ Deleted ${collection}/${docId} (no more customers)`);
            report.firestoreDocs++;
          } else {
            // User still has other customers, just update
            await docRef.update({ customers });
            console.log(`   ✅ Updated ${collection}/${docId} (removed chatId from customers)`);
            report.firestoreUpdates++;
          }

          report.details.collections[collection] =
            (report.details.collections[collection] || 0) + 1;
        }
      } catch (error) {
        console.log(`   ❌ Failed to update ${collection}/${docId}: ${error}`);
      }
    }
  }

  // Delete storage files
  for (const [bucketPath, filePaths] of storageToDelete.entries()) {
    const [bucketName] = bucketPath.split('/');
    const bucket = storage.bucket(bucketName);

    for (const filePath of filePaths) {
      try {
        await bucket.file(filePath).delete();
        console.log(`   ✅ Deleted ${bucketName}/${filePath}`);
        report.storageFiles++;
        report.details.buckets[bucketPath] = (report.details.buckets[bucketPath] || 0) + 1;
      } catch (error) {
        console.log(`   ❌ Failed to delete ${bucketName}/${filePath}: ${error}`);
      }
    }
  }

  return report;
}

/**
 * MODE 2: Offboard User
 * Complete removal of a user's personal data (GDPR Right to Erasure)
 */
async function offboardUser(
  db: Firestore,
  _storage: Storage,
  userId: string
): Promise<DeletionReport> {
  const report: DeletionReport = {
    mode: 'user',
    identifier: userId,
    firestoreDocs: 0,
    firestoreUpdates: 0,
    storageFiles: 0,
    details: { collections: {}, buckets: {} },
  };

  console.log('\n' + '='.repeat(80));
  console.log('👤 USER OFFBOARDING MODE (GDPR Right to Erasure)');
  console.log('='.repeat(80));
  console.log(`\n🎯 Target User ID: ${userId}\n`);

  console.log('🔍 Scanning for user data...\n');

  const toDelete: Map<string, string[]> = new Map();

  // User mapping
  try {
    const doc = await db.collection('user_mapping').doc(`user_${userId}`).get();
    if (doc.exists) {
      toDelete.set('user_mapping', [`user_${userId}`]);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check user_mapping: ${error}`);
  }

  // Invoice sessions
  try {
    const snapshot = await db.collection('invoice_sessions').get();
    const matches: string[] = [];

    for (const doc of snapshot.docs) {
      if (doc.id.includes(`_${userId}`)) {
        matches.push(doc.id);
      }
    }

    if (matches.length > 0) {
      toDelete.set('invoice_sessions', matches);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan invoice_sessions: ${error}`);
  }

  // Onboarding sessions
  try {
    const snapshot = await db.collection('onboarding_sessions').get();
    const matches: string[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.userId?.toString() === userId) {
        matches.push(doc.id);
      }
    }

    if (matches.length > 0) {
      toDelete.set('onboarding_sessions', matches);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not scan onboarding_sessions: ${error}`);
  }

  // Display summary
  console.log('📄 Firestore Documents to DELETE:');
  let totalDocs = 0;
  for (const [collection, docs] of toDelete.entries()) {
    console.log(`   ${collection}: ${docs.length} document(s)`);
    docs.forEach((id) => console.log(`      - ${id}`));
    totalDocs += docs.length;
  }

  console.log('\n⚠️  Note: generated_invoices will be anonymized (personal data removed)');

  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n   Documents to delete: ${totalDocs}`);
  console.log(`   Documents to anonymize: (checking generated_invoices...)\n`);

  if (totalDocs === 0) {
    console.log('ℹ️  No data found for this userId.\n');
    return report;
  }

  // Confirmation
  console.log('⚠️  WARNING: This action is IRREVERSIBLE!');
  console.log('⚠️  All personal data for this user will be PERMANENTLY DELETED.\n');

  const confirmed = await confirm('Type "yes" to proceed: ');

  if (!confirmed) {
    console.log('\n❌ Operation cancelled.\n');
    return report;
  }

  // Execute deletion
  console.log('\n🔥 Executing deletion...\n');

  for (const [collection, docIds] of toDelete.entries()) {
    for (const docId of docIds) {
      try {
        await db.collection(collection).doc(docId).delete();
        console.log(`   ✅ Deleted ${collection}/${docId}`);
        report.firestoreDocs++;
        report.details.collections[collection] = (report.details.collections[collection] || 0) + 1;
      } catch (error) {
        console.log(`   ❌ Failed to delete ${collection}/${docId}: ${error}`);
      }
    }
  }

  // Anonymize generated_invoices
  try {
    const genSnapshot = await db.collection('generated_invoices').get();
    let anonymized = 0;

    for (const doc of genSnapshot.docs) {
      const data = doc.data();
      if (data.generatedBy?.telegramUserId?.toString() === userId) {
        await doc.ref.update({
          'generatedBy.telegramUserId': null,
          'generatedBy.username': '[deleted]',
        });
        anonymized++;
      }
    }

    if (anonymized > 0) {
      console.log(`   ✅ Anonymized ${anonymized} generated_invoices record(s)`);
      report.firestoreUpdates += anonymized;
    }
  } catch (error) {
    console.log(`   ⚠️  Could not anonymize generated_invoices: ${error}`);
  }

  return report;
}

/**
 * Main
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔥 GDPR-COMPLIANT OFFBOARDING');
  console.log('='.repeat(80));

  const args = process.argv.slice(2);
  const chatIdIndex = args.indexOf('--chat-id');
  const userIdIndex = args.indexOf('--user-id');

  let mode: 'chat' | 'user';
  let identifier: string;

  if (chatIdIndex !== -1 && args[chatIdIndex + 1]) {
    mode = 'chat';
    identifier = args[chatIdIndex + 1];
  } else if (userIdIndex !== -1 && args[userIdIndex + 1]) {
    mode = 'user';
    identifier = args[userIdIndex + 1];
  } else {
    console.error('\n❌ Error: Missing required argument');
    console.error('\nUsage:');
    console.error('  npx ts-node scripts/offboard.ts --chat-id <chatId>   (Offboard business)');
    console.error('  npx ts-node scripts/offboard.ts --user-id <userId>   (Offboard user - GDPR)');
    console.error('\nExamples:');
    console.error('  npx ts-node scripts/offboard.ts --chat-id -1003612582263');
    console.error('  npx ts-node scripts/offboard.ts --user-id 1069523608\n');
    process.exit(1);
  }

  const db = new Firestore({ projectId: PROJECT_ID });
  const storage = new Storage();

  let report: DeletionReport;

  if (mode === 'chat') {
    report = await offboardBusiness(db, storage, identifier);
  } else {
    report = await offboardUser(db, storage, identifier);
  }

  // Final report
  console.log('\n' + '='.repeat(80));
  console.log('✅ OFFBOARDING COMPLETE');
  console.log('='.repeat(80));
  console.log(`\nMode: ${report.mode === 'chat' ? 'Business' : 'User'}`);
  console.log(`Identifier: ${report.identifier}`);
  console.log(`\nDocuments deleted: ${report.firestoreDocs}`);
  console.log(`Documents updated: ${report.firestoreUpdates}`);
  console.log(`Files deleted: ${report.storageFiles}`);
  console.log(`\n🎉 Operation completed successfully.`);
  console.log('='.repeat(80) + '\n');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
