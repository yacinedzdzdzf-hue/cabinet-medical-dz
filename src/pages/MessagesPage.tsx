import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, MessageSquare, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { Loading, EmptyState, PageHeader, Badge } from '@/components/ui';
import type { Message, Profile } from '@/types';

export default function MessagesPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [search, setSearch] = useState('');
  const [content, setContent] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const threadRef = useRef<HTMLDivElement>(null);

  const loadUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('active', true)
      .neq('id', profile?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('full_name');
    setUsers((data as Profile[]) ?? []);
  }, [profile?.id]);

  const loadMessages = useCallback(async () => {
    if (!selectedUser || !profile) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${profile.id},recipient_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},recipient_id.eq.${profile.id})`)
      .order('created_at', { ascending: true });
    setMessages((data as Message[]) ?? []);

    // Mark unread messages as read
    const unreadIds = (data as Message[])?.filter((m) => m.recipient_id === profile.id && !m.is_read).map((m) => m.id) ?? [];
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ is_read: true, read_at: new Date().toISOString() }).in('id', unreadIds);
    }
  }, [selectedUser, profile]);

  const loadUnreadCounts = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('messages')
      .select('sender_id')
      .eq('recipient_id', profile.id)
      .eq('is_read', false);
    const counts: Record<string, number> = {};
    (data ?? []).forEach((r: any) => {
      counts[r.sender_id] = (counts[r.sender_id] ?? 0) + 1;
    });
    setUnreadCounts(counts);
  }, [profile]);

  useEffect(() => {
    Promise.all([loadUsers(), loadUnreadCounts()]).finally(() => setLoading(false));
  }, [loadUsers, loadUnreadCounts]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Real-time subscription
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel('messages_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message;
        if (msg.sender_id === selectedUser?.id || msg.recipient_id === profile.id) {
          loadMessages();
        }
        loadUnreadCounts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, selectedUser, loadMessages, loadUnreadCounts]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !selectedUser || !profile) return;
    await supabase.from('messages').insert({
      sender_id: profile.id,
      recipient_id: selectedUser.id,
      content: content.trim(),
      is_read: false,
    });
    await logAudit('message_send', 'message', selectedUser.id, selectedUser.full_name);
    setContent('');
    loadMessages();
    loadUnreadCounts();
  };

  const filteredUsers = users.filter((u) =>
    !search.trim() || u.full_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Messages" subtitle="Messagerie interne entre le personnel" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-200px)]">
        {/* Conversation list */}
        <div className="card p-0 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input pl-10"
                placeholder="Rechercher un utilisateur..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredUsers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Aucun utilisateur</p>
            ) : (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors flex items-center gap-3 ${selectedUser?.id === u.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600 flex-shrink-0">
                    {u.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                  {unreadCounts[u.id] > 0 && (
                    <Badge className="bg-red-100 text-red-700 border-red-200">{unreadCounts[u.id]}</Badge>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message thread */}
        <div className="lg:col-span-2 card p-0 overflow-hidden flex flex-col">
          {!selectedUser ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<MessageSquare className="w-12 h-12" />}
                title="Aucune conversation sélectionnée"
                description="Sélectionnez un utilisateur pour commencer à discuter."
              />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200">
                <p className="font-medium text-gray-900">{selectedUser.full_name}</p>
                <p className="text-xs text-gray-500">{selectedUser.email}</p>
              </div>
              <div ref={threadRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">Aucun message. Démarrez la conversation !</p>
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_id === profile?.id;
                    return (
                      <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${isMine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                          <p className="break-words">{m.content}</p>
                          <p className={`text-xs mt-1 ${isMine ? 'text-blue-200' : 'text-gray-400'}`}>{formatDateTime(m.created_at)}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <form onSubmit={handleSend} className="p-3 border-t border-gray-200 flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Écrivez votre message..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
                <button type="submit" disabled={!content.trim()} className="btn-primary">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
