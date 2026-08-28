import { AuthForm } from '@/components/auth/AuthForm';
import { RegistrationUnavailable } from '@/components/auth/RegistrationUnavailable';
import { isPublicRegistrationEnabled } from '@/lib/server/public-registration-mode';

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  if (!isPublicRegistrationEnabled()) return <RegistrationUnavailable />;
  return <AuthForm mode="signup" turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />;
}
