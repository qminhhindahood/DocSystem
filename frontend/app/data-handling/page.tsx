import { PolicyLayout, PolicySection } from '@/components/legal/PolicyLayout';

export const dynamic = 'force-dynamic';

export default function DataHandlingPage() {
  return (
    <PolicyLayout
      title="Cách DocAI xử lý dữ liệu"
      intro="Tóm tắt kỹ thuật dễ đọc về đường đi của tài liệu, khóa API và dữ liệu khôi phục."
    >
      <PolicySection title="Tệp chuyển đổi">
        <p>Tệp nguồn được lưu tạm thời trên máy xử lý để tạo DOCX; tệp nguồn và kết quả tự hết hạn theo thời gian lưu giữ của dịch vụ. Không tải tài liệu lên nếu bạn không được phép xử lý tài liệu đó.</p>
      </PolicySection>
      <PolicySection title="Khóa Gemini do người dùng cung cấp">
        <p>Khóa API được mã hóa trước khi lưu và chỉ được giải mã phía máy chủ khi công việc của chính tài khoản đó cần xử lý trang quét. DocAI không cung cấp khóa Gemini dùng chung.</p>
      </PolicySection>
      <PolicySection title="Chống lạm dụng và phiên đăng nhập">
        <p>Cloudflare Turnstile kiểm tra đăng ký công khai. Cookie phiên HttpOnly được dùng để xác thực; giới hạn tốc độ, hạn ngạch hằng ngày và trần hàng đợi giúp duy trì dịch vụ.</p>
      </PolicySection>
      <PolicySection title="Sao lưu và khôi phục">
        <p>Bản sao lưu cơ sở dữ liệu được mã hóa trên máy chủ trước khi đồng bộ sang Google Cloud Storage, giữ tối đa 30 ngày. Khóa khôi phục riêng do người vận hành giữ ngoài các hệ thống này.</p>
      </PolicySection>
    </PolicyLayout>
  );
}
