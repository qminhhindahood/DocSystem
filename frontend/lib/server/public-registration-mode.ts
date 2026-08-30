export function isPublicRegistrationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const disabled = env.DISABLE_PUBLIC_REGISTER === 'true'
    || (env.NODE_ENV === 'production' && env.DISABLE_PUBLIC_REGISTER !== 'false');
  return !disabled;
}
