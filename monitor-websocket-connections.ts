/**
 * Real-time WebSocket Connection Monitor
 * 
 * This script monitors active WebSocket connections and shows
 * which users are currently connected.
 * 
 * Usage:
 *   npx tsx monitor-websocket-connections.ts
 */

import { getIO, getUserSocketIds } from './src/socket/index.js';
import { prisma } from './src/config/index.js';

async function monitorConnections() {
    console.log('🔍 WebSocket Connection Monitor');
    console.log('================================');
    console.log('');

    // Check Socket.IO instance
    const io = getIO();
    if (!io) {
        console.error('❌ Socket.IO instance not available!');
        console.error('   Make sure the server is running');
        process.exit(1);
    }

    console.log('✅ Socket.IO instance is available');
    console.log('');

    // Get all connected sockets
    const sockets = await io.fetchSockets();
    console.log(`📡 Total active connections: ${sockets.length}`);
    console.log('');

    if (sockets.length === 0) {
        console.log('📴 No users currently connected');
        return;
    }

    // Group by user
    const userConnections = new Map<string, string[]>();
    
    for (const socket of sockets) {
        const userId = (socket as any).userId;
        if (userId) {
            if (!userConnections.has(userId)) {
                userConnections.set(userId, []);
            }
            userConnections.get(userId)!.push(socket.id);
        }
    }

    console.log(`👥 Unique users connected: ${userConnections.size}`);
    console.log('');

    // Fetch user details
    const userIds = Array.from(userConnections.keys());
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
        },
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    // Display connections
    console.log('Connected Users:');
    console.log('================');
    
    for (const [userId, socketIds] of userConnections.entries()) {
        const user = userMap.get(userId);
        
        console.log('');
        console.log(`👤 User ID: ${userId}`);
        if (user) {
            console.log(`   Name: ${user.name || 'N/A'}`);
            console.log(`   Email: ${user.email || 'N/A'}`);
            console.log(`   Phone: ${user.phone || 'N/A'}`);
        }
        console.log(`   Connections: ${socketIds.length}`);
        socketIds.forEach((sid, idx) => {
            console.log(`   ${idx + 1}. Socket ID: ${sid}`);
        });
    }

    console.log('');
    console.log('');
    console.log('💡 Tips:');
    console.log('   - Multiple connections per user = multiple devices/tabs');
    console.log('   - To test notification: npx tsx test-websocket-notification.ts <user-id>');
    console.log('   - To monitor in real-time: watch -n 2 "npx tsx monitor-websocket-connections.ts"');
}

monitorConnections().catch((error) => {
    console.error('❌ Monitor failed:', error);
    process.exit(1);
});
