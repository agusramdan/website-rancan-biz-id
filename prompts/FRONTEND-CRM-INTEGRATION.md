# BACKLOG — Integrasi Visual CRM & Status Lead di Frontend Website Rancan

> **Status**: BACKLOG (belum dieksekusi)
> **Prioritas**: Rendah–Sedang (jalankan setelah Flow C (sinkronisasi stage) live di backend)
> **Agen penerima**: `frontend`
> **Referensi arsitektur**: `~/docs/reports/ARSITEKTUR-CRM-ODOO.md` (Flow A/B/C, §6–§8) & `PROMPT.md` §12

## 1. Konteks

Backend CRM telah dirancang:

- Chatwoot label percakapan diperbarui otomatis oleh Integration Service:
  `lead:new`, `lead:qualified`, `lead:quotation_sent`, `lead:won`, `lead:lost`.
- Odoo 20 CRM adalah satu-satunya sumber kebenaran stage lead.
- Website F&B (`rancan.biz.id`) dan situs profile (`agusramdan.web.id`) perlu
  menampilkan status lead/progres secara real-time bagi pengunjung B2B yang
  mengajukan penawaran.

## 2. Tujuan Akhir

Membuat **Progress Tracker Lead** yang elegan, minimal, konsisten dengan tema
dark-tech / gradien indigo→purple→pink situs F&B, yang menampilkan:

1. Status permintaan penawaran yang diajukan pengunjung (apabila terdeteksi
   sebagai lead dan pelanggan mengidentifikasi diri via chatbot).
2. Timeline stage lead: `Diterima → Dikualifikasi → Penawaran Dikirim →
   Selesai (Won/Lost)`.
3. Indikator visual CTA yang berubah dinamis sesuai stage terakhir.

## 3. Prompt Eksekusi (Salinverbatim ke `frontend chat` saat dieksekusi)

```text
TUGAS FRONTEND: Integrasi Visual CRM & Status Lead di Website Rancan (rancan.biz.id)

1. BUAT KOMPONEN "LeadProgressTracker":
   - Lokasi: ~/website/components/crm/LeadProgressTracker.tsx
   - Props: conversationId (string), initialStage (enum: new|qualified|quotation_sent|won|lost)
   - Fetching: Polling ke endpoint baru /api/crm/status?conversation_id=... (JSON) tiap 30 detik. Endpoint ini BELUM ADA — buat stub API route-nya di ~/website/app/api/crm/status/route.ts yang sementara mengembalikan { stage: "new", updated_at: null } dan TODO-kan panggilan NATS/Odoo yang sesungguhnya.
   - Desain: 4 langkah stepper horizontal (mobile: vertikal), gradien indigo (#4f46e5) → ungu (#a855f7) → pink (#ec4899), dengan label: Diterima, Dikualifikasi, Penawaran Dikirim, Selesai.
   - State "won" tampilkan confetti/emoji 🎉 singkat; state "lost" tampilkan pesan empati + CTA hubungi manusia.

2. PASANG DI FLOW CHAT:
   - Sisipkan tracker sebagai kartu sticky di bawah chat window HANYA bila API
     mengembalikan conversation dengan ada lead terkait.
   - Jangan tampilkan tracker untuk pengunjung anonim tanpa lead.

3. AKSESIBILITAS & PRIVASI:
   - Tidak boleh menampilkan data pribadi (nama sales, telepon, email internal).
   - Teks bahasa Indonesia yang ramah, hindari istilah teknis CRM.

4. BUILD & QA:
   - Jalankan `npm run build` di ~/website/ tanpa error.
   - Deploy via `docker compose up -d --build web` (WAJIB compose, JANGAN docker run).
   - Verifikasi manual: buka rancan.biz.id, chat bot dengan sinyal B2B, pastikan
     tracker muncul dengan stage "Diterima" setelah lead dibuat di backend.

Laporkan: file yang dibuat/diubah, hasil build, screenshot (bila ada), dan
dependensi backend apa yang masih perlu dikoordinasikan dengan devops.
```

## 4. Dependensi / Prasyarat Sebelum Eksekusi

- [ ] Integration Service (Flow B) live — command `hermes.command.crm.lead.create` berfungsi.
- [ ] Sinkronisasi Flow C live — event `hermes.event.crm.lead.stage_changed` memperbarui Chatwoot label.
- [ ] Endpoint publik `/api/crm/status` tersedia (backend menyediakan data stage by conversation_id) — *saat ini belum ada*.
- [ ] Persetujuan owner soal tampilan stepper & copywriting.

## 5. Estimasi Effort

- Analis spesifikasi UI: 0.5 hari
- Developer komponen + API stub: 1 hari
- Tester & deploy: 0.5 hari
- **Total**: ± 2 hari kerja agent paralel.

---
*Dicatat sebagai backlog oleh lead pada 11 Oktober 2026 — tidak dieksekusi otomatis.*
