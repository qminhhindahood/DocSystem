import * as monaco from "monaco-editor";

export const DOCUMENT_TEMPLATES: Record<string, string> = {
  "quyet-dinh": `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---o0o---

Số: .../QĐ-[TÊN CƠ QUAN]

[TÊN CƠ QUAN BAN HÀNH]
-------
[Tên địa phương], ngày ... tháng ... năm ...

QUYẾT ĐỊNH

V/v [Nội dung quyết định]

[CƠ QUAN CÓ THẨM QUYỀN]
-------

Căn cứ Luật Tổ chức chính quyền địa phương ngày 19 tháng 6 năm 2015;
Căn cứ Luật sửa đổi, bổ sung một số điều của Luật Tổ chức chính quyền
địa phương ngày 22 tháng 11 năm 2019;
Căn cứ [Văn bản pháp lý căn cứ khác];
Căn cứ Nghị quyết số ... ngày ... của [cơ quan có thẩm quyền];
Xét [đề nghị của...]/[thực hiện...],

QUYẾT ĐỊNH:

Điều 1. [Nội dung quyết định chính]

Điều 2. [Hiệu lực thi hành]
Quyết định này có hiệu lực thi hành kể từ ngày ký.

Điều 3. [Trách nhiệm thi hành]

TM. [CƠ QUAN BAN HÀNH]
[CHỨC VỤ]
[ĐÓNG DẤU]
[KÝ, GHI RÕ HỌ VÀ TÊN]`,

  "chi-thi": `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---o0o---

Số: .../CT-[TÊN CƠ QUAN]

CHỈ THỊ

V/v [Nội dung chỉ thị]

Điều 1. [Mục tiêu, yêu cầu cần đạt]
Điều 2. [Nội dung chỉ đạo, giải pháp thực hiện]
Điều 3. [Tổ chức thực hiện]

TM. [CƠ QUAN BAN HÀNH]
[CHỨC VỤ]
[ĐÓNG DẤU]`,

  "bao-cao": `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---o0o---

BÁO CÁO

V/v [Nội dung báo cáo]

I. KẾT QUẢ THỰC HIỆN
II. ĐÁNH GIÁ CHUNG
III. PHƯƠNG HƯỚNG, NHIỆM VỤ TIẾP THEO

ĐẠI DIỆN [CƠ QUAN/ĐƠN VỊ]
[Chức vụ]
[ĐÓNG DẤU]`,

  "cong-van": `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---o0o---

Số: .../...-[TÊN CƠ QUAN]

CÔNG VĂN

V/v [Nội dung công văn]

Kính gửi: [Cơ quan nhận công văn]

1. [Nội dung thông tin 1]
2. [Nội dung thông tin 2]

TM. [CƠ QUAN BAN HÀNH]
[CHỨC VỤ]
[KÝ, GHI RÕ HỌ VÀ TÊN]`,

  "thong-bao": `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---o0o---

Số: .../TB-[TÊN CƠ QUAN]

THÔNG BÁO

V/v [Nội dung thông báo]

1. [Nội dung thông báo 1]
2. [Nội dung thông báo 2]

TM. [CƠ QUAN BAN HÀNH]
[CHỨC VỤ]
[KÝ, GHI RÕ HỌ VÀ TÊN]`,
};

export const VIETNAMESE_COMPLETIONS: string[] = [
  "Điều", "Khoản", "Điểm", "Điều 1", "Điều 2", "Khoản 1", "Khoản 2",
  "Căn cứ", "Theo đó", "Do đó", "Vì vậy", "Vì thế", "Tuy nhiên",
  "Ủy ban nhân dân", "Chủ tịch", "Phó chủ tịch", "Thường trực",
  "Quyết định", "Chỉ thị", "Báo cáo", "Văn bản", "Công văn",
  "Ban hành", "Thi hành", "Áp dụng", "Hướng dẫn", "Thực hiện",
  "Căn cứ Luật", "Căn cứ Nghị quyết", "Căn cứ Quyết định",
  "Kính gửi", "Gửi", "Về việc", "Nay",
  "Hiệu lực", "Trách nhiệm", "Ban hành kèm theo",
];

export const vietnameseDocumentLanguage: monaco.languages.ILanguageExtensionPoint = {
  id: "vndocument",
  aliases: ["Vietnamese Document", "VNDoc"],
  extensions: [".vndoc"],
};
