import { describe, expect, it } from 'vitest';
import { readPublicSiteConfig } from './public-site-config';

const valid = {
  NODE_ENV: 'test',
  PUBLIC_OPERATOR_NAME: 'DocAI',
  PUBLIC_OPERATOR_JURISDICTION: 'Vietnam',
  PUBLIC_SUPPORT_EMAIL: 'support@docai.example.vn',
  PUBLIC_POLICY_EFFECTIVE_DATE: '2026-08-31',
} as NodeJS.ProcessEnv;

describe('public site configuration', () => {
  it('normalizes and freezes complete production values', () => {
    const config = readPublicSiteConfig({
      ...valid,
      PUBLIC_OPERATOR_NAME: ' DocAI ',
      PUBLIC_SUPPORT_EMAIL: ' Support@DocAI.Example.VN ',
    });

    expect(config).toEqual({
      operatorName: 'DocAI',
      operatorJurisdiction: 'Vietnam',
      supportEmail: 'support@docai.example.vn',
      policyEffectiveDate: '2026-08-31',
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ['missing operator', { PUBLIC_OPERATOR_NAME: '' }],
    ['missing jurisdiction', { PUBLIC_OPERATOR_JURISDICTION: '' }],
    ['placeholder domain', { PUBLIC_SUPPORT_EMAIL: 'support@<domain>' }],
    ['reserved invalid domain', { PUBLIC_SUPPORT_EMAIL: 'support@example.invalid' }],
    ['test domain', { PUBLIC_SUPPORT_EMAIL: 'support@docai.test' }],
    ['malformed email', { PUBLIC_SUPPORT_EMAIL: 'support-at-docai.vn' }],
    ['malformed date', { PUBLIC_POLICY_EFFECTIVE_DATE: '31/08/2026' }],
    ['impossible date', { PUBLIC_POLICY_EFFECTIVE_DATE: '2026-02-31' }],
  ])('rejects %s', (_name, override) => {
    expect(() => readPublicSiteConfig({ ...valid, ...override })).toThrow(/PUBLIC_/);
  });
});
