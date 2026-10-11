/**
 * BFF Chatwoot Widget untuk halaman /chat (fullscreen) — menghindari CORS &
 * menyembunyikan URL Chatwoot internal dari browser.
 *
 * Perilaku identik widget Chatwoot resmi (spec docs/HANDOVER-SPEC.md §1):
 *   action 'send' : POST /api/v1/widget/config (identity per session, cache server
 *                   20 hari via lib/chatwoot.ts) → POST /api/v1/widget/messages
 *                   {website_token, message:{content}} dengan header X-Auth-Token (JWT).
 *                   Conversation dibuat otomatis oleh Chatwoot bila belum ada
 *                   (status pending, assignee AgentBot hermes-cs).
 *   action 'poll' : GET /api/v1/widget/messages (X-Auth-Token) → seluruh payload:
 *                   type 0 = incoming (pesan pengunjung), 1 = outgoing (balasan human),
 *                   3 = template/echo bot, 2 = activity (dibuang di lib).
 *
 * Identitas per session: sessionId dibuat client (crypto.randomUUID, localStorage)
 * dan dipetakan ke JWT widget di cache server (lib/chatwoot.ts). Tidak ada data
 * percakapan yang disimpan di website — semuanya milik Chatwoot.
 *
 * Catatan: bot hermes-cs membalas via webhook bridge (type 3 + sender null);
 * balasan human = type 1 + sender.type 'user'.
 */

import { NextResponse } from 'next/server';
import { syncVisitorMessage, fetchWidgetConversation } from '@/lib/chatwoot';

export const dynamic = 'force-dynamic';

interface SendBody {
  action: 'send';
  sessionId: string;
  content: string;
}

interface PollBody {
  action: 'poll';
  sessionId: string;
}

type ProxyBody = SendBody | PollBody;

function cleanSession(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  // Hanya terima format UUID (crypto.randomUUID) — hindari key cache liar.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

export async function POST(request: Request) {
  let body: ProxyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const sessionId = cleanSession(body?.sessionId);
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId wajib berupa UUID' }, { status: 400 });
  }

  if (body.action === 'send') {
    const content = String(body.content || '').trim();
    if (!content) {
      return NextResponse.json({ error: 'Pesan kosong' }, { status: 400 });
    }
    if (content.length > 4000) {
      return NextResponse.json({ error: 'Pesan terlalu panjang (maks 4000 karakter)' }, { status: 400 });
    }

    // ensureWidgetIdentity + POST /api/v1/widget/messages di dalam lib.
    await syncVisitorMessage(sessionId, content);
    // Selalu 200 agar UX tidak "gagal" saat Chatwoot sesaat tidak reachable;
    // pesan muncul di /chat secara optimis dan tercatat ke inbox begitu Chatwoot pulih.
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (body.action === 'poll') {
    const messages = await fetchWidgetConversation(sessionId);
    return NextResponse.json(
      {
        messages: messages || [],
        hasConversation: messages !== null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ error: 'action tidak dikenal' }, { status: 400 });
}
