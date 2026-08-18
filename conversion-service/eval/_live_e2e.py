import io, sys, time, json, urllib.request
sys.path.insert(0, ".")
import pymupdf

doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
lines = [
    "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
    "Độc lập - Tự do - Hạnh phúc",
    "",
    "QUYẾT ĐỊNH",
    "Về việc phê duyệt kế hoạch chuyển đổi số",
    "",
    "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của Chính phủ về công tác văn thư;",
    "",
    "Điều 1. Phê duyệt kế hoạch chuyển đổi số năm 2025 của Cục Văn thư và Lưu trữ nhà nước.",
    "Điều 2. Quyết định này có hiệu lực kể từ ngày ký.",
]
y = 80
for line in lines:
    if line:
        page.insert_text((72, y), line, fontsize=13, fontname="helv")
    y += 24
pdf_bytes = doc.tobytes()
doc.close()

BASE = "http://127.0.0.1:8004"

# multipart upload via http.client (no external deps)
import http.client, uuid
boundary = uuid.uuid4().hex
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="quyet_dinh_live.pdf"\r\n'
    f"Content-Type: application/pdf\r\n\r\n"
).encode() + pdf_bytes + f"\r\n--{boundary}--\r\n".encode()

conn = http.client.HTTPConnection("127.0.0.1", 8004, timeout=30)
conn.request("POST", "/convert", body=body,
             headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                      "X-User-Id": "live-user"})
resp = conn.getresponse()
data = json.loads(resp.read())
print("POST /convert:", resp.status, data)
job_id = data["jobId"]

status = None
for _ in range(60):
    conn.request("GET", f"/convert/{job_id}")
    r = conn.getresponse()
    status = json.loads(r.read())
    if status["status"] not in ("queued", "processing"):
        break
    time.sleep(0.3)
print("STATUS:", status["status"], "| confidence:", status.get("confidence"),
      "| degraded:", status.get("degradedPages"))

conn.request("GET", f"/convert/{job_id}/result")
r = conn.getresponse()
docx = r.read()
print("RESULT:", r.status, len(docx), "bytes,",
      r.getheader("Content-Type", "")[:40])

# verify DOCX opens
from docx import Document
d = Document(io.BytesIO(docx))
print("DOCX OK: paragraphs =", len(d.paragraphs), "| sections =", len(d.sections))

# quota check: 429 after limit (limit is 20/day; just verify header path works)
print("LIVE E2E: PASS" if status["status"] in ("completed", "completed_with_warnings") and len(docx) > 1000 else "LIVE E2E: FAIL")
