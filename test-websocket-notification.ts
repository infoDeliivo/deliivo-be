/**
 * Test script to manually trigger a notification and verify WebSocket delivery
 * 
 * Usage:
 *   npx tsx test-websocket-notification.ts <userId>
 * 
 * This will:
 * 1. Create a test notification for the user
 * 2. Check if user is connected via WebSocket
 * 3. Verify notification was sent
 */

import { createNotification } from './src/modules/notification/notification.service.js';
import { getIO, getUserSocketIds } from './src/socket/index.js';

const testUserId = process.argv[2];

if (!testUserId) {
    console.error('❌ Usage: npx tsx test-websocket-notification.ts <userId>');
    process.exit(1);
}

async function testNotification() {
    console.log('🧪 Testing WebSocket Notification');
    console.log('==================================');
    console.log(`Target User ID: ${testUserId}`);
    console.log('');

    // Check Socket.IO instance
    console.log('1️⃣ Checking Socket.IO instance...');
    const io = getIO();
    if (!io) {
        console.error('❌ Socket.IO instance not available!');
        console.error('   Make sure the server is running and WebSocket is initialized');
        process.exit(1);
    }
    console.log('✅ Socket.IO instance is available');
    console.log('');

    // Check user connections
    console.log('2️⃣ Checking user WebSocket connections...');
    const socketIds = getUserSocketIds(testUserId);
    console.log(`📡 User has ${socketIds.length} active connection(s)`);
    if (socketIds.length > 0) {
        console.log(`   Socket IDs: ${socketIds.join(', ')}`);
    } else {
        console.warn('⚠️  User is not connected via WebSocket');
        console.warn('   Notification will be saved to DB but not delivered in real-time');
    }
    console.log('');

    // Create test notification
    console.log('3️⃣ Creating test notification...');
    try {
        const notification = await createNotification({
            userId: testUserId,
            type: 'test.notification',
            title: 'Test Notification',
            body: 'This is a test notification to verify WebSocket delivery',
            data: {
                testId: Date.now().toString(),
                source: 'test-script',
            },
        });

        console.log('✅ Notification created successfully');
        console.log(`   Notification ID: ${notification.id}`);
        console.log(`   Created at: ${notification.createdAt}`);
        console.log('');

        if (socketIds.length > 0) {
            console.log('✅ Notification should have been delivered via WebSocket');
            console.log('   Check the client app to verify it received the notification');
        } else {
            console.log('📴 User is offline - notification saved to database only');
            console.log('   User will see it when they reconnect and fetch notifications');
        }
    } catch (error) {
        console.error('❌ Failed to create notification:', error);
        process.exit(1);
    }

    console.log('');
    console.log('🎉 Test completed');
}

testNotification().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
