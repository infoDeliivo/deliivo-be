'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { chatApi, ChatMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { featureFlags } from '@/lib/features';

function ChatConversationContent() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (conversationId) loadMessages(); }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadMessages() {
    setLoading(true);
    try {
      const res = await chatApi.getMessages(conversationId);
      setMessages((res.data.messages || []).reverse());
      // Mark as read
      const lastMsg = res.data.messages?.[0];
      if (lastMsg && lastMsg.senderId !== user?.id) {
        chatApi.markRead(conversationId, lastMsg.id).catch(() => {});
      }
    } catch { /* empty */ }
    finally { setLoading(false); }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;

    const clientMsgId = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msgText = text.trim();
    setText('');
    setSending(true);

    // Optimistic update
    const optimistic: ChatMessage = {
      id: clientMsgId,
      conversationId,
      senderId: user?.id || '',
      receiverId: '',
      type: 'TEXT',
      text: msgText,
      clientMsgId,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      // We need the receiverId — we can get it from existing messages
      const peer = messages.find(m => m.senderId !== user?.id);
      const receiverId = peer?.senderId || '';
      if (receiverId) {
        const res = await chatApi.sendMessage(receiverId, msgText, clientMsgId);
        // Replace optimistic with real
        setMessages(prev => prev.map(m => m.id === clientMsgId ? res.data : m));
      }
    } catch {
      // Keep optimistic message but could mark as failed
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-deliivo-cream">
      {/* Header */}
      <header className="bg-white border-b border-orange-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href="/chat" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-semibold text-gray-900">Chat</h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-deliivo-orange" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-sm text-deliivo-gray">No messages yet. Say hello!</div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === user?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? 'bg-deliivo-orange text-white rounded-br-md' : 'bg-white text-deliivo-dark rounded-bl-md shadow-sm'}`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? 'text-white/60' : 'text-deliivo-gray'}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-deliivo-orange text-white hover:bg-orange-600 disabled:opacity-40 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export default function ChatConversationPage() {
  return (
    <ProtectedRoute>
      {featureFlags.webChat ? (
        <ChatConversationContent />
      ) : (
        <div className="min-h-screen bg-deliivo-cream">
          <header className="bg-white border-b border-orange-100 px-4 py-3 flex items-center gap-3">
            <Link href="/rides" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange">
              <ArrowLeft className="w-4 h-4" /> Rides
            </Link>
            <h1 className="text-base font-semibold text-gray-900">Messages unavailable</h1>
          </header>
          <main className="mx-auto max-w-2xl px-4 py-10">
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="text-base font-semibold text-deliivo-dark">Web messages are disabled</p>
              <p className="mt-2 text-sm text-deliivo-gray">
                Use ride details and notifications for booking and ride-day updates.
              </p>
              <Link href="/rides" className="btn-primary mt-5 inline-flex px-6 py-2.5 text-sm">
                Back to rides
              </Link>
            </div>
          </main>
        </div>
      )}
    </ProtectedRoute>
  );
}
