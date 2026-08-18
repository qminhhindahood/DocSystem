import { AuthForm } from '@/components/auth/AuthForm';
import { passwordResetEnabled } from '@/lib/server/password-reset-mode';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <AuthForm mode="login" passwordResetEnabled={passwordResetEnabled()} />;
}
