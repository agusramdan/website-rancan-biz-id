#!/usr/bin/env python3
"""Tambahkan env hybrid handover ke /home/ubuntu/website/.env (idempotent).
CW_ADMIN_TOKEN dibaca dari CHATWOOT_API_TOKEN di /home/ubuntu/chatwoot/.env.
"""
import os
import re
import sys

WEBSITE_ENV = "/home/ubuntu/website/.env"
CHATWOOT_ENV = "/home/ubuntu/chatwoot/.env"


def read_env_kv(path):
    kv = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            kv[k.strip()] = v.strip()
    return kv


def main():
    cw = read_env_kv(CHATWOOT_ENV)
    token = cw.get("CHATWOOT_API_TOKEN", "")
    if not token:
        print("ERROR: CHATWOOT_API_TOKEN tidak ditemukan di", CHATWOOT_ENV)
        sys.exit(1)

    additions = {
        "CHATWOOT_INTERNAL_URL": "http://chatwoot-rails-1:3000",
        "CHATWOOT_ACCOUNT_ID": "2",
        "CHATWOOT_INBOX_ID": "2",
        "CHATWOOT_WEBSITE_TOKEN": "oALwvhtgmK1DaeqqmcUPVD7x",
        "CW_ADMIN_TOKEN": token,
        "TAKEOVER_CACHE_TTL_MS": "8000",
        "AI_GATEWAY_KEY": "<GATEWAY_KEY disimpan di .env — sudah dirotasi 11 Okt 2026>",
    }

    existing = ""
    if os.path.exists(WEBSITE_ENV):
        with open(WEBSITE_ENV, "r", encoding="utf-8") as f:
            existing = f.read()

    have = set(re.findall(r"^([A-Z0-9_]+)=", existing, flags=re.M))
    lines = []
    if not existing.endswith("\n") and existing:
        lines.append("")
    lines.append("# === Hybrid handover Chatwoot (spec docs/HANDOVER-SPEC.md §4) ===")
    added = []
    for k, v in additions.items():
        if k in have:
            continue
        lines.append(f"{k}={v}")
        added.append(k)
    if added:
        with open(WEBSITE_ENV, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(WEBSITE_ENV, 0o600)
        print("Ditambahkan:", ", ".join(added))
    else:
        print("Semua key sudah ada — tidak ada perubahan.")


if __name__ == "__main__":
    main()
