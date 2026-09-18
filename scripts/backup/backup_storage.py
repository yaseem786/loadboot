#!/usr/bin/env python3
"""LoadBoot - back up Supabase Storage objects (carrier COI / W-9 / authority PDFs).

pg_dump only saves storage.objects METADATA. The actual files live in the
Storage service and are lost with it, so they need their own copy.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUT_DIR
"""
import os, sys, pathlib, urllib.parse
import urllib.request, json

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OUT = pathlib.Path(os.environ.get("OUT_DIR", "storage"))
H = {"Authorization": f"Bearer {KEY}", "apikey": KEY}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method,
                               headers={**H, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read() or "null")


def download(bucket, key, dest):
    safe = urllib.parse.quote(key)
    r = urllib.request.Request(f"{URL}/storage/v1/object/{bucket}/{safe}", headers=H)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(r, timeout=300) as resp, open(dest, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)


def walk(bucket, prefix=""):
    """Storage list() is one level deep; folders come back with id=None."""
    offset = 0
    while True:
        items = req("POST", f"/storage/v1/object/list/{bucket}",
                    {"prefix": prefix, "limit": 100, "offset": offset,
                     "sortBy": {"column": "name", "order": "asc"}}) or []
        if not items:
            return
        for it in items:
            name = f"{prefix}{it['name']}"
            if it.get("id") is None:
                yield from walk(bucket, name + "/")
            else:
                yield name
        if len(items) < 100:
            return
        offset += 100


buckets = req("GET", "/storage/v1/bucket") or []
total = bytes_ = 0
for b in buckets:
    bid = b["id"]
    print(f"==> bucket {bid} (public={b.get('public')})", flush=True)
    for key in walk(bid):
        dest = OUT / bid / key
        try:
            download(bid, key, dest)
        except Exception as e:                      # keep going, report at the end
            print(f"    !! FAILED {bid}/{key}: {e}", file=sys.stderr)
            continue
        total += 1
        bytes_ += dest.stat().st_size

print(f"==> {total} objects, {bytes_/1e6:.1f} MB")
# Sanity gate - prod had 259 objects on 17 Sep 2026. A near-empty run means a
# broken token or a listing change, not an empty Storage.
if total < 50:
    sys.exit(f"FATAL: only {total} objects downloaded - refusing to call this a backup")
