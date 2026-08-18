import io, sys, time, json, uuid, http.client, pathlib
sys.path.insert(0, ".")
import pymupdf

TOKEN = pathlib.Path(r"C:\Users\PC\Documents\LLM\.worktrees\conversion-service\backend\_test_token.txt").read_text().strip()
BASE = "http://127.0.0.1:3001"

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

conn = http.client.HTTPConnection("127.0.0.1", 3001, timeout=30)
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

c2 = http.client.HTTPConnection("127.0.0.1", 8004, timeout=15)
c2.request("GET", "/metrics")
r = c2.getresponse(); mtext = r.read().decode()
for line in mtext.splitlines():
    if line.startswith(("conversion_jobs_total", "conversion_confidence_avg")):
        print("5. metrics:", line)

import redis
rc = redis.Redis.from_url("redis://127.0.0.1:6379", decode_responses=True)
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

ok = (status.get("status") in ("completed", "completed_with_warnings") and len(docx) > 1000
      and "conversion_jobs_completed_total" in mtext and qlen == 0
      and bulk.get("count") == 2)
print("LIVE FULL-STACK E2E:", "PASS" if ok else "FAIL")
