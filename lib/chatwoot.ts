/**
 * Helper Chatwoot — hybrid handover + takeover guard.
 * Spec: docs/HANDOVER-SPEC.md (§1 temuan API, §2 arsitektur, §3 kontrak).
 *
 * Semua state in-memory (container tunggal `rancan-website`):
 *  - identityCache     : JWT widget + source_id per session (TTL 20 hari; refresh bila 401)
 *  - conversationCache : session → conversation_id Chatwoot (TTL 1 jam)
 *  - takeoverCache     : hasil humanActive() per session (TTL TAKEOVER_CACHE_TTL_MS, default 8 dtk)
 */

const CHATWOOT_URL = process.env.CHATWOOT_INTERNAL_URL || 'http://chatwoot-rails-1:3000';
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
const CHATWOOT_WEBSITE_TOKEN = process.env.CHATWOOT_WEBSITE_TOKEN || '';
const CW_ADMIN_TOKEN = process.env.CW_ADMIN_TOKEN || '';
const TAKEOVER_CACHE_TTL_MS = Number(process.env.TAKEOVER_CACHE_TTL_MS || 8000);

const IDENTITY_TTL_MS = 20 * 24 * 60 * 60 * 1000; // JWT widget exp 180 hari → refresh tiap 20 hari
const CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1 jam (spec §1.2)
const HERMES_AGENT_BOT_ID = 1; // AgentBot "hermes-cs" (spec §0)

const IDENTITY_CACHE_MAX = 10000; // batas kasar anti memory-leak

interface WidgetIdentity {
  jwt: string;
  sourceId: string;
  contactId?: number;
  fetchedAt: number;
}

interface WidgetMessage {
  id?: number;
  content?: string;
  message_type?: number;
  created_at?: number;
  conversation_id?: number;
  sender?: { type?: string } | null;
}

interface AdminConversation {
  status?: string;
  meta?: { assignee?: { id?: number; type?: string; name?: string } | null } | null;
  custom_attributes?: Record<string, unknown>;
  // Chatwoot v4.18: `messages` berupa ARRAY langsung (bukan {payload}) — TAPI hanya
  // berisi MAKSIMAL 1 pesan embed terakhir (terverifikasi empiris 11 Okt 2026).
  // Untuk daftar pesan lengkap, pakai fetchAdminMessages() (GET /:id/messages).
  messages?: Array<{ id?: number; message_type?: number; created_at?: number; sender?: { type?: string } | null }> | { payload?: Array<{ id?: number; message_type?: number; created_at?: number; sender?: { type?: string } | null }> } | null;
}

export interface HumanMessage {
  id: number;
  content: string;
  createdAt: number; // epoch ms
}

/** [HALAMAN /chat] Pesan widget untuk halaman chat fullscreen. */
export interface ChatMessage {
  id: number;
  type: number; // 0=incoming (pengunjung), 1=outgoing, 3=template/echo bot, 2=activity
  content: string;
  createdAt: number; // epoch ms
  senderType: string; // 'user' = agen human ATAU akun API bridge, '' = null
  /** Klasifikasi tampilan: visitor | bot | human (lihat fetchWidgetConversation). */
  senderKind: 'visitor' | 'bot' | 'human';
}

export interface PollResult {
  mode: 'human_active' | 'ai';
  messages: HumanMessage[];
}

const identityCache = new Map<string, WidgetIdentity>();
const conversationCache = new Map<string, { conversationId: number; cachedAt: number }>();
const takeoverCache = new Map<string, { human: boolean; cachedAt: number }>();

function log(...args: unknown[]) {
  console.log('[chatwoot]', ...args);
}

/** Decode payload JWT base64url tanpa verifikasi (JWT widget ditandatangani Chatwoot, kita hanya baca source_id). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Ambil (atau reuse) identitas widget untuk sebuah session via POST /api/v1/widget/config.
 * forceRefresh=true dipakai setelah respons 401 (spec §2a).
 */
export async function ensureWidgetIdentity(sessionId: string, forceRefresh = false): Promise<WidgetIdentity | null> {
  const cached = identityCache.get(sessionId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < IDENTITY_TTL_MS) return cached;

  if (!CHATWOOT_WEBSITE_TOKEN) {
    log('CHATWOOT_WEBSITE_TOKEN kosong — skip sinkronisasi');
    return null;
  }

  try {
    const res = await fetch(`${CHATWOOT_URL}/api/v1/widget/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website_token: CHATWOOT_WEBSITE_TOKEN }),
    });
    if (!res.ok) {
      log('widget/config gagal:', res.status);
      return null;
    }
    const data = await res.json();
    const jwt: string | undefined = data?.website_channel_config?.auth_token;
    if (!jwt) {
      log('widget/config tanpa auth_token');
      return null;
    }
    const payload = decodeJwtPayload(jwt);
    const identity: WidgetIdentity = {
      jwt,
      sourceId: String(payload?.source_id ?? data?.contact_inbox?.source_id ?? ''),
      contactId: typeof data?.contact?.id === 'number' ? data.contact.id : undefined,
      fetchedAt: Date.now(),
    };
    if (identityCache.size >= IDENTITY_CACHE_MAX) identityCache.clear();
    identityCache.set(sessionId, identity);
    return identity;
  } catch (err) {
    log('widget/config error (fail-open):', err);
    return null;
  }
}

export function getCachedConversationId(sessionId: string): number | null {
  const c = conversationCache.get(sessionId);
  if (c && Date.now() - c.cachedAt < CONVERSATION_TTL_MS) return c.conversationId;
  return null;
}

function cacheConversationId(sessionId: string, conversationId: number) {
  conversationCache.set(sessionId, { conversationId, cachedAt: Date.now() });
}

/**
 * Rekam pesan pengunjung ke Chatwoot via POST /api/v1/widget/messages (header X-Auth-Token).
 * Ini SATU-SATUNYA cara sah merekam pesan pengunjung untuk inbox WebWidget (spec §1.2).
 * Membuat conversation otomatis bila belum ada; conversation_id di-cache 1 jam.
 * Caller memanggil ini fire-and-forget — error hanya di-log.
 */
export async function syncVisitorMessage(sessionId: string, content: string): Promise<void> {
  const text = (content || '').trim();
  if (!text) return;

  let identity = await ensureWidgetIdentity(sessionId);
  if (!identity) return;

  const postMessage = (jwt: string) =>
    fetch(`${CHATWOOT_URL}/api/v1/widget/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': jwt },
      body: JSON.stringify({ website_token: CHATWOOT_WEBSITE_TOKEN, message: { content: text } }),
    });

  try {
    let res = await postMessage(identity.jwt);
    if (res.status === 401) {
      // JWT kedaluwarsa/invalid → refresh identitas sekali lalu ulangi (spec §2a)
      identity = await ensureWidgetIdentity(sessionId, true);
      if (!identity) return;
      res = await postMessage(identity.jwt);
    }
    if (!res.ok) {
      log('widget/messages gagal:', res.status);
      return;
    }
    const data = await res.json();
    if (data?.conversation_id) {
      cacheConversationId(sessionId, Number(data.conversation_id));
      log(`sync ok session=${sessionId} conv=${data.conversation_id}`);
    }
  } catch (err) {
    log('syncVisitorMessage error (diabaikan, fire-and-forget):', err);
  }
}

async function fetchAdminConversation(conversationId: number): Promise<AdminConversation | null> {
  if (!CW_ADMIN_TOKEN) return null;
  try {
    const res = await fetch(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`,
      { headers: { api_access_token: CW_ADMIN_TOKEN } },
    );
    if (!res.ok) {
      log(`admin conversations/${conversationId} gagal:`, res.status);
      return null;
    }
    return (await res.json()) as AdminConversation;
  } catch (err) {
    log(`admin conversations/${conversationId} error:`, err);
    return null;
  }
}

/**
 * Daftar pesan conversation via endpoint /messages terpisah.
 * PENTING: GET /conversations/:id hanya embed MAKSIMAL 1 pesan terakhir —
 * deteksi "human reply setelah stamp" WAJIB pakai endpoint ini
 * (terverifikasi empiris Chatwoot v4.18, 11 Okt 2026).
 */
async function fetchAdminMessages(conversationId: number): Promise<Array<{ id?: number; message_type?: number; created_at?: number; sender?: { type?: string } | null }>> {
  if (!CW_ADMIN_TOKEN) return [];
  try {
    const res = await fetch(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages?per=20`,
      { headers: { api_access_token: CW_ADMIN_TOKEN } },
    );
    if (!res.ok) {
      log(`admin conversations/${conversationId}/messages gagal:`, res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [];
  } catch (err) {
    log(`admin conversations/${conversationId}/messages error:`, err);
    return [];
  }
}

/**
 * Takeover guard: apakah percakapan session ini sudah diambil alih agen manusia?
 * Human aktif bila (spec §2):
 *   - status conversation != 'pending', ATAU
 *   - meta.assignee ada dan bukan AgentBot/hermes-cs, ATAU
 *   - custom_attributes.last_bot_reply_at ada DAN ada message type=1 (outgoing)
 *     lebih baru dari itu (cek via /messages — bukan messages embed).
 * Belum ada conversation (percakapan baru) → AI mode. Error jaringan → fail-open ke AI mode.
 * Hasil di-cache TAKEOVER_CACHE_TTL_MS (default 8 dtk) per session.
 */
export async function humanActive(sessionId: string): Promise<boolean> {
  const cached = takeoverCache.get(sessionId);
  if (cached && Date.now() - cached.cachedAt < TAKEOVER_CACHE_TTL_MS) return cached.human;

  let human = false;
  const conversationId = getCachedConversationId(sessionId);
  if (conversationId) {
    const conv = await fetchAdminConversation(conversationId);
    if (conv) {
      const status = String(conv.status || 'pending');
      const assignee = conv.meta?.assignee || null;
      const assigneeIsBot =
        !!assignee &&
        (/bot/i.test(String(assignee.type || '')) || Number(assignee.id) === HERMES_AGENT_BOT_ID);

      if (status !== 'pending') {
        human = true;
      } else if (assignee && !assigneeIsBot) {
        human = true;
      } else {
        const lastBotReplyAt = Number(conv.custom_attributes?.last_bot_reply_at || 0);
        if (lastBotReplyAt > 0) {
          // Jangan pakai conv.messages (hanya 1 pesan embed) — ambil daftar penuh.
          const msgList = await fetchAdminMessages(conversationId);
          human = msgList.some(
            (m) => Number(m.message_type) === 1 && Number(m.created_at || 0) > lastBotReplyAt,
          );
        }
      }
    } else {
      log(`takeover check conv=${conversationId} gagal — fail-open ke AI mode`);
      human = false;
    }
  }

  takeoverCache.set(sessionId, { human, cachedAt: Date.now() });
  return human;
}

/**
 * Polling balasan HUMAN untuk session (dipakai GET /api/chat/poll, spec §3):
 * ambil widget GET /api/v1/widget/messages → filter message_type=1 (outgoing)
 * dengan sender.type='user' (bot echo berbentuk type=3 + sender=null, spec §1.2)
 * dan created_at > last_bot_reply_at (bila ada) serta id > afterId milik client.
 *
 * [TODO-poll-historis] Historis type=3 (echo bot) tidak diputar ulang ke web
 * (by design: web sudah menampilkan jawaban AI-nya sendiri secara streaming).
 * [TODO-lampiran] Attachment/gambar dari agen tidak ditangani (hanya teks).
 */
export async function pollHumanMessages(sessionId: string, afterId: number): Promise<PollResult> {
  const identity = identityCache.get(sessionId);
  if (!identity) return { mode: 'ai', messages: [] };

  const url = `${CHATWOOT_URL}/api/v1/widget/messages?website_token=${encodeURIComponent(
    CHATWOOT_WEBSITE_TOKEN,
  )}&before=${Math.floor(Date.now() / 1000)}`;

  try {
    let res = await fetch(url, { headers: { 'X-Auth-Token': identity.jwt } });
    if (res.status === 401) {
      // Identitas basi → buang cache; syncVisitorMessage berikutnya akan membuat yang baru.
      identityCache.delete(sessionId);
      return { mode: 'ai', messages: [] };
    }
    if (!res.ok) return { mode: 'ai', messages: [] };

    const data = await res.json();
    const payload: WidgetMessage[] = Array.isArray(data?.payload) ? data.payload : [];

    // Peluang: cache conversation_id bila belum ada (payload widget memuat conversation_id).
    const convIdFromPayload = payload.find((m) => m.conversation_id)?.conversation_id;
    if (convIdFromPayload && !getCachedConversationId(sessionId)) {
      cacheConversationId(sessionId, Number(convIdFromPayload));
    }

    // Baseline bot: last_bot_reply_at di-stamp bridge setelah tiap balasan bot (spec §2).
    let lastBotReplyAt = 0;
    const conversationId = getCachedConversationId(sessionId);
    if (conversationId) {
      const conv = await fetchAdminConversation(conversationId);
      lastBotReplyAt = Number(conv?.custom_attributes?.last_bot_reply_at || 0);
    }

    const messages: HumanMessage[] = payload
      .filter((m) => Number(m.message_type) === 1)
      .filter((m) => String(m.sender?.type || '') === 'user') // human; bot echo = type 3 / sender null
      .filter((m) => !lastBotReplyAt || Number(m.created_at || 0) > lastBotReplyAt)
      .filter((m) => Number(m.id || 0) > afterId)
      .map((m) => ({
        id: Number(m.id),
        content: String(m.content || ''),
        createdAt: Number(m.created_at || 0) * 1000,
      }))
      .sort((a, b) => a.id - b.id);

    const active = await humanActive(sessionId);
    return { mode: messages.length > 0 || active ? 'human_active' : 'ai', messages };
  } catch (err) {
    log('pollHumanMessages error (fail-open ke AI mode):', err);
    return { mode: 'ai', messages: [] };
  }
}

/**
 * [HALAMAN /chat] Ambil SELURUH riwayat percakapan widget untuk session
 * (dipakai BFF POST /api/chat-proxy {action:'poll'}, full=true).
 * Mengembalikan pesan type 0 (incoming/pengunjung), 1 (outgoing human),
 * dan 3 (template/echo bot) — diurutkan by id. Type 2 (activity) dibuang.
 * 401 → identitas basi: buang cache supaya syncVisitorMessage berikutnya
 * membuat identitas baru (dan percakapan widget baru).
 */
export async function fetchWidgetConversation(sessionId: string): Promise<ChatMessage[] | null> {
  let identity = identityCache.get(sessionId);
  if (!identity) return null; // session belum pernah kirim pesan → history kosong

  const fetchOnce = (jwt: string) =>
    fetch(
      `${CHATWOOT_URL}/api/v1/widget/messages?website_token=${encodeURIComponent(
        CHATWOOT_WEBSITE_TOKEN,
      )}&before=${Math.floor(Date.now() / 1000)}`,
      { headers: { 'X-Auth-Token': jwt } },
    );

  try {
    let res = await fetchOnce(identity.jwt);
    if (res.status === 401) {
      identityCache.delete(sessionId);
      return null;
    }
    if (!res.ok) {
      log(`widget/messages (full) gagal: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const payload: WidgetMessage[] = Array.isArray(data?.payload) ? data.payload : [];

    // Peluang: cache conversation_id bila belum ada (payload widget memuat conversation_id).
    const convIdFromPayload = payload.find((m) => m.conversation_id)?.conversation_id;
    if (convIdFromPayload && !getCachedConversationId(sessionId)) {
      cacheConversationId(sessionId, Number(convIdFromPayload));
    }

    // Baseline bot (spec handover §1.3): stamp last_bot_reply_at dipasang bridge
    // SETELAH tiap balasan bot sukses. Deployment ini memakai admin API utk balasan
    // bot, jadi pesan bot = type 1 + sender user id 2 — BUKAN hanya type 3.
    // Outgoing type 1 yang lebih BARU dari stamp = agen human. WidgetMessage sengaja
    // tidak mengetik custom_attributes, jadi stamp diambil via fetchAdminConversation.
    const conversationId = getCachedConversationId(sessionId);
    let lastBotReplyAt = 0;
    if (conversationId) {
      const conv = await fetchAdminConversation(conversationId);
      lastBotReplyAt = Number(conv?.custom_attributes?.last_bot_reply_at || 0);
    }

    return payload
      .filter((m) => [0, 1, 3].includes(Number(m.message_type)))
      .map((m) => {
        const type = Number(m.message_type);
        const createdAtSec = Number(m.created_at || 0); // detik epoch (sama dgn stamp)
        let senderKind: ChatMessage['senderKind'] = 'bot';
        if (type === 0) senderKind = 'visitor';
        else if (type === 1 && (!lastBotReplyAt || createdAtSec > lastBotReplyAt)) senderKind = 'human';
        return {
          id: Number(m.id || 0),
          type,
          content: String(m.content || ''),
          createdAt: createdAtSec * 1000,
          senderType: String(m.sender?.type || ''),
          senderKind,
        };
      })
      .sort((a, b) => a.id - b.id);
  } catch (err) {
    log('fetchWidgetConversation error:', err);
    return null;
  }
}
