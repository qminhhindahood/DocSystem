import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { PasswordResetUnavailable } from '@/components/auth/PasswordResetUnavailable';
import { passwordResetEnabled } from '@/lib/server/password-reset-mode';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  if (!passwordResetEnabled()) return <PasswordResetUnavailable />;
  return <ResetPasswordForm />;
}
