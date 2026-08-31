import { PolicyLayout, PolicySection } from '@/components/legal/PolicyLayout';

export const dynamic = 'force-dynamic';

export default function TermsPage() {
  return (
    <PolicyLayout
      title="Điều khoản sử dụng"
      intro="Khi dùng DocAI, bạn đồng ý chỉ tải lên tài liệu mình có quyền xử lý và chịu trách nhiệm về cách sử dụng kết quả."
    >
      <PolicySection title="Phạm vi dịch vụ">
        <p>DocAI chuyển PDF sang DOCX và áp dụng các quy tắc trình bày theo Nghị định 30/2020/NĐ-CP. Dịch vụ có thể thay đổi, tạm dừng hoặc giới hạn lưu lượng để bảo vệ hệ thống.</p>
      </PolicySection>
      <PolicySection title="Kết quả cần được rà soát">
        <p>DocAI không bảo đảm độ chính xác, tính pháp lý hoặc sự phù hợp của tài liệu đầu ra. Bạn phải kiểm tra mọi kết quả, đặc biệt tên riêng, số liệu, bảng, chữ ký và nội dung nhận dạng từ trang quét, trước khi sử dụng.</p>
      </PolicySection>
      <PolicySection title="Sử dụng chấp nhận được">
        <p>Không được dùng dịch vụ để xâm phạm quyền riêng tư, quyền sở hữu trí tuệ, pháp luật áp dụng, hoặc cố tình làm gián đoạn và vượt qua giới hạn kỹ thuật.</p>
      </PolicySection>
      <PolicySection title="Tài khoản">
        <p>Bạn chịu trách nhiệm giữ bí mật mật khẩu và khóa API riêng. DocAI có thể vô hiệu hóa tài khoản gây rủi ro; bạn có thể xóa tài khoản vĩnh viễn trong ứng dụng.</p>
      </PolicySection>
    </PolicyLayout>
  );
}
