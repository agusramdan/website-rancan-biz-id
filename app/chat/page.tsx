'use client';

/**
 * Halaman Chat Fullscreen — rancan.biz.id/chat
 *
 * PERILAKU = widget Chatwoot resmi (data 100% via Chatwoot Widget API lewat
 * BFF /api/chat-proxy — bukan penyimpanan lokal):
 *   - sessionId   : crypto.randomUUID, persist di localStorage ('rancan_chat_session')
 *   - kirim pesan : POST /api/chat-proxy {action:'send', sessionId, content}
 *                   → server: POST /api/v1/widget/config (identity) +
 *                     POST /api/v1/widget/messages {website_token, message:{content}}
 *                   → conversation Chatwoot dibuat otomatis bila belum ada
 *                     (assignee AgentBot hermes-cs → dijawab bot via webhook bridge)
 *   - polling     : POST /api/chat-proxy {action:'poll', sessionId}
 *                   → GET /api/v1/widget/messages (X-Auth-Token) → {payload}
 *                   type 0 = pesan pengunjung, 3 = balasan bot (echo),
 *                   1 = balasan agen human, 2 = activity (dibuang).
 *
 * Tampilan ala halaman chat custom sebelumnya: header kecil, area pesan scroll,
 * input box di bawah — tema butik (cream/cocoa/terracotta), Plus Jakarta Sans.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, Send, User } from 'lucide-react';

interface ChatMsg {
  id: number;
  /** 0=pengunjung, 3=bot (echo/template), 1=outgoing (bot ATAU human — lihat senderKind) */
  type: number;
  content: string;
  createdAt: number;
  /** Klasifikasi server: visitor | bot | human (type 1 lebih baru dari stamp bot = human) */
  senderKind?: 'visitor' | 'bot' | 'human';
}

const SESSION_KEY = 'rancan_chat_session';

function timeLabel(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [botOnline, setBotOnline] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const lastLocalEcho = useRef<{ content: string; at: number } | null>(null);
  const [humanActive, setHumanActive] = useState(false);

  /** Balik pesan baru dari polling yang belum dikenal client. */
  const mergeMessages = useCallback(
    (incoming: ChatMsg[]) => {
      if (!incoming.length) return;
      setMessages((prev) => {
        const fresh = incoming.filter((m) => {
          if (seenIds.current.has(m.id)) return false;
          // Dedup echo: pesan outgoing (type 3/1) yang kontennya identik dengan
          // pesan yang baru saja dikirim lokal → lewati (sudah tampil optimis).
          if (
            m.type !== 0 &&
            lastLocalEcho.current &&
            m.content === lastLocalEcho.current.content &&
            Math.abs(m.createdAt - lastLocalEcho.current.at) < 120_000
          ) {
            seenIds.current.add(m.id);
            return false;
          }
          seenIds.current.add(m.id);
          return true;
        });
        if (!fresh.length) return prev;
        return [...prev, ...fresh].sort((a, b) => a.id - b.id);
      });
    },
    [],
  );

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/chat-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll', sessionId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        mergeMessages(data.messages);
        // Human aktif dihitung ULANG tiap poll dari klasifikasi server penuh
        // (type 1 lebih baru dari stamp last_bot_reply_at = agen manusia).
        // Bukan latch: stamp bot terpasang sesaat setelah balasan bot, jadi
        // misklasifikasi transien bisa mengoreksi diri pada poll berikutnya.
        setHumanActive(data.messages.some((m: ChatMsg) => m.senderKind === 'human'));
      }
    } catch {
      // diam — polling berikutnya mencoba lagi
    }
  }, [sessionId, mergeMessages]);

  // Init session + muat riwayat lalu polling pertama.
  useEffect(() => {
    let sid = '';
    try {
      sid = window.localStorage.getItem(SESSION_KEY) || '';
    } catch {
      sid = '';
    }
    if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) {
      sid = crypto.randomUUID();
      try {
        window.localStorage.setItem(SESSION_KEY, sid);
      } catch {
        // private mode tanpa localStorage — session hidup sampai tab ditutup
      }
    }
    setSessionId(sid);
  }, []);

  useEffect(() => {
    if (!sessionId || historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/chat-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', sessionId }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (Array.isArray(data.messages)) {
            data.messages.forEach((m: ChatMsg) => seenIds.current.add(m.id));
            setMessages(data.messages);
            setHumanActive(data.messages.some((m: ChatMsg) => m.senderKind === 'human'));
          }
          setHistoryLoaded(true);
          // Bot dinyatakan "online" — badge murni status koneksi halaman ini.
          setBotOnline(true);
        }
      } catch {
        setBotOnline(false);
        setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, historyLoaded]);

  // Polling periodik balasan (bot echo + human).
  useEffect(() => {
    if (!sessionId || !historyLoaded) return;
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [sessionId, historyLoaded, poll]);

  // Auto-scroll ke bawah saat ada pesan baru.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || !sessionId || sending) return;

    const now = Date.now();
    const optimistic: ChatMsg = { id: -now, type: 0, content, createdAt: now };
    lastLocalEcho.current = { content, at: now };
    setInput('');
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    try {
      const res = await fetch('/api/chat-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', sessionId, content }),
      });
      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, content: `${m.content}\n(gagal terkirim — coba lagi)` } : m)),
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, content: `${m.content}\n(gagal terkirim — coba lagi)` } : m)),
      );
    } finally {
      setSending(false);
    }
  }, [input, sessionId, sending]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className="flex flex-col h-[100dvh] bg-cream"
      style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}
    >
      {/* Header kecil */}
      <header className="shrink-0 bg-white/95 backdrop-blur border-b border-cocoa-200 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              aria-label="Kembali ke beranda"
              className="w-9 h-9 shrink-0 rounded-full bg-cream-dark border border-cocoa-200 flex items-center justify-center text-cocoa-800 hover:bg-cocoa-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="w-10 h-10 shrink-0 rounded-full bg-cocoa-900 flex items-center justify-center text-white">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-cocoa-900 leading-tight truncate">CS Rancan</h1>
              <p className="flex items-center gap-1.5 text-xs text-cocoa-600">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${botOnline ? 'bg-green-500' : 'bg-stone-400'}`}
                />
                {botOnline ? 'Online' : 'Menyambungkan…'}
              </p>
            </div>
          </div>

          {/* Badge mode pelayan */}
          {humanActive ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-terracotta-light border border-terracotta/30 text-terracotta text-xs font-semibold">
              <User className="w-3.5 h-3.5" />
              Dilayani tim Rancan
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cream-dark border border-cocoa-200 text-cocoa-600 text-xs font-semibold">
              <Bot className="w-3.5 h-3.5" />
              Bot Rancan
            </span>
          )}
        </div>
      </header>

      {/* Area pesan */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-3">
          <div className="text-center pt-2 pb-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-cocoa-200 shadow-sm text-xs text-cocoa-600">
              <Bot className="w-4 h-4 text-terracotta" />
              Halo! Tanya menu, reservasi, atau katering — bot Rancan siap membantu 24/7.
            </div>
          </div>

          {messages.map((m) => {
            if (m.senderKind === 'visitor' || m.type === 0) {
              // Pengunjung (kanan)
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] sm:max-w-[70%]">
                    <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-terracotta text-white shadow-sm whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                    <div className="text-[10px] text-cocoa-300 text-right mt-1 pr-1">{timeLabel(m.createdAt)}</div>
                  </div>
                </div>
              );
            }
            // Bot (senderKind 'bot' — termasuk type 1 dari bridge) atau agen human (kiri)
            const isHuman = m.senderKind === 'human';
            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[80%] sm:max-w-[70%]">
                  <div
                    className={`px-4 py-2.5 rounded-2xl rounded-bl-md shadow-sm whitespace-pre-wrap break-words ${
                      isHuman ? 'bg-white border border-terracotta/40' : 'bg-white border border-cocoa-200'
                    } text-cocoa-900`}
                  >
                    {m.content}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-cocoa-300 mt-1 pl-1">
                    {isHuman ? (
                      <User className="w-3 h-3" />
                    ) : (
                      <Bot className="w-3 h-3" />
                    )}
                    {isHuman ? 'Tim Rancan' : 'Bot Rancan'} · {timeLabel(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input box */}
      <footer className="shrink-0 bg-white/95 backdrop-blur border-t border-cocoa-200 px-4 sm:px-6 py-3">
        <form
          className="max-w-3xl mx-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Tulis pesan…"
            aria-label="Pesan"
            maxLength={4000}
            autoComplete="off"
            className="flex-1 h-12 px-4 rounded-xl bg-cream-dark border border-cocoa-200 text-cocoa-900 placeholder:text-cocoa-300 outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta transition"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="Kirim pesan"
            className="w-12 h-12 shrink-0 rounded-xl bg-terracotta text-white flex items-center justify-center shadow-sm hover:bg-terracotta-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <p className="max-w-3xl mx-auto text-center text-[10px] text-cocoa-300 mt-2">
          Ditenagai Chatwoot · percakapan ini tersambung ke inbox CS Rancan
        </p>
      </footer>
    </div>
  );
}
