# Website Chat-Commerce Rancan F&B — Gerai Sehat

> Aplikasi **chat-commerce** (conversational commerce) untuk bisnis F&B **Gerai Sehat** — kafe & resto premium — yang berjalan di root domain **`rancan.biz.id`**. Pengunjung cukup mengobrol natural dengan AI Customer Service, dan rekomendasi menu muncul otomatis dalam panel produk dinamis.

---

## Daftar Isi

1. [Pengantar & Arsitektur](#1-pengantar--arsitektur)
2. [Identitas AI CS: Rancan](#2-identitas-ai-cs-rancan)
3. [Flow Chat, API & Hybrid Handover](#3-flow-chat-api--hybrid-handover-takeover-guard)
4. [Integrasi Odoo & NATS](#4-integrasi-odoo--nats)
5. [Panduan Development & Deployment](#5-panduan-development--deployment)
6. [Referensi Dokumen](#6-referensi-dokumen)

---

## 1. Pengantar & Arsitektur

### 1.1 Apa Ini?

Website single-page berbasis **Next.js 14 (App Router) + TypeScript + Tailwind CSS** yang menggabungkan antarmuka obrolan natural (ala ChatGPT) dengan katalog F&B *live*. Alih-alih mencari menu di katalog statis, pelanggan bertanya langsung — *"Rekomendasi kopi susu andalan?"* atau *"Ada makanan berat apa saja?"* — dan AI menjawab konsultatif sambil menampilkan kartu menu (foto, harga Rupiah, kategori) di panel kanan secara otomatis.

- **Domain publik:** `https://rancan.biz.id` (root domain)
- **Port internal aplikasi:** `3100` (bind `127.0.0.1`, hanya dijangkau Caddy)
- **Bisnis:** Gerai Sehat — kafe & resto premium (kafe artisan, pastry, main course kelas menengah-atas)

### 1.2 Arsitektur End-to-End

```
Visitor (browser)
   │  HTTPS :443
   ▼
Caddy v2 (TLS Let's Encrypt, security headers)          ← satu-satunya komponen publik
   │  reverse_proxy → 127.0.0.1:3100
   ▼
Next.js 14 — container `rancan-website` (:3100)
   │  BFF: POST /api/chat  (sisip system prompt Rancan, stream SSE)
   ▼
socat forwarder  172.20.0.1:8902  →  127.0.0.1:8900     ← jembatan Docker → host
   ▼
Hermes Gateway CS  (profile `cs`, API OpenAI-compatible :8900)
   │  ├─ LLM primary: Gemini 3.5 Flash-lite  (+ fallback OpenRouter & Sumopod)
   │  ├─ MCP Odoo read-only  → data menu & stok live (PULL)
   │  └─ NATS JetStream      → aksi tulis via command pattern (PUSH)
   ▼
Odoo 20 (DB `CANTIK`)  •  NATS 2.15 (JetStream)
```

**Prinsip keamanan:** hanya Caddy yang terekspos publik (80/443). Semua layanan lain (website 3100, gateway 8900, socat 8902, NATS 4222/8222, Odoo 8069) bind di `127.0.0.1` / `172.20.0.1` dan dibatasi UFW.

### 1.3 Struktur Proyek

```
~/website/
├── app/
│   ├── api/
│   │   ├── chat/route.ts       # BFF proxy streaming (SSE) → Hermes Gateway CS
│   │   └── products/route.ts   # API katalog menu F&B (5 menu contoh, rencana: dari Odoo)
│   ├── globals.css             # Tailwind + kustomisasi scrollbar
│   ├── layout.tsx              # Root layout & meta tag
│   └── page.tsx                # UI 3 kolom: Sidebar Riwayat | Chat Utama | Panel Produk
├── package.json                # Next.js 14, React 18, Tailwind, Lucide Icons
├── tailwind.config.js          # Palet: Kakao #5C4033, Terracotta #C86D51, Cream #FDFBF7
├── Dockerfile                  # Multi-stage build (node:18-alpine)
├── docker-compose.yml          # Service `web` → container rancan-website
├── .dockerignore               # Eksklusi node_modules/.next agar build context ringan
└── .gitignore
```

---

## 2. Identitas AI CS: Rancan

| Aspek | Keterangan |
|---|---|
| **Nama** | **Rancan** |
| **Peran** | Konsultan Kuliner Virtual — CS AI resmi Gerai Sehat (Rancan F&B) |
| **Didefinisikan di** | System prompt BFF (`app/api/chat/route.ts`) + `SOUL.md` profile `cs` pada Hermes Gateway |
| **Keahlian** | Rekomendasi menu, detail produk, harga, stok *live* (dari Odoo), status pesanan/pengiriman |
| **Gaya bahasa** | Indonesia rapi, hangat, elegan; sapaan "Kak"; emoji maksimal 1 per pesan |
| **Batasan** | Dilarang mengarang data menu/harga/stok; topik non-F&B diarahkan kembali; keluhan dieskalasi ke CS manusia |

**Steril dari istilah fashion.** Identitas lama (persona "Maya" / Kontultan Butik) sudah **sepenuhnya dihapus** dari website dan profil agent — diverifikasi via grep (0 sisa `maya|fashion|busana|pakaian`) per 10 Oktober 2026. UI kini menampilkan heading *"Rancan — Konsultan Kuliner"*, salam pembuka *"konsultan kuliner virtual"*, dan indikator *"Rancan sedang mengetik..."*.

---

## 3. Flow Chat, API & Hybrid Handover (Takeover Guard)

### 3.1 Alur Satu Request Chat & Sinkronisasi Chatwoot

1. **Visitor** mengirim pesan dari UI chat (`app/page.tsx`).
2. **BFF `/api/chat`** (`app/api/chat/route.ts`) menerima pesan:
   - **Takeover Guard**: Cek async ke Chatwoot — bila percakapan sedang dipegang agen manusia (status `open`/ter-assign, atau balasan human lebih baru dari stamp bot), bot BERHENTI merespons; BFF mengembalikan mode `human_active` dan frontend menampilkan badge "Tim Rancan sedang melayani Anda".
   - **Sinkronisasi ke Chatwoot**: Secara fire-and-forget (tidak memblokir streaming), pesan pengunjung dicatat ke Chatwoot inbox Website (id=2, account 2) berdasar `session_id` browser (contact find-or-create → conversation reuse → POST message incoming).
   - Bila bot aktif, BFF menyisipkan system prompt Rancan, lalu memanggil gateway dengan `model: "cs"`, `stream: true`, `temperature: 0.7`.
3. **socat** meneruskan koneksi dari container Docker (`172.20.0.1:8902`) ke Hermes Gateway CS di host (`127.0.0.1:8900`) — systemd unit `socat-hermes-nats.service`, `Restart=always`. UFW hanya mengizinkan subnet Docker `172.20.0.0/16`.
4. **Hermes Gateway CS** (OpenAI-compatible `/v1/chat/completions`, auth Bearer key) meneruskan ke LLM dan mengeksekusi tools bila diperlukan (Odoo/NATS).
5. **Respons streaming SSE** diteruskan utuh oleh BFF ke browser; frontend mem-parsing & membersihkan tag produk dari teks, lalu merender kartu menu di panel dinamis.

```text
Visitor → Caddy:443 → Next.js BFF :3100 ──┬─ async sync → Chatwoot (inbox Web id=2)
                                          │   (takeover guard: human_active? → stop bot)
                                          └─ socat :8902 → Gateway CS :8900 → LLM + Tools
   ▲                                                                  (Gemini/fallback)
   └──────── jawaban streaming SSE + kartu [[PRODUK:...]] ─────────────────┘
```

### 3.2 State Machine Handover (Bot ↔ Human)

| Keadaan | Perilaku Bot | Perilaku Chatwoot |
|---|---|---|
| **bot_active** (status `pending`, assignee kosong/AgentBot) | Menjawab otomatis via AI Gateway | Conversation pending, pesan tercatat |
| **human_active** (status `open` + assignee agen, atau balasan human > stamp bot) | BERHENTI menjawab; BFF kirim mode `human_active` | Agen melayani langsung dari dashboard |
| **handback** (unassign → status `pending` → reset stamp `last_bot_reply_at`) | Aktif kembali otomatis | Kembali ke antrean bot |

- Stamp `last_bot_reply_at` di custom_attributes percakapan (ditulis bridge setiap AI membalas) — dasar perbandingan "siapa yang membalas paling akhir".
- Deteksi balasan human memakai endpoint `/messages` penuh (GET conversation hanya embed 1 pesan terakhir).
- **Notifikasi Telegram**: setiap transisi bot→human mengirim alert ke owner (chat ID 5070047968 via `@rancanbot`) berisi nama agen, nomor percakapan, dan link langsung ke Chatwoot. Anti-spam berbasis transisi (1 takeover = 1 notif; update ulang tidak memicu alert baru). Konfigurasi via `~/chatwoot/.env` (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, mode 600).

### 3.3 Model AI & Fallback Chain

| Peran | Provider | Model |
|---|---|---|
| **Primary (khusus CS)** | `custom:gemini.direct` (endpoint OpenAI-compatible Google) | `gemini-3.5-flash-lite` |
| **Fallback 1** | `custom:openrouter` | `openrouter/free` |
| **Fallback 2** | `custom:ai.sumopod.com` | `glm-5.3-flash` |

- Retry otomatis 3x pada upstream error (mis. HTTP 503 dari Gemini) **sebelum** turun ke fallback — inilah yang menjaga ketersediaan chat.
- Ollama dan Groq sudah **dihapus** dari chain aktif.

### 3.3 Deteksi Menu Dinamis (Structured Tagging)

AI menyisipkan tag terstruktur di akhir jawaban:

```
[[PRODUK:id|nama|harga|kategori]]
Contoh: [[PRODUK:201|Artisan Signature Kopi Susu Gula Aren|32000|Minuman]]
```

Frontend mem-parse tag tersebut → merender kartu menu interaktif di **panel kanan** (desktop) atau **bottom-sheet** (mobile), sekaligus membersihkannya dari teks chat utama.

### 3.4 Endpoint Aplikasi

| Endpoint | Fungsi |
|---|---|
| `POST /api/chat` | BFF proxy streaming SSE ke Hermes Gateway CS (satu-satunya jalur chat) |
| `GET /api/products` | Katalog menu F&B untuk UI (mendukung `?id=` dan `?q=`) — saat ini 5 menu contoh statis; rencana berikutnya diambil dari Odoo via JSON-RPC read-only |

---

## 4. Integrasi Odoo & NATS

Odoo 20 adalah **sumber resmi tunggal** data menu, harga, dan stok — tidak ada duplikasi data master di frontend maupun AI.

### 4.1 Odoo via MCP — Read-Only (PULL)

- Rantai akses: `config.yaml (mcp_servers.odoo)` → `run-odoo-mcp.sh` → `mcp-server-odoo` → user Odoo **`cs_ai_reader`** (hak baca saja, kredensial di file mode `600`, tidak pernah hardcoded di frontend).
- Database: **`CANTIK`** (PostgreSQL 16, container `odoo20-db-1`; hardening `list_db=False`, `dbfilter=^CANTIK$`).
- Tools yang dipakai Rancan: `search_product`, `get_product_detail`, `check_stock`, `get_order`, `get_delivery_status`.
- Aturan persona: menu/harga/stok **wajib** dari tool Odoo; cek stok real-time sebelum menyatakan ketersediaan (anti-halusinasi).
- User read-only terbukti **menolak operasi tulis** (Access Denied) — least privilege.

### 4.2 NATS — Aksi Tulis (PUSH, Command Pattern)

- NATS 2.15.0 + JetStream, bind `127.0.0.1:4222` (monitoring `:8222`) — tidak publik.
- Operasi tulis (buat pesanan, keranjang, checkout) **tidak pernah** dilakukan langsung frontend/AI ke Odoo. Alurnya: AI menerbitkan perintah ke subject `hermes.command.*` → worker **`product-writer`** melakukan validasi ketat → aksi sensitif butuh **approval owner via Telegram** → baru dieksekusi ke Odoo.

| Arah | Mekanisme | Kredential | Contoh |
|---|---|---|---|
| Baca (data) | MCP Odoo, JSON-RPC read-only | `cs_ai_reader` | Cari menu, cek stok, status pesanan |
| Tulis (aksi) | NATS command pattern + approval | worker `product-writer` | Buat pesanan, checkout |

---

## 5. Panduan Development & Deployment

### 5.1 Menjalankan Secara Lokal (Development)

```bash
cd ~/website
npm install
npm run dev          # next dev -p 3100
```

Akses `http://127.0.0.1:3100` di browser, atau verifikasi via terminal:

```bash
curl -I http://127.0.0.1:3100
```

> **Catatan dev:** BFF secara default mengarah ke `CS_API_URL=http://172.20.0.1:8902/...` (hanya reachable dari dalam jaringan Docker). Saat menjalankan di host (di luar container), override agar menuju gateway langsung:
> ```bash
> CS_API_URL=http://127.0.0.1:8900/v1/chat/completions npm run dev
> ```

### 5.2 Build & Jalankan Produksi (Tanpa Docker)

```bash
cd ~/website
npm run build        # next build
npm run start        # next start -p 3100
```

### 5.3 Deployment via Docker Compose (Metode Resmi)

```bash
cd ~/website
docker compose up -d --build
```

- Container: `rancan-website`, publish `127.0.0.1:3100:3100`, `restart: unless-stopped`, `mem_limit: 512m`, log rotate 10m × 3.
- Environment: `CS_API_URL=http://172.20.0.1:8902/v1/chat/completions` + `env_file: .env`.
- Network: default + `chatwoot_default` (eksternal) agar BFF dapat menjangkau gateway via `172.20.0.1`.
- **Selalu deploy via `docker compose up -d`** (bukan `docker run` manual) — pelajaran dari insiden bridge 10 Okt 2026.
- Pasca-deploy, lakukan **tes E2E** (kirim chat → terima balasan streaming), bukan hanya memastikan kontainer `Up`.

### 5.4 Kepatuhan `.gitignore`

File `.gitignore` wajib dipertahankan di root repositori dan mencakup:

```gitignore
.env
.next/
node_modules/
.DS_Store
npm-debug.log*
```

Tujuan: `.env` (berisi kredensial) tidak pernah ikut ter-commit; direktori build (`.next/`) dan dependensi (`node_modules/`) tidak membengkakkan repositori. **Jangan pernah** meng-hardcode API key di source — semua secret dikelola via `.env` (mode `600`) yang di-load `env_file` pada compose.

### 5.5 Verifikasi Cepat Seluruh Jalur

```bash
ss -tlnp | grep -E '3100|8900|8902'              # semua listen sesuai desain
docker compose ps                                # kontainer website Up
curl -s http://127.0.0.1:3100/api/products | head -c 400   # katalog merespons
curl -I https://rancan.biz.id              # Caddy 200/redirect TLS
```

---

## 6. Referensi Dokumen

| Dokumen | Isi |
|---|---|
| `~/docs/reports/FLOW-website-cs-agent-fnb.md` | **Arsitektur end-to-end terkini (diverifikasi lapangan 10 Okt 2026)** — diagram alur, tabel port, firewall, model & fallback, lokasi kredensial, backlog |
| `~/docs/website/KONSEP-chat-commerce.md` | Konsep awal chat-commerce: visi, wireframe 3 kolom, roadmap fase |
| `~/docs/website/README-dev.md` | Dokumentasi pengembangan MVP frontend: stack, struktur direktori, cara menjalankan |
| `~/docs/website/SISTEM-adaptasi-fb.md` | Catatan pivot fashion → F&B dan rencana katalog dari Odoo |
| `~/docs/products/KATALOG-produk-gerai-sehat.md` | Katalog lengkap Gerai Sehat (59 item, 6 kategori) — referensi input ke Odoo |
| `~/docs/infrastructure/ARSITEKTUR-rancan.md` | Arsitektur VPS menyeluruh (Caddy, Odoo, Plane, NATS, dll.) |
| `~/docs/reports/ALUR-telegram-cs-hermes.md` | Alur kanal Telegram (Chatwoot) — jalur paralel yang berkonvergensi di Gateway CS |
| `~/docs/reports/ARSITEKTUR-CRM-ODOO.md` | **Arsitektur CRM & Lead Management (11 Okt 2026)** — Flow A/B/C: deteksi intent prospek, pembuatan lead via NATS, state machine lead ↔ sinkronisasi Chatwoot |
| `prompts/FRONTEND-CRM-INTEGRATION.md` | **Backlog prompt frontend** — komponen LeadProgressTracker (stepper status penawaran B2B) + endpoint stub `/api/crm/status` — dieksekusi HANYA setelah backend Flow B/C live |

---

## 7. Roadmap CRM (Backlog)

Integrasi CRM Odoo 20 ke pengalaman chat website direncanakan bertahap:

1. **Backend dulu** (arsitektur: `ARSITEKTUR-CRM-ODOO.md`):
   - Integration Service menulis `crm.lead` via NATS `hermes.command.crm.lead.create`.
   - Stage lead (New → Qualified → Quotation Sent → Won/Lost) disinkronkan ke Chatwoot sebagai label `lead:*`.
2. **Frontend menyusul** (prompt siap di `prompts/FRONTEND-CRM-INTEGRATION.md`):
   - Komponen `LeadProgressTracker` (stepper gradien indigo→purple→pink) menampilkan progres penawaran B2B pengunjung secara real-time via polling `/api/crm/status`.
   - Tidak menampilkan data pribadi; tracker hanya muncul bila pengunjung punya lead aktif.

Status terkini: **backend belum dieksekusi** — dokumen arsitektur final, eksekusi menunggu prioritas owner.

---

## 8. Hybrid Handover & Takeover Guard (Live — 11 Okt 2026)

Arsitektur **hybrid**: chat web tetap langsung ke AI Gateway (cepat, katalog interaktif), TAPI seluruh percakapan terekam di Chatwoot dan agen manusia dapat mengambil alih kapan pun.

| Komponen | Lokasi | Fungsi |
|---|---|---|
| Sinkronisasi Chatwoot | `lib/chatwoot.ts` + `app/api/chat/route.ts` | Fire-and-forget: contact find-or-create (source_id = session browser) → conversation reuse (inbox Web id=2) → POST message incoming |
| Takeover Guard | `app/api/chat/route.ts` | Cek status/assignee/balasan-human terakhir sebelum panggil AI; cache ±10 detik |
| Stamp bot | custom_attributes `last_bot_reply_at` (ditulis `hermes-bridge.py`) | Baseline "siapa membalas paling akhir" |
| Handover spec | `docs/HANDOVER-SPEC.md` | Prosedur takeover/handback 3 langkah + endpoint Chatwoot v4.18 yang valid |
| Notifikasi Telegram | `~/chatwoot/.env` + bridge | Alert bot→human transition (nama agen, conv #, link Chatwoot) |

**Endpoint Chatwoot v4.18 yang dipakai** (penting — PATCH conversation hanya menerima priority):
- `POST /conversations/:id/custom_attributes` (merge)
- `POST /conversations/:id/assignments` `{assignee_id}`
- `POST /conversations/:id/toggle_status` `{status}`
- `GET /conversations/:id/messages?per=20` (daftar pesan penuh utk deteksi human reply)

E2E terverifikasi 11/0 PASS (11 Okt 2026): chat normal → AI jawab + terekam Chatwoot; takeover → bot berhenti (mode human_active); handback → AI aktif lagi; alert Telegram terkirim per transisi.

---

*README ini disusun ulang per 10 Oktober 2026, diperbarui 11 Oktober 2026 (tambahan roadmap CRM, backlog prompt frontend, serta dokumentasi Hybrid Handover & Takeover Guard — §3 & §8), mengikuti arsitektur terverifikasi pada `FLOW-website-cs-agent-fnb.md` dan `docs/HANDOVER-SPEC.md`. Markdown adalah sumber kebenaran — perbarui dokumen ini setiap ada perubahan arsitektur.*
