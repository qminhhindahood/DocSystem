"""End-to-end smoke test: build a digital VN gov PDF, convert via /convert."""
import io
import sys
import time
sys.path.insert(0, ".")

import pymupdf
from fastapi.testclient import TestClient
from main import app

# ── Build a small digital Quyết định-style PDF ────────────────────────────────
doc = pymupdf.open()
page = doc.new_page(width=595, height=842)
lines = [
    "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
    "Độc lập - Tự do - Hạnh phúc",
    "",
    "QUYẾT ĐỊNH",
    "Về việc thành lập Ban Chỉ đạo chuyển đổi số",
    "",
    "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của Chính phủ về công tác văn thư;",
    "",
    "Điều 1. Thành lập Ban Chỉ đạo chuyển đổi số của Cục Văn thư và Lưu trữ nhà nước.",
    "Ban Chỉ đạo có nhiệm vụ xây dựng kế hoạch và tổ chức triển khai thực hiện.",
    "",
    "Điều 2. Quyết định này có hiệu lực kể từ ngày ký ban hành.",
    "Chánh Văn phòng và các cá nhân liên quan chịu trách nhiệm thi hành Quyết định này.",
]
y = 80
for line in lines:
    if line:
        page.insert_text((72, y), line, fontsize=13, fontname="helv")
    y += 24
pdf_bytes = doc.tobytes()
doc.close()

with TestClient(app) as client:
    resp = client.post(
        "/convert",
        files={"file": ("quyet_dinh_test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
    )
    print("POST /convert:", resp.status_code, resp.json())
    job_id = resp.json()["jobId"]

    st = None
    for _ in range(100):
        st = client.get(f"/convert/{job_id}").json()
        if st["status"] not in ("queued", "processing"):
            break
        time.sleep(0.2)
    print("JOB:", st["status"], "| confidence:", st.get("confidence"),
          "| degraded:", st.get("degradedPages"))

    if st["status"] in ("completed", "completed_with_warnings"):
        res = client.get(f"/convert/{job_id}/result")
        print("RESULT:", res.status_code, len(res.content), "bytes DOCX")
        from docx import Document
        d = Document(io.BytesIO(res.content))
        print("DOCX paragraphs:", len(d.paragraphs), "| sections:", len(d.sections))

    # ── Password-protected PDF -> 422 ─────────────────────────────────────────
    doc2 = pymupdf.open()
    p2 = doc2.new_page()
    p2.insert_text((72, 100), "Bí mật", fontsize=14, fontname="helv")
    locked = doc2.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner", user_pw="secret",
    )
    doc2.close()
    resp2 = client.post(
        "/convert",
        files={"file": ("locked.pdf", io.BytesIO(locked), "application/pdf")},
    )
    print("LOCKED PDF:", resp2.status_code, str(resp2.json().get("detail", ""))[:80])

    # ── Non-PDF -> 400 ────────────────────────────────────────────────────────
    resp3 = client.post(
        "/convert",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    print("NON-PDF:", resp3.status_code, resp3.json().get("detail"))

    # ── Bad magic bytes -> 400 ────────────────────────────────────────────────
    resp4 = client.post(
        "/convert",
        files={"file": ("fake.pdf", io.BytesIO(b"NOT A PDF FILE"), "application/pdf")},
    )
    print("BAD MAGIC:", resp4.status_code, resp4.json().get("detail"))
