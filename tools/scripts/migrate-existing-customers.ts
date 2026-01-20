/**
 * Migration Script: Grandfather Existing Customers
 *
 * Adds all existing customers (with business_config) to approved_chats
 * so they can continue using the bot after invite code system is deployed.
 *
 * Usage:
 *   cd tools/scripts
 *   npx ts-node migrate-existing-customers.ts
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';

const firestore = new Firestore();

interface ApprovedChat {
  chatId: number;
  chatTitle: string;
  approvedAt: any;
  approvedBy: {
    method: 'migration';
    note: string;
  };
  status: 'active';
}

async function migrateExistingCustomers() {
  console.log('🚀 Starting migration of existing customers...\n');

  try {
    // Find all chats with business_config
    const configsSnapshot = await firestore
      .collection('business_config')
      .get();

    console.log(`📊 Found ${configsSnapshot.size} existing customers\n`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of configsSnapshot.docs) {
      try {
        // Extract chatId from document ID (format: "chat_12345" or just "12345")
        const docId = doc.id;
        const chatId = docId.startsWith('chat_')
          ? parseInt(docId.replace('chat_', ''))
          : parseInt(docId);

        if (isNaN(chatId)) {
          console.log(`⚠️  Skipping invalid doc ID: ${docId}`);
          skipped++;
          continue;
        }

        const businessData = doc.data();
        const businessName = businessData?.business?.name || 'Unknown Business';

        // Check if already approved
        const approvedDoc = await firestore
          .collection('approved_chats')
          .doc(String(chatId))
          .get();

        if (approvedDoc.exists) {
          console.log(`⏭️  Chat ${chatId} (${businessName}) - Already approved, skipping`);
          skipped++;
          continue;
        }

        // Create approved_chat entry
        const approvedChat: ApprovedChat = {
          chatId,
          chatTitle: businessName,
          approvedAt: FieldValue.serverTimestamp(),
          approvedBy: {
            method: 'migration',
            note: 'Existing customer before invite code system',
          },
          status: 'active',
        };

        await firestore
          .collection('approved_chats')
          .doc(String(chatId))
          .set(approvedChat);

        console.log(`✅ Chat ${chatId} (${businessName}) - Migrated successfully`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating ${doc.id}:`, error);
        failed++;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Migration Summary:');
    console.log(`   ✅ Migrated:  ${migrated}`);
    console.log(`   ⏭️  Skipped:   ${skipped}`);
    console.log(`   ❌ Failed:    ${failed}`);
    console.log(`   📊 Total:     ${configsSnapshot.size}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (failed > 0) {
      console.warn('⚠️  Some migrations failed. Check the logs above.');
      process.exit(1);
    }

    console.log('✨ Migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('💥 Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run migration
migrateExistingCustomers();
