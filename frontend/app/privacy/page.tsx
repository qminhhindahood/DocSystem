import { PolicyLayout, PolicySection } from '@/components/legal/PolicyLayout';

export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return (
    <PolicyLayout
      title="Chính sách quyền riêng tư"
      intro="Tài liệu này mô tả dữ liệu DocAI nhận, lý do xử lý và lựa chọn của người dùng."
    >
      <PolicySection title="Dữ liệu chúng tôi xử lý">
        <p>DocAI xử lý tên người dùng, địa chỉ email chưa xác minh, thông tin phiên đăng nhập, tệp PDF nguồn, tệp DOCX kết quả và cấu hình Gemini do bạn cung cấp.</p>
      </PolicySection>
      <PolicySection title="Mục đích và dịch vụ liên quan">
        <p>Dữ liệu được dùng để xác thực tài khoản, chuyển đổi tài liệu, giới hạn lạm dụng và vận hành an toàn. Cloudflare Turnstile xử lý tín hiệu chống bot khi bạn đăng ký.</p>
      </PolicySection>
      <PolicySection title="Xóa và thời hạn lưu giữ">
        <p>Bạn có thể xóa tài khoản trong ứng dụng. Tài khoản và cấu hình khóa API liên quan bị xóa khỏi cơ sở dữ liệu hoạt động; tệp chuyển đổi là tạm thời. Bản sao lưu đã mã hóa hết hạn trong vòng 30 ngày.</p>
      </PolicySection>
      <PolicySection title="Liên hệ">
        <p>Gửi yêu cầu về quyền riêng tư hoặc dữ liệu tới địa chỉ hỗ trợ nêu ở đầu trang.</p>
      </PolicySection>
    </PolicyLayout>
  );
}
