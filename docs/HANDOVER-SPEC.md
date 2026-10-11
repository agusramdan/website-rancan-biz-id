# SPEC — Hybrid Handover + Takeover Guard (Website F&B Rancan)

Tanggal: 2026-10-11 • Author: Analis (spec) • Implementer: Developer • Verifier: Tester

## 0. Konteks Sistem (hasil riset empiris, semua sudah diuji)

- Website: Next.js 14 di /home/ubuntu/website, container `rancan-website`, port 127.0.0.1:3100,
  di-deploy via `docker compose` (WAJIB compose). Join 2 network: default + `chatwoot_default` (external).
- AI Gateway (Hermes CS, model "cs"): http://172.20.0.1:8902/v1/chat/completions (listen di 172.20.0.1,
  BISA diakses dari container website via IP itu). API key sudah hardcoded di route.ts saat ini
  (dipindah ke env: AI_GATEWAY_KEY).
- Chatwoot self-host: http://127.0.0.1:3001 (dari host) / http://chatwoot-rails-1:3000 (dari container
  di network chatwoot_default — DIPAKAI untuk latency rendah). Account id = 2. Inbox "Web Chat Website"
  id = 2 (Channel::WebWidget). website_token = oALwvhtgmK1DaeqqmcUPVD7x (sudah dipakai ChatwootWidget.tsx).
- Admin API token (api_access_token): lihat env CW_ADMIN_TOKEN pada /home/ubuntu/website/.env
  (diisi saat deploy; jangan commit nilai asli).
- AgentBot "hermes-cs" (id 1) otomatis jadi assignee (assignee_type=AgentBot) pada conversation baru
  inbox 2, dan menerima webhook event message_created → http://hermes-bridge:8901/webhook
  (container hermes-cs-bridge, compose /home/ubuntu/chatwoot/docker-compose.yml, service `hermes-bridge`).
- SECRET_KEY_BASE Chatwoot TIDAK berubah → source_id dari `/api/v1/widget/config` deterministik
  (frontend lama tetap jalan).

## 1. Riset API Chatwoot — temuan kunci (VERIFIED via curl)

1. `POST /api/v1/widget/config` {website_token} (+ header `X-Auth-Token: <jwt>` bila mau reuse)
   → JSON `website_channel_config.auth_token` = JWT (HS256, secret SECRET_KEY_BASE Chatwoot,
   exp 180 hari) berisi payload `{source_id, inbox_id}`; `contact` = {id, name, pubsub_token}.
   Saat ada header X-Auth-Token valid → contact LAMA dipakai kembali (id sama). Ini cara web custom
   menyimpan identitas pengunjung: simpan JWT + source_id di localStorage per tab browser.
2. `POST /api/v1/widget/messages` header X-Auth-Token: <jwt>, body {website_token, message:{content, echo_id?}}
   → membuat conversation OTOMATIS bila belum ada (status pending, assignee AgentBot) dan menyimpan
   pesan message_type=0 (incoming) milik contact. INI SATU-SATUNYA cara sah merekam pesan pengunjung
   dari server untuk inbox WebWidget (POST /conversations/:id/messages message_type=incoming via admin
   API DITOLAK: "Incoming messages are only allowed in Api inboxes").
   - Respons berisi `conversation_id` → simpan mapping session→conversation_id (cache in-memory 1 jam).
   - GET /api/v1/widget/messages?website_token=..&before=<epoch> (X-Auth-Token) → {payload:[...], meta}.
     message_type: 0=incoming(pengunjung), 1=outgoing(agent ATAU echo bot), 3=template/echo bot,
     2=activity. Pembeda bot vs human pada type 1: `sender.type` — "user" = manusia,
     dan ECHO bot reply berbentuk type=3 + sender=null. (Terverifikasi empiris: setelah takeover,
     balasan agen muncul type 1 sender.type "user"; sebelum takeover hanya ada type 3 sender null.)
3. Admin API (header `api_access_token`) — PENTING, khusus Chatwoot v4.18:
   - `GET /api/v1/accounts/2/conversations/:id` → {status: pending|open|snoozed|resolved, meta.assignee,
     custom_attributes, messages: ARRAY langsung (BUKAN {payload}) yang HANYA berisi maksimal 1 pesan
     embed terakhir (bukan daftar penuh! — terverifikasi empiris 11 Okt 2026). Untuk daftar pesan
     lengkap WAJIB pakai `GET /api/v1/accounts/2/conversations/:id/messages?per=20`
     → {payload:[...]}. Takeover guard kondisi-3 (deteksi type=1 > last_bot_reply_at) memakai
     endpoint /messages ini — lib/chatwoot.ts fetchAdminMessages().
   - HANDBACK (kembali ke bot) — prosedur lengkap terverifikasi 11 Okt 2026:
     (1) `POST .../assignments {assignee_id: 0}` (lepas assignee human),
     (2) `POST .../toggle_status {status: 'pending'}`,
     (3) reset baseline: `POST .../custom_attributes {custom_attributes: {last_bot_reply_at: <now>}, merge: true}`
     — WAJIB, karena balasan human yang lebih baru dari stamp bot lama akan membuat guard
     menganggap human aktif selamanya. CATATAN: `assignments {assignee_id: 1}` (AgentBot)
     diterima API (200) tetapi TIDAK diaplikasikan — assignee tetap kosong; jangan dipakai.
   - UPDATE STATUS: `POST /api/v1/accounts/2/conversations/:id/toggle_status` {status: 'open'|'pending'|...}.
     (PATCH /conversations/:id di v4.18 HANYA menerima `priority` — status/assignee/custom_attributes
     diabaikan diam-diam. POST /conversations/:id → 404. Terverifikasi empiris 11 Okt 2026.)
   - ASSIGN AGENT: `POST /api/v1/accounts/2/conversations/:id/assignments` {assignee_id: <user_id>}.
     assignee_id=0 melepas assignee. Setelah assignment, assignee_type jadi "User".
   - CUSTOM ATTRIBUTES: `POST /api/v1/accounts/2/conversations/:id/custom_attributes`
     {custom_attributes: {...}, merge: true} (merge agar key lain tidak tertimpa).
   - Agents: id 2 = Agus (administrator), id 3 = "Rancan agent" (agent). Untuk simulasi takeover pakai
     toggle_status {status:"open"} + assignments {assignee_id:3}.
4. Create conversation via admin `POST /conversations` TIDAK dipakai untuk flow ini (butuh contact_inbox;
   source_id=identifier → contact_inbox.tenant null → route widget 404 "Resource could not be found").
5. Widget JWT decode: `cut -d. -f2 | base64 -d` (payload {source_id, inbox_id, exp, iat}).

## 2. Arsitektur Target

```
Browser (page.tsx, session_id + chatwoot JWT di localStorage)
   │  POST /api/chat {sessionId, messages}
   ▼
route.ts (Next.js server, container rancan-website)
   1) takeover guard: humanActive?(session)  [cache 8 dtk per session]
   2) jika human_active → return JSON {mode:'human_active'} (TIDAK panggil AI)
   3) jika ai_mode   → fire-and-forget syncVisitorMessage(session, lastUserMsg)  [tidak menunggu]
   4) panggil AI Gateway 172.20.0.1:8902 (stream SSE, dibalikan apa adanya ke client)
   5) header X-Chat-Mode: ai | human_active  (untuk debugging)
   ▼ (async, background)
syncVisitorMessage:
   a. ensureWidgetIdentity(session): /api/v1/widget/config (cache JWT+source_id 20 hari,
      refresh bila 401) → simpan cwJwt per session
   b. POST /api/v1/widget/messages (X-Auth-Token: cwJwt) → pesan pengunjung tercatat di Chatwoot,
      bot hermes-cs menjawab via webhook bridge ( conversation pending tetap dikerjakan bot )
   c. cache conversation_id per session (1 jam)
humanActive?(session):
   - bila cache conversation_id ada → GET admin /conversations/:id
     human aktif bila: status != 'pending' ATAU meta.assignee bukan AgentBot/hermes-cs
     ATAU (custom_attributes.last_bot_reply_at ada DAN ada message type=1 lebih baru dari itu)
   - bila belum ada (percakapan baru) → AI mode (belum mungkin di-takeover)
   - error jaringan → fail-open ke AI mode + log
Bridge (python, satu-satunya penulis outgoing bot):
   - setiap sukses ask_hermes→send_reply: POST admin custom_attributes {last_bot_reply_at: <epoch>}
   - gagal stamp tidak menggagalkan reply (try/except)
Frontend (page.tsx):
   - sessionId = localStorage 'rancan_session_id' (crypto.randomUUID)
   - kirim {sessionId, messages}
   - response header/content-type JSON + mode=human_active → tampilkan badge
     "👨‍💼 Tim Rancan sedang melayani Anda" + system bubble; tandai humanActive=true
   - bila humanActive: mulai polling GET /api/chat/poll?sessionId=.. tiap 4 dtk
     → merge pesan type=1 (outgoing) yang belum ada (id > lastPollId) ke daftar chat
   - humanActive sesi berjalan: pesan user baru TETAP dikirim ke /api/chat (untuk sync ke Chatwoot)
     dan TIDAK dijawab AI (server yang putuskan)
   - reset saat "Chat Baru" (sessionId baru → conversation Chatwoot baru)
Poll endpoint (route.ts GET /api/chat/poll):
   - query sessionId → conversation_id (cache/ensure)
   - ambil widget GET /api/v1/widget/messages → filter message_type=1 (outgoing)
     → bila ada last_bot_reply_at dan timestamp pesan > last_bot_reply_at → itu balasan HUMAN
     → kembalikan {messages:[{id, content, createdAt}]} (hanya yang > lastPollId client)
   - TODO terdokumentasi: first-paint historis type=3 (echo bot) tidak diputar ulang ke web
     (by design: web sudah menampilkan jawaban AI-nya sendiri secara streaming)
```

## 3. Kontrak API Internal

### POST /api/chat
Request: {sessionId: string, messages: [{role, content}, ...]} (sessionId opsional → server generate)
Respon:
- Mode AI: SSE stream `text/event-stream` (format OpenAI chat.completion.chunk), header X-Chat-Mode: ai.
- Mode human: JSON {mode:'human_active', message:'Tim Rancan sedang melayani Anda...'},
  status 200, header X-Chat-Mode: human_active, Cache-Control: no-store.
- Frontend membedakan via header X-Chat-Mode / Content-Type.

### GET /api/chat/poll?sessionId=...
Respon: {mode:'human_active'|'ai', messages:[{id:number, content:string, createdAt:number}]}
- messages HANYA balasan human (type=1, sender.type=user, createdAt > last_bot_reply_at).
- mode 'ai' + messages [] → bot aktif kembali (frontend matikan polling & badge).

## 4. Environment (docker-compose.yml website)

```
CS_API_URL=http://172.20.0.1:8902/v1/chat/completions
AI_GATEWAY_KEY=<GATEWAY_KEY disimpan di .env — sudah dirotasi 11 Okt 2026>
CHATWOOT_INTERNAL_URL=http://chatwoot-rails-1:3000
CHATWOOT_ACCOUNT_ID=2
CHATWOOT_INBOX_ID=2
CHATWOOT_WEBSITE_TOKEN=oALwvhtgmK1DaeqqmcUPVD7x
CW_ADMIN_TOKEN=<api_access_token admin — diisi di .env, tidak di-hardcode>
TAKEOVER_CACHE_TTL_MS=8000
```
(env_file .env tetap; nilai di atas di-add ke .env host; compose env meng-override duplikat.)

## 5. File yang diubah/ditambah

1. /home/ubuntu/website/lib/chatwoot.ts        [BARU] — helper: widget identity cache, syncVisitorMessage,
   humanActive check (status/assignee/last_bot_reply_at), pollHumanMessages, konstanta.
2. /home/ubuntu/website/app/api/chat/route.ts  [UBAH] — POST: guard → human_active | sync+AI; GET: poll.
3. /home/ubuntu/website/app/page.tsx           [UBAH] — sessionId, X-Chat-Mode handling, badge human_active,
   polling balasan human, kirim sessionId, reset session saat Chat Baru.
4. /home/ubuntu/chatwoot/hermes-bridge.py      [UBAH] — stamp custom_attributes.last_bot_reply_at.
5. /home/ubuntu/website/docker-compose.yml     [UBAH] — env baru (lihat §4).
6. /home/ubuntu/website/.env                   [UBAH] — tambah CW_ADMIN_TOKEN dll (host-only).

## 6. Kriteria Terima (E2E, semuanya HARUS dieksekusi nyata)

- (a) Chat normal: POST /api/chat session baru → SSE AI menjawab; di Chatwoot muncul conversation
  inbox 2 status pending dengan pesan incoming pengunjung + (via bridge) balasan bot.
- (b) Takeover: admin API set conv → status=open + assignee_id=3 → POST /api/chat berikutnya
  (sessionId sama, setelah cache 8 dtk kadaluarsa) → respons mode human_active, AI Gateway TIDAK dipanggil
  (bukti: tidak ada pertambahan jawaban bot; log route "takeover active").
- (c) Balasan human: agent (id 3) POST outgoing di conv → polling endpoint mengembalikan pesan itu,
  frontend menampilkannya (diverifikasi via curl ke /api/chat/poll).
- (d) Deploy murni `docker compose build && docker compose up -d` di /home/ubuntu/website.

## 7. TODO terdokumentasi (boleh tak selesai, harus tercatat di kode & laporan)

- [TODO-poll-historis] Historis type=3 (echo bot) tidak diputar ulang; hanya balasan human.
- [TODO-presence] "Agen sedang mengetik" tidak diteruskan ke web.
- [TODO-lampiran] Attachment/gambar dari agen tidak ditangani (hanya teks).
- [TODO-ui-penuh] Saat human aktif, input pengunjung tetap teks biasa (belum rich).
- [TODO-csrf] Endpoint /api/chat masih tanpa rate-limit/CSRF (sudah begitu sebelumnya).

## 8. Catatan Operasional (11 Okt 2026 — hasil E2E final PASS=11 FAIL=0)

- **Race antar-run E2E**: pencarian conversation via marker teks (`e2e-a`) TIDAK unik antar-run
  (marker run lama masih ada di Chatwoot) → bisa mutasi conversation yang salah. Solusi (sudah
  diterapkan di `scripts/e2e_handover_test.sh`): binding deterministik dari log container
  `sync ok session=<SID> conv=<id>` + marker pesan memuat SID unik per run.
- **Stamp `last_bot_reply_at` muncul ~10–20 dtk setelah POST /api/chat** (bot reply via webhook
  menunggu LLM). Jangan sleep statis — skrip E2E mem-polling sampai 60 dtk.
- **Handback ke bot butuh 3 langkah** (lihat §1.3 HANDBACK): unassign → status pending →
  reset stamp `last_bot_reply_at` ke waktu sekarang. Tanpa reset, balasan human yang lebih
  baru dari stamp bot membuat guard terkunci di human_active selamanya.
- **Fallback AI Gateway CS**: primary = Gemini direct (profil `cs`); saat kuota Gemini habis (429),
  rantai fallback turun ke `ai.sumopod.com` yang membaca env `SUMOPOD_API_KEY`. Key ini WAJIB ada
  di `~/.hermes/profiles/cs/.env` — sudah ditambahkan 11 Okt 2026 (backup: `.env.bak-20261011-takeover`),
  **efektif pada restart gateway CS berikutnya** (`hermes -p cs gateway restart` dari shell luar
  gateway — restart dari sesi dalam gateway diblokir proteksi anti-restart-loop). Gejala kalau key
  tidak terbaca: website terima SSE berisi error `HTTP 401: LiteLLM Virtual Key expected.
  Received=no-k****ired` — sentinel `no-key-required` adalah placeholder Hermes untuk provider
  tanpa key.
