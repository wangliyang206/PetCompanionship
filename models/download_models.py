# -*- coding: utf-8 -*-
"""Download finished 3D models from batch json results.
Usage: python download_models.py [E:/git/PetCompanionship/models]
For each models/batch/<key>.json with status DONE, download GLB/FBX/preview
into models/<key>/ and create a model-viewer html.
"""
import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
BATCH = os.path.join(BASE, "batch")


def download(url: str, dest: str) -> None:
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())


VIEWER = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>__KEY__ 3D preview</title>
<script type="module" src="https://unpkg.com/@google/model-viewer@latest/dist/model-viewer.min.js"></script>
<style>
 body {{ margin:0; background:#FFF6E8; font-family:sans-serif; text-align:center; }}
 h1 {{ color:#8A6D3B; font-size:20px; margin:16px 0 4px; }}
 model-viewer {{ width:100vw; height:80vh; }}
</style></head><body>
<h1>__KEY__</h1>
<model-viewer src="__KEY__.glb" alt="__KEY__" auto-rotate camera-controls
 shadow-intensity="1" exposure="1.1" background-color="#FFF6E8"></model-viewer>
</body></html>
"""


def main() -> int:
    if not os.path.isdir(BATCH):
        print("no batch dir:", BATCH)
        return 1
    done, pending, failed = [], [], []
    for name in sorted(os.listdir(BATCH)):
        if not name.endswith(".json"):
            continue
        key = name[:-5]
        path = os.path.join(BATCH, name)
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            failed.append((key, "json parse: %s" % e))
            continue
        raw = data.get("raw_result", data)
        status = data.get("status") or raw.get("Status")
        if status != "DONE":
            pending.append(key)
            continue
        files = raw.get("ResultFile3Ds", [])
        if not files:
            failed.append((key, "no ResultFile3Ds"))
            continue
        outdir = os.path.join(BASE, key)
        os.makedirs(outdir, exist_ok=True)
        try:
            for f in files:
                url = f["Url"]
                ext = f.get("Type", "").lower()
                download(url, os.path.join(outdir, "%s.%s" % (key, ext)))
            preview = files[0].get("PreviewImageUrl")
            if preview:
                download(preview, os.path.join(outdir, "%s_preview.png" % key))
            html = VIEWER.replace("__KEY__", key)
            open(os.path.join(outdir, "viewer.html"), "w", encoding="utf-8").write(html)
            done.append(key)
        except Exception as e:
            failed.append((key, "download: %s" % e))
    print("DONE:", len(done), done)
    print("PENDING:", len(pending), pending)
    print("FAILED:", len(failed), failed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
