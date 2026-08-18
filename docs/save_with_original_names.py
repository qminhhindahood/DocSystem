import os
import urllib.parse
import urllib.request

target_dir = r"C:\Users\PC\Documents\LLM\docs\templates-gemini"
os.makedirs(target_dir, exist_ok=True)

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

sources = [
    # 1_Decision_and_Regulatory
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_7/20/592026ttbgddtsignedf936e_20720267.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/Data/doc//2026/hoctapcongdong/2026_6/11/thong-tu-462026-quy-dinh-dieu-le-truong-thn_116202612.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_6/15/20260527-qd-582-kien-truc-nen-tang-hoan-thien-1_156202620.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_6/6/20241224-nghi-dinh-337-cpsigned_66202619.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_7/20/265-nd-xpvphc-trong-thuc-hanh-chong-lang-phi_20720268.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_3/25/chi-thi-06-ct-tu-ve-lanh-dao-chi-dao-thuc-hien-nq-205-2025-qh15_25320268.pdf"
    },
    {
        "cat": "1_Decision_and_Regulatory",
        "url": "https://f1.hcm.edu.vn/Data/doc//2026/hoctapcongdong/2026_5/11/nghi-quyet-xa-hoi-hoc-tapsignedsignedsigned_115202616.pdf"
    },

    # 2_Planning_and_Proposals
    {
        "cat": "2_Planning_and_Proposals",
        "url": "https://f1.hcm.edu.vn/Data/doc//2026/hoctapcongdong/2026_7/24/18072026khtochuchoinghiasean4signed1_24720265.pdf"
    },
    {
        "cat": "2_Planning_and_Proposals",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_3/6/cv-1808truyen-thong-dm-ktkt-120-nghesigned_63202615.pdf"
    },

    # 3_Reporting_and_Records
    {
        "cat": "3_Reporting_and_Records",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/pgdmamnon/2026_7/12/6696gdmn-cv-bao-cao-so-lieu-nq30-nh-25-26_127202614.pdf"
    },
    {
        "cat": "3_Reporting_and_Records",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/pgdmamnon/2026_4/10/3058080426cv-gui-phuong-xa-bao-cao-nd-277_104202619.pdf"
    },
    {
        "cat": "3_Reporting_and_Records",
        "url": "https://f1.hcm.edu.vn/data/hcmedu/hoidonghieutruong/2023_7/176-bcthuchiendeantongthe8nganh_147202391226.pdf"
    },
    {
        "cat": "3_Reporting_and_Records",
        "url": "https://f1.hcm.edu.vn/data/doc/2025/hcmedu/2025_12/23/61492025ban-tong-hop-y-kien-gop-y120-nghe-ub-mttqvnskhcnsnvstpstc-cs-gdnn_2312202510.pdf"
    },

    # 4_Communication
    {
        "cat": "4_Communication",
        "url": "https://f1.hcm.edu.vn/data/doc/2025/congdoan/2025_2/5/cv-so-274-de-nghi-tra-loi-phieu-khao-sat-phuc-vu-de-an-nha-o-cho-cbccvc-va-nld_52202518.pdf"
    },
    {
        "cat": "4_Communication",
        "url": "https://f1.hcm.edu.vn/Data/doc//2026/hoctapcongdong/2026_7/24/7280201726-vanbanhuongdanubnd-capxasigned1_24720265.pdf"
    },
    {
        "cat": "4_Communication",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/kiemtra-phapche/2026_5/19/277tbdsthanhvienhdpbgdpl_19520269.pdf"
    },
    {
        "cat": "4_Communication",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/hcmedu/2026_7/21/7213v4tuyensinhbosungthpt2026signed2607211103081_217202613.pdf"
    },

    # 5_Multi_Party
    {
        "cat": "5_Multi_Party",
        "url": "https://f1.hcm.edu.vn/data/hcmedu/congdoan/attachments/2018_2/thoatuanhoptacvoitongctybuudienvietnam_52201816.pdf"
    },
    {
        "cat": "5_Multi_Party",
        "url": "https://f1.hcm.edu.vn/data/hcmedu/vanphong/cv-tiep-doan-nuoc-ngoai_44202314.pdf"
    },

    # 6_Administrative_Forms
    {
        "cat": "6_Administrative_Forms",
        "url": "https://f1.hcm.edu.vn/data/doc/2026/vanphongdanguy/2026_6/5/27_56202614.pdf"
    },
    {
        "cat": "6_Administrative_Forms",
        "url": "https://f1.hcm.edu.vn/data/doc/2024/congdoan/2024_5/10/gm-tham-du-le-khai-mac-thang-cong-nhan-bch-va-ubkt_105202413.pdf"
    }
]

# Remove old generic alias files if present
generic_names = [
    "Quy_che.pdf", "Quy_dinh.pdf", "Chuong_trinh.pdf", "Phuong_an.pdf",
    "De_an.pdf", "Du_an.pdf", "To_trinh.pdf", "Bien_ban.pdf",
    "Thong_cao.pdf", "Cong_dien.pdf", "Thu_cong.pdf", "Hop_dong.pdf",
    "Ban_ghi_nho.pdf", "Giay_uy_quyen.pdf", "Giay_gioi_thieu.pdf",
    "Giay_nghi_phep.pdf", "Phieu_gui.pdf", "Phieu_chuyen.pdf", "Phieu_bao.pdf"
]

for root, dirs, files in os.walk(target_dir):
    for f in files:
        if f in generic_names:
            fp = os.path.join(root, f)
            print(f"Removing generic file: {fp}")
            os.remove(fp)

for src in sources:
    cat_dir = os.path.join(target_dir, src['cat'])
    os.makedirs(cat_dir, exist_ok=True)

    # Get original filename from URL
    original_filename = os.path.basename(urllib.parse.urlparse(src['url']).path)
    filepath = os.path.join(cat_dir, original_filename)

    print(f"Downloading original: {original_filename} -> {src['cat']}")
    try:
        req = urllib.request.Request(src['url'], headers=headers)
        with urllib.request.urlopen(req) as resp, open(filepath, 'wb') as f:
            data = resp.read()
            f.write(data)
            print(f"  OK: {len(data)} bytes")
    except Exception as e:
        print(f"  ERR: {e}")
