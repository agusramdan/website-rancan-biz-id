#!/usr/bin/env bash
# E2E test — Hybrid Handover + Takeover Guard (website F&B Rancan)
# Sesuai HANDOVER-SPEC.md §6. Jalankan dari host: bash scripts/e2e_handover_test.sh
# Exit 0 = semua pass; exit 1 = ada fail.
set -u
BASE="http://127.0.0.1:3100"
CW="http://127.0.0.1:3001/api/v1/accounts/2"
TOK="$(grep -E '^CW_ADMIN_TOKEN=' /home/ubuntu/website/.env | cut -d= -f2 | tr -d '\"')"
PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== (a) Chat normal: AI menjawab + pesan masuk Chatwoot =="
SID="e2e-$(date +%s)"
MODE=$(curl -s -D - -o /tmp/e2e_sse.txt -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"messages\":[{\"role\":\"user\",\"content\":\"Rekomendasi kopi susu? ($SID / e2e-a)\"}]}" \
  | tr -d '\r' | grep -i '^x-chat-mode:' | awk '{print $2}')
echo "  X-Chat-Mode: $MODE"
[ "$(echo $MODE | tr -d ' ')" = "ai" ] && ok "mode=ai" || bad "mode=$MODE (harus ai)"
grep -q 'data:' /tmp/e2e_sse.txt && ok "SSE stream berisi data" || bad "SSE kosong"
grep -qE 'kopi|susu|rekomend' /tmp/e2e_sse.txt && ok "jawaban AI menyebut kopi/susu" || bad "jawaban AI tidak relevan"
# Cari conversation Chatwoot untuk session INI secara deterministik:
# log container mencetak "sync ok session=<SID> conv=<id>" saat pesan pengunjung
# tersinkron. Pencarian via marker teks rawan race antar-run (marker lama masih ada).
CONV=""
sleep 3   # beri waktu fire-and-forget syncVisitorMessage mendarat
for i in $(seq 1 15); do
  CONV=$(docker logs --since 10m rancan-website 2>&1 | \
    grep "sync ok session=$SID " | tail -1 | \
    sed -n 's/.*conv=\([0-9]*\).*/\1/p')
  [ -n "$CONV" ] && break
  sleep 2
done
[ -n "$CONV" ] && ok "conversation Chatwoot ditemukan: $CONV (via log sync)" || { bad "conversation tidak ditemukan di log sync"; echo "RINGKASAN: PASS=$PASS FAIL=$FAIL"; exit 1; }
DETAIL=$(curl -s -H "api_access_token: $TOK" "$CW/conversations/$CONV")
echo "$DETAIL" | python3 -c "
import json,sys
d=json.load(sys.stdin)
st=d.get('status'); asg=d.get('meta',{}).get('assignee_type')
print('  status:',st,'| assignee:',asg)
assert st == 'pending', 'status harus pending (bot menangani)'
" && ok "conversation pending + AgentBot (conv $CONV)" || bad "state conversation (a)"
# Pesan incoming diverifikasi via endpoint /messages (GET /:id hanya embed 1 pesan)
curl -s -H "api_access_token: $TOK" "$CW/conversations/$CONV/messages?per=20" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pl=d.get('payload', [])
inc=[m for m in pl if m.get('message_type')==0]
out=[m for m in pl if m.get('message_type') in (1,3)]
print('  incoming:',len(inc),'| outgoing/echo:',len(out))
assert inc, 'TIDAK ADA pesan incoming di Chatwoot'
assert any('$SID' in (m.get('content') or '') for m in inc), 'isi pesan e2e-a tidak ketemu'
" && ok "pesan pengunjung tercatat di Chatwoot (conv $CONV)" || bad "sinkronisasi Chatwoot (a)"
# Tunggu bridge men-stamp last_bot_reply_at (bot reply via webhook butuh ~10-20 dtk
# karena LLM). Polling sampai 60 dtk — JANGAN sleep statis (race condition).
STAMP=0
for i in $(seq 1 30); do
  STAMP=$(curl -s -H "api_access_token: $TOK" "$CW/conversations/$CONV" | \
    python3 -c "import json,sys; print(json.load(sys.stdin).get('custom_attributes',{}).get('last_bot_reply_at',0) or 0)")
  [ "${STAMP:-0}" != "0" ] && break
  sleep 2
done
[ "${STAMP:-0}" != "0" ] && [ -n "$STAMP" ] && ok "bridge stamp last_bot_reply_at=$STAMP" || bad "stamp last_bot_reply_at tidak muncul dalam 60 dtk (bridge bermasalah)"

echo "== (b) Takeover: bot berhenti =="
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d '{"status":"open"}' "$CW/conversations/$CONV/toggle_status" > /dev/null
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d '{"assignee_id":3}' "$CW/conversations/$CONV/assignments" > /dev/null
echo "  conv $CONV -> status=open, assignee=3 (Rancan agent)"
sleep 9   # lewati cache guard 8 dtk
MODE2=$(curl -s -D - -o /tmp/e2e_h.json -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"messages\":[{\"role\":\"user\",\"content\":\"masih ada? (e2e-b)\"}]}" \
  | tr -d '\r' | grep -i '^x-chat-mode:' | awk '{print $2}')
echo "  X-Chat-Mode: $MODE2"
[ "$(echo $MODE2 | tr -d ' ')" = "human_active" ] && ok "mode=human_active (bot berhenti)" || bad "mode=$MODE2 (harus human_active)"
python3 -c "
import json
d=json.load(open('/tmp/e2e_h.json'))
assert d.get('mode')=='human_active', d
assert 'Rancan' in d.get('message','')
" && ok "JSON body human_active valid" || bad "body human_active"

echo "== (c) Balasan human masuk via polling =="
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d '{"content":"Halo kak, tim Rancan disini. Ada yang bisa dibantu? (e2e-c)","message_type":"outgoing"}' \
  "$CW/conversations/$CONV/messages" > /dev/null
sleep 2
POLL=$(curl -s "$BASE/api/chat/poll?sessionId=$SID&after=0")
echo "  poll: $(echo $POLL | head -c 220)"
echo "$POLL" | python3 -c "
import json,sys
d=json.load(sys.stdin)
msgs=[m for m in d.get('messages',[]) if 'e2e-c' in (m.get('content') or '')]
assert msgs, 'balasan human tidak muncul di poll: %r' % d
print('  balasan human terdeteksi:', msgs[0]['content'][:60])
" && ok "balasan agen diteruskan ke web via /api/chat/poll" || bad "polling balasan human (c)"

echo "== (d) Handback: guard kembali ke AI =="
# Handback LENGKAP (semua endpoint v4.18 terverifikasi):
#  1. lepas assignee human (assignee_id=0) — assignee kembali ke AgentBot otomatis di conv baru,
#     tapi di conv berjalan harus dilepas manual;
#  2. status kembali 'pending';
#  3. RESET baseline stamp: balasan human (e2e-c) lebih baru dari stamp bot lama, jadi
#     tanpa reset guard akan menganggap "ada balasan human setelah bot" SELAMANYA.
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d '{"assignee_id":0}' "$CW/conversations/$CONV/assignments" > /dev/null
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d '{"status":"pending"}' "$CW/conversations/$CONV/toggle_status" > /dev/null
NOW=$(date +%s)
curl -s -X POST -H "api_access_token: $TOK" -H "Content-Type: application/json" \
  -d "{\"custom_attributes\":{\"last_bot_reply_at\":$NOW},\"merge\":true}" \
  "$CW/conversations/$CONV/custom_attributes" > /dev/null
echo "  conv $CONV -> unassign + status=pending + stamp reset ke $NOW"
sleep 9
MODE3=$(curl -s -D - -o /tmp/e2e_d.txt -X POST "$BASE/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"messages\":[{\"role\":\"user\",\"content\":\"tes kembali ke bot (e2e-d)\"}]}" \
  | tr -d '\r' | grep -i '^x-chat-mode:' | awk '{print $2}')
[ "$(echo $MODE3 | tr -d ' ')" = "ai" ] && ok "mode kembali ai setelah handback" || bad "mode=$MODE3 (harus ai)"

echo ""
echo "RINGKASAN: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
