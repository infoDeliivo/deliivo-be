'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Loader2 } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { chatApi, ConversationItem } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { featureFlags } from '@/lib/features';

function ChatDisabled() {
  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/rides" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange">
          <ArrowLeft className="w-4 h-4" /> Rides
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Messages</h1>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="bg-white rounded-2xl shadow-sm p-8 flex flex-col items-center gap-3 text-center">
          <MessageSquare className="w-12 h-12 text-orange-200" />
          <p className="text-base font-semibold text-deliivo-dark">Web messages are not available yet</p>
          <p className="text-sm text-deliivo-gray">
            Ride updates, booking decisions, and safety alerts are handled through notifications and ride detail screens for now.
          </p>
          <Link href="/rides" className="btn-primary mt-3 px-6 py-2.5 text-sm">
            Back to rides
          </Link>
        </div>
      </main>
    </div>
  );
}

function ChatListContent() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadConversations(); }, []);

  async function loadConversations() {
    try {
      const res = await chatApi.getConversations();
      setConversations(res.data.conversations || []);
    } catch { /* empty */ }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange">
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Messages</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <MessageSquare className="w-12 h-12 text-orange-200" />
            <p className="text-gray-500 text-sm">No conversations yet.</p>
            <p className="text-xs text-deliivo-gray">Messages with drivers and riders will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.map(conv => {
              const isMe = conv.lastMessage?.senderId === user?.id;
              const preview = conv.lastMessage?.text || (conv.lastMessage?.type === 'IMAGE' ? 'Sent an image' : '');
              const time = conv.lastMessage?.createdAt ? new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

              return (
                <Link key={conv.id} href={`/chat/${conv.id}`} className="block">
                  <div className="bg-white rounded-xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
                    <div className="h-11 w-11 shrink-0 rounded-full bg-primary-100 flex items-center justify-center">
                      <span className="text-sm font-semibold text-primary-600">
                        {(conv.peer.name || '?').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-deliivo-dark truncate">{conv.peer.name || 'User'}</p>
                        <span className="text-xs text-deliivo-gray shrink-0">{time}</span>
                      </div>
                      <p className="text-xs text-deliivo-gray truncate mt-0.5">
                        {isMe ? 'You: ' : ''}{preview}
                      </p>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-deliivo-orange text-[10px] font-bold text-white shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <ProtectedRoute>
      {featureFlags.webChat ? <ChatListContent /> : <ChatDisabled />}
    </ProtectedRoute>
  );
}
