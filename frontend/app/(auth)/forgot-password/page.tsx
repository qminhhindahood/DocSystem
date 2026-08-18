import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { PasswordResetUnavailable } from '@/components/auth/PasswordResetUnavailable';
import { passwordResetEnabled } from '@/lib/server/password-reset-mode';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  if (!passwordResetEnabled()) return <PasswordResetUnavailable />;
  return <ForgotPasswordForm />;
}
