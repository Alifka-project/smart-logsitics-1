import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../frontend/apiClient';
import { getCurrentUser } from '../../frontend/auth';
import { MessageSquare, Send, RefreshCw, Search, Circle } from 'lucide-react';

export interface ChatContact {
  id: string;
  username?: string;
  fullName?: string;
  full_name?: string;
  account?: { role?: string; lastLogin?: string };
}

interface ChatMsg {
  id: string;
  adminId?: string | null;
  driverId?: string | null;
  content: string;
  senderRole?: string;
  createdAt?: string;
}

interface UsersMessagesPanelProps {
  /** When set (e.g. from "Message" on a user row), selects that contact once */
  focusUserId?: string | null;
  onFocusConsumed?: () => void;
}

function mergeContacts(data: {
  contacts?: ChatContact[];
  teamMembers?: ChatContact[];
  drivers?: ChatContact[];
}): ChatContact[] {
  const map = new Map<string, ChatContact>();
  [...(data.contacts || []), ...(data.teamMembers || []), ...(data.drivers || [])].forEach((c) => {
    if (c?.id && !map.has(String(c.id))) map.set(String(c.id), c);
  });
  return Array.from(map.values()).sort((a, b) =>
    (a.fullName || a.full_name || a.username || '').localeCompare(
      b.fullName || b.full_name || b.username || '',
      undefined,
      { sensitivity: 'base' },
    ),
  );
}

function formatTs(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = Math.abs(now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function roleLabel(role?: string): string {
  if (!role) return 'User';
  if (role === 'delivery_team') return 'Delivery Team';
  if (role === 'sales_ops') return 'Sales Ops';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function UsersMessagesPanel({
  focusUserId,
  onFocusConsumed,
}: UsersMessagesPanelProps): React.ReactElement {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selected, setSelected] = useState<ChatContact | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadContacts = useCallback(async (): Promise<void> => {
    setLoadingContacts(true);
    try {
      const response = await api.get('/messages/contacts');
      const data = response.data as {
        contacts?: ChatContact[];
        teamMembers?: ChatContact[];
        drivers?: ChatContact[];
      };
      setContacts(mergeContacts(data || {}));
    } catch (e) {
      console.error('UsersMessagesPanel: contacts failed', e);
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const loadMessages = useCallback(async (userId: string, silent = false): Promise<void> => {
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/conversations/${userId}`);
      const list = (response.data as { messages?: ChatMsg[] })?.messages || [];
      setMessages(list);
    } catch (e) {
      console.error('UsersMessagesPanel: messages failed', e);
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!focusUserId || loadingContacts) return;
    const match = contacts.find((c) => String(c.id) === String(focusUserId));
    if (match) {
      setSelected(match);
      void loadMessages(match.id);
    }
    onFocusConsumed?.();
  }, [focusUserId, contacts, loadingContacts, loadMessages, onFocusConsumed]);

  useEffect(() => {
    if (!selected?.id) return;
    const t = window.setInterval(() => {
      if (!document.hidden) void loadMessages(selected.id, true);
    }, 30000);
    return () => window.clearInterval(t);
  }, [selected?.id, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = (c.fullName || c.full_name || c.username || '').toLowerCase();
      const un = (c.username || '').toLowerCase();
      return name.includes(q) || un.includes(q);
    });
  }, [contacts, contactSearch]);

  const handleSend = async (): Promise<void> => {
    if (!selected || !newMessage.trim()) return;
    setSending(true);
    try {
      await api.post('/messages/send', {
        driverId: selected.id,
        content: newMessage.trim(),
      });
      setNewMessage('');
      await loadMessages(selected.id, true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      window.alert(e.response?.data?.error || e.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const isMessageMine = (msg: ChatMsg): boolean => {
    const me = getCurrentUser();
    const meId = String(me?.sub || me?.id || '');
    if (meId && String(msg.adminId || '') === meId) return true;
    if (me?.role === 'admin' && msg.senderRole === 'admin') return true;
    return false;
  };

  return (
    <div className="pp-dash-card flex flex-col min-h-[420px] max-h-[min(85vh,900px)] xl:max-h-[calc(100vh-12rem)] overflow-hidden border border-gray-200/80 dark:border-white/[0.08] shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.07] bg-gradient-to-r from-blue-50/80 to-transparent dark:from-blue-950/20">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white tracking-tight">Team messages</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Chat with drivers and staff</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
        {/* Contact list */}
        <div className="w-full sm:w-[42%] sm:max-w-[220px] shrink-0 border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.07] flex flex-col min-h-[140px] sm:min-h-0">
          <div className="p-2 border-b border-gray-100 dark:border-white/[0.07]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="search"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search contacts…"
                className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800/80 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingContacts ? (
              <div className="p-6 text-center text-xs text-gray-500">Loading contacts…</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500">No contacts match</div>
            ) : (
              filteredContacts.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelected(c);
                      void loadMessages(c.id);
                    }}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/40 border-l-2 border-l-blue-600'
                        : 'hover:bg-gray-50 dark:hover:bg-slate-800/60 border-l-2 border-l-transparent'
                    }`}
                  >
                    <Circle
                      className={`w-2 h-2 mt-1.5 shrink-0 ${active ? 'fill-blue-500 text-blue-500' : 'fill-gray-300 text-gray-300'}`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {c.fullName || c.full_name || c.username}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">{roleLabel(c.account?.role)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 flex flex-col min-h-[220px] min-w-0">
          {selected ? (
            <>
              <div className="px-3 py-2 border-b border-gray-100 dark:border-white/[0.07] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {selected.fullName || selected.full_name || selected.username}
                  </div>
                  <div className="text-[10px] text-gray-500">{roleLabel(selected.account?.role)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadMessages(selected.id)}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 shrink-0"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50 dark:bg-slate-900/20">
                {loadingMessages && messages.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-8">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-8">No messages yet — say hello below.</p>
                ) : (
                  messages.map((msg) => {
                    const mine = isMessageMine(msg);
                    return (
                      <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                            mine
                              ? 'bg-blue-600 text-white rounded-br-sm'
                              : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border border-gray-200/80 dark:border-white/10 rounded-bl-sm shadow-sm'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                            {formatTs(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="p-3 border-t border-gray-100 dark:border-white/[0.07] bg-white dark:bg-slate-900/40">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Type a message…"
                    disabled={sending}
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500/35"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !newMessage.trim()}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 p-6 text-center">
              <MessageSquare className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm font-medium">Select a contact</p>
              <p className="text-xs mt-1 max-w-[200px]">Pick someone from the list or use Message on a user row.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
