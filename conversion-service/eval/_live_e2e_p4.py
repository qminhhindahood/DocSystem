import io, sys, time, json, uuid, http.client
sys.path.insert(0, ".")
import pymupdf

def make_pdf(title):
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    lines = [
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
        "Độc lập - Tự do - Hạnh phúc",
        "",
        title,
        "Về việc thử nghiệm hệ thống chuyển đổi",
        "",
        "Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020 của Chính phủ về công tác văn thư;",
        "",
        "Điều 1. Ban hành quy trình thử nghiệm hệ thống chuyển đổi văn bản.",
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

def multipart(fields):
    boundary = uuid.uuid4().hex
    parts = []
    for name, filename, data in fields:
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: application/pdf\r\n\r\n".encode() + data + b"\r\n"
        )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"

conn = http.client.HTTPConnection("127.0.0.1", 8004, timeout=30)

# 1. single job -> report
body, ctype = multipart([("file", "qd.pdf", make_pdf("QUYẾT ĐỊNH"))])
conn.request("POST", "/convert", body=body, headers={"Content-Type": ctype, "X-User-Id": "p4-user"})
r = conn.getresponse(); data = json.loads(r.read())
job_id = data["jobId"]
for _ in range(60):
    conn.request("GET", f"/convert/{job_id}")
    r = conn.getresponse(); st = json.loads(r.read())
    if st["status"] not in ("queued", "processing"): break
    time.sleep(0.3)
print("1. single job:", st["status"], "conf", st.get("confidence"))

conn.request("GET", f"/convert/{job_id}/report")
r = conn.getresponse(); rep = json.loads(r.read())
print("2. report:", r.status, "| keys:", sorted(rep.keys())[:6],
      "| flagged:", len(rep["flaggedBlocks"]), "| demotions:", rep["demotions"],
      "| pageTypes:", rep["pageTypes"])

# 3. bulk: 2 valid + 1 corrupt
body, ctype = multipart([
    ("files", "a.pdf", make_pdf("QUYẾT ĐỊNH")),
    ("files", "b.pdf", make_pdf("THÔNG BÁO")),
    ("files", "bad.pdf", b"%PDF-1.4 not really a pdf beyond this"),
])
conn.request("POST", "/convert/bulk", body=body, headers={"Content-Type": ctype, "X-User-Id": "p4-user"})
r = conn.getresponse(); bulk = json.loads(r.read())
print("3. bulk:", r.status, "| count:", bulk["count"],
      "| jobs:", [(j["filename"], bool(j["jobId"]), j["error"]) for j in bulk["jobs"]])

# wait for bulk jobs to finish
for j in bulk["jobs"]:
    if not j["jobId"]: continue
    for _ in range(60):
        conn.request("GET", f"/convert/{j['jobId']}")
        r = conn.getresponse(); s = json.loads(r.read())
        if s["status"] not in ("queued", "processing"): break
        time.sleep(0.3)
    print("   bulk job", j["filename"], "->", s["status"])

# 4. metrics endpoint
conn.request("GET", "/metrics")
r = conn.getresponse(); mtext = r.read().decode()
print("4. metrics:", r.status, "| lines:", len(mtext.splitlines()))
for line in mtext.splitlines():
    if line.startswith(("conversion_jobs_total", "conversion_confidence_avg", "conversion_failure_rate")):
        print("   ", line)

# 5. health alerts field
conn.request("GET", "/health")
r = conn.getresponse(); h = json.loads(r.read())
print("5. health alerts:", h["alerts"])

ok = (st["status"] in ("completed", "completed_with_warnings")
      and r.status == 200 and bulk["count"] == 3
      and "conversion_jobs_total" in mtext)
print("P4 LIVE E2E:", "PASS" if ok else "FAIL")
