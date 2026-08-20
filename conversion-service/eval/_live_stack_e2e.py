import io, sys, time, json, uuid, http.client, pathlib
sys.path.insert(0, ".")
import pymupdf

import os
# Auth token for the backend. Resolution order:
#   1. E2E_TOKEN env var
#   2. <project>/backend/_test_token.txt (relative to this file's repo root)
#   3. fail with a clear message
_here = pathlib.Path(__file__).resolve()
_repo_root = _here.parents[2]  # .../conversion-service-standalone
_token_file = _repo_root / "backend" / "_test_token.txt"
_env_token = os.environ.get("E2E_TOKEN", "").strip()
if _env_token:
    TOKEN = _env_token
elif _token_file.exists():
    TOKEN = _token_file.read_text().strip()
else:
    raise SystemExit(
        "No auth token found. Set E2E_TOKEN or create "
        f"{_token_file} with a valid backend JWT."
    )
BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:3001")
CONV = os.environ.get("E2E_CONVERSION", "http://127.0.0.1:8004")
REDIS_URL = os.environ.get("E2E_REDIS", "redis://127.0.0.1:6379")

def _hostport(url, default_port):
    u = url.split("://", 1)[-1].rstrip("/")
    host, _, port = u.partition(":")
    return host or "127.0.0.1", int(port) if port else default_port

BE_HOST, BE_PORT = _hostport(BASE, 3001)
CV_HOST, CV_PORT = _hostport(CONV, 8004)

def make_pdf(title):
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    lines = [
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
        "Độc lập - Tự do - Hạnh phúc",
        "",
        title,
        "Về việc kiểm thử luồng chuyển đổi trực tuyến",
        "",
        "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của Chính phủ;",
        "",
        "Điều 1. Ban hành quy trình kiểm thử toàn diện hệ thống chuyển đổi văn bản.",
        "Điều 2. Quyết định này có hiệu lực kể từ ngày ký.",
    ]
    y = 80
    for line in lines:
        if line:
            page.insert_text((72, y), line, fontsize=13, fontname="helv")
        y += 24
    b = doc.tobytes()
    doc.close()
    return b

def multipart(name, filename, data):
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"

conn = http.client.HTTPConnection(BE_HOST, BE_PORT, timeout=30)
AUTH = {"Authorization": f"Bearer {TOKEN}"}

body, ctype = multipart("file", "live_stack.pdf", make_pdf("QUYẾT ĐỊNH"))
conn.request("POST", "/api/convert", body=body, headers={"Content-Type": ctype, **AUTH})
r = conn.getresponse(); data = json.loads(r.read())
print("1. POST /api/convert:", r.status, data)
job_id = data["jobId"]

status = None
for _ in range(120):
    conn.request("GET", f"/api/convert/{job_id}", headers=AUTH)
    r = conn.getresponse(); status = json.loads(r.read())
    if status.get("status") not in ("queued", "processing"):
        break
    time.sleep(0.5)
print("2. status:", status.get("status"), "| conf:", status.get("confidence"),
      "| degraded:", status.get("degradedPages"))

conn.request("GET", f"/api/convert/{job_id}/report", headers=AUTH)
r = conn.getresponse(); rep = json.loads(r.read())
print("3. report:", r.status, "| flagged:", len(rep.get("flaggedBlocks", [])),
      "| demotions:", rep.get("demotions"), "| pageTypes:", rep.get("pageTypes"))

conn.request("GET", f"/api/convert/{job_id}/result", headers=AUTH)
r = conn.getresponse(); docx = r.read()
print("4. result:", r.status, len(docx), "bytes,", r.getheader("Content-Type", "")[:40])
from docx import Document
d = Document(io.BytesIO(docx))
print("   DOCX opens: sections =", len(d.sections))

c2 = http.client.HTTPConnection(CV_HOST, CV_PORT, timeout=15)
c2.request("GET", "/metrics")
r = c2.getresponse(); mtext = r.read().decode()
for line in mtext.splitlines():
    if line.startswith(("conversion_jobs_total", "conversion_confidence_avg")):
        print("5. metrics:", line)

import redis
rc = redis.Redis.from_url(REDIS_URL, decode_responses=True)
qlen = rc.llen("conversion_queue")
print("6. queue depth:", qlen)

# 7. bulk through backend
body, ctype = multipart("files", "bulk_a.pdf", make_pdf("THÔNG BÁO"))
body2, ctype2 = multipart("files", "bulk_b.pdf", make_pdf("CÔNG VĂN"))
# two-file multipart
boundary = uuid.uuid4().hex
parts = []
for fn, data in (("bulk_a.pdf", make_pdf("THÔNG BÁO")), ("bulk_b.pdf", make_pdf("CÔNG VĂN"))):
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{fn}\"\r\nContent-Type: application/pdf\r\n\r\n".encode() + data + b"\r\n"
    )
bbody = b"".join(parts) + f"--{boundary}--\r\n".encode()
conn.request("POST", "/api/convert/bulk", body=bbody, headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **AUTH})
r = conn.getresponse(); bulk = json.loads(r.read())
print("7. bulk:", r.status, "| count:", bulk.get("count"), "| jobs:", [(j["filename"], j["jobId"] is not None) for j in bulk.get("jobs", [])])

# ─── BYOK vision gate (real stack) ────────────────────────────────────────────
# The scanned-no-key 422 check always runs (no Gemini key needed). The real-key
# transcription check runs only when E2E_GEMINI_API_KEY is set — that is the
# "fully real" path: the backend stores the key encrypted, attaches it to the
# job, and the worker calls Gemini for real.

def make_scanned_pdf():
    """A page with a full-page raster image and NO text layer -> SCANNED."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([100, 120, 1100, 160], fill="black")
    draw.rectangle([100, 300, 1100, 320], fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=buf.getvalue())
    b = doc.tobytes()
    doc.close()
    return b

byok_nokey_ok = False
byok_realkey_ok = None  # None = skipped (no key provided)

# 8a. Ensure the test user has NO stored key, then a scanned upload must 422.
conn.request("DELETE", "/api/settings/llm", headers=AUTH)
r = conn.getresponse(); r.read()
body, ctype = multipart("file", "byok_scan.pdf", make_scanned_pdf())
conn.request("POST", "/api/convert", body=body, headers={"Content-Type": ctype, **AUTH})
r = conn.getresponse(); rej = json.loads(r.read())
print("8. scanned upload, no key:", r.status, "|", str(rej.get("error", ""))[:60])
byok_nokey_ok = (r.status == 422 and "trang quét" in str(rej.get("error", "")))

# 8b. Real-key path (optional).
GEMINI_KEY = os.environ.get("E2E_GEMINI_API_KEY", "").strip()
if GEMINI_KEY:
    cfg = json.dumps({
        "provider": "gemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": os.environ.get("E2E_GEMINI_MODEL", "gemini-2.5-flash"),
        "apiKey": GEMINI_KEY,
    })
    conn.request("POST", "/api/settings/llm", body=cfg,
                 headers={"Content-Type": "application/json", **AUTH})
    r = conn.getresponse(); saved = json.loads(r.read())
    print("9. save gemini key:", r.status, "| hasApiKey:", saved.get("config", {}).get("hasApiKey"))

    body, ctype = multipart("file", "byok_scan_key.pdf", make_scanned_pdf())
    conn.request("POST", "/api/convert", body=body, headers={"Content-Type": ctype, **AUTH})
    r = conn.getresponse(); sub = json.loads(r.read())
    print("10. scanned upload, with key:", r.status, sub.get("jobId"))
    if r.status == 202 and sub.get("jobId"):
        vjob = sub["jobId"]
        vstatus = None
        for _ in range(240):
            conn.request("GET", f"/api/convert/{vjob}", headers=AUTH)
            r = conn.getresponse(); vstatus = json.loads(r.read())
            if vstatus.get("status") not in ("queued", "processing"):
                break
            time.sleep(1.0)
        print("11. vision status:", vstatus.get("status"), "| conf:", vstatus.get("confidence"),
              "| degraded:", vstatus.get("degradedPages"))
        conn.request("GET", f"/api/convert/{vjob}/result", headers=AUTH)
        r = conn.getresponse(); vdocx = r.read()
        vtext = ""
        if r.status == 200 and len(vdocx) > 500:
            from docx import Document as _Doc
            vd = _Doc(io.BytesIO(vdocx))
            vtext = " ".join(p.text for p in vd.paragraphs)
        # The fake-free real path transcribes whatever Gemini sees; we only
        # assert the job completed and produced a non-trivial DOCX here.
        byok_realkey_ok = (vstatus.get("status") in ("completed", "completed_with_warnings")
                           and len(vdocx) > 500)
        print("12. vision DOCX:", len(vdocx), "bytes | text len:", len(vtext))
    else:
        byok_realkey_ok = False
    # Clean up the stored key.
    conn.request("DELETE", "/api/settings/llm", headers=AUTH)
    r = conn.getresponse(); r.read()
else:
    print("9-12. real-key vision path SKIPPED (set E2E_GEMINI_API_KEY to run)")

ok = (status.get("status") in ("completed", "completed_with_warnings") and len(docx) > 1000
      and "conversion_jobs_completed_total" in mtext and qlen == 0
      and bulk.get("count") == 2
      and byok_nokey_ok
      and (byok_realkey_ok is None or byok_realkey_ok))
print("BYOK no-key 422:", "PASS" if byok_nokey_ok else "FAIL")
if byok_realkey_ok is not None:
    print("BYOK real-key vision:", "PASS" if byok_realkey_ok else "FAIL")
print("LIVE FULL-STACK E2E:", "PASS" if ok else "FAIL")
