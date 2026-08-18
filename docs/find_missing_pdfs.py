import os
import re
import urllib.request
import urllib.parse
from bs4 import BeautifulSoup

target_dir = r"C:\Users\PC\Documents\LLM\docs\templates-gemini"
os.makedirs(target_dir, exist_ok=True)

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

missing_types = {
    "1_Decision_and_Regulatory": [
        {"name": "Quy_che.pdf", "keywords": ["quy-che", "quy che", "Quy chế"]},
        {"name": "Quy_dinh.pdf", "keywords": ["quy-dinh", "quy dinh", "Quy định"]}
    ],
    "2_Planning_and_Proposals": [
        {"name": "Chuong_trinh.pdf", "keywords": ["chuong-trinh", "chuong trinh", "Chương trình"]},
        {"name": "Phuong_an.pdf", "keywords": ["phuong-an", "phuong an", "Phương án"]},
        {"name": "De_an.pdf", "keywords": ["de-an", "de an", "Đề án"]},
        {"name": "Du_an.pdf", "keywords": ["du-an", "du an", "Dự án"]},
        {"name": "To_trinh.pdf", "keywords": ["to-trinh", "to trinh", "Tờ trình"]}
    ],
    "3_Reporting_and_Records": [
        {"name": "Bien_ban.pdf", "keywords": ["bien-ban", "bien ban", "Biên bản"]}
    ],
    "4_Communication": [
        {"name": "Thong_cao.pdf", "keywords": ["thong-cao", "thong cao", "Thông cáo"]},
        {"name": "Cong_dien.pdf", "keywords": ["cong-dien", "cong dien", "Công điện"]},
        {"name": "Thu_cong.pdf", "keywords": ["thu-cong", "thu ngỏ", "Thư công", "thu-chuc"]}
    ],
    "5_Multi_Party": [
        {"name": "Hop_dong.pdf", "keywords": ["hop-dong", "hop dong", "Hợp đồng"]},
        {"name": "Ban_ghi_nho.pdf", "keywords": ["ban-ghi-nho", "ghi nho", "Bản ghi nhớ", "MOU"]}
    ],
    "6_Administrative_Forms": [
        {"name": "Giay_uy_quyen.pdf", "keywords": ["uy-quyen", "giay uy quyen", "Giấy ủy quyền"]},
        {"name": "Giay_gioi_thieu.pdf", "keywords": ["gioi-thieu", "giay gioi thieu", "Giấy giới thiệu"]},
        {"name": "Giay_nghi_phep.pdf", "keywords": ["nghi-phep", "giay nghi phep", "Giấy nghỉ phép"]}
    ],
    "7_Routing_Forms": [
        {"name": "Phieu_gui.pdf", "keywords": ["phieu-gui", "phieu gui", "Phiếu gửi"]},
        {"name": "Phieu_chuyen.pdf", "keywords": ["phieu-chuyen", "phieu chuyen", "Phiếu chuyển"]},
        {"name": "Phieu_bao.pdf", "keywords": ["phieu-bao", "phieu bao", "Phiếu báo"]}
    ]
}

print("Script template created.")
