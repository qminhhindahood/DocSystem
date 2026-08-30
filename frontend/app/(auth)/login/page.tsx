import { AuthForm } from '@/components/auth/AuthForm';
import { passwordResetEnabled } from '@/lib/server/password-reset-mode';
import { isPublicRegistrationEnabled } from '@/lib/server/public-registration-mode';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <AuthForm
      mode="login"
      passwordResetEnabled={passwordResetEnabled()}
      publicRegistrationEnabled={isPublicRegistrationEnabled()}
    />
  );
}
