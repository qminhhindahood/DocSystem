export interface PublicSiteConfig {
  readonly operatorName: string;
  readonly operatorJurisdiction: string;
  readonly supportEmail: string;
  readonly policyEffectiveDate: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validDate(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function readPublicSiteConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicSiteConfig {
  const operatorName = required(env, 'PUBLIC_OPERATOR_NAME');
  const operatorJurisdiction = required(env, 'PUBLIC_OPERATOR_JURISDICTION');
  const supportEmail = required(env, 'PUBLIC_SUPPORT_EMAIL').toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)
    || /[<>]/.test(supportEmail)
    || /@(example\.(?:com|net|org)|[^@]+\.(?:invalid|test))$/i.test(supportEmail)
  ) {
    throw new Error('PUBLIC_SUPPORT_EMAIL must be a real routed email address');
  }
  const policyEffectiveDate = required(env, 'PUBLIC_POLICY_EFFECTIVE_DATE');
  if (!validDate(policyEffectiveDate)) {
    throw new Error('PUBLIC_POLICY_EFFECTIVE_DATE must be a real YYYY-MM-DD date');
  }
  return Object.freeze({
    operatorName,
    operatorJurisdiction,
    supportEmail,
    policyEffectiveDate,
  });
}

/** Display-only fallbacks keep policy routes buildable before cutover. */
export function publicSiteDisplayConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicSiteConfig {
  try {
    return readPublicSiteConfig(env);
  } catch {
    return Object.freeze({
      operatorName: env.PUBLIC_OPERATOR_NAME?.trim() || 'DocAI',
      operatorJurisdiction: env.PUBLIC_OPERATOR_JURISDICTION?.trim() || 'Vietnam',
      supportEmail: env.PUBLIC_SUPPORT_EMAIL?.trim().toLowerCase() || 'support@example.invalid',
      policyEffectiveDate: env.PUBLIC_POLICY_EFFECTIVE_DATE?.trim() || '2026-08-31',
    });
  }
}
