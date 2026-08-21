jest.mock('axios', () => {
  const mockPost = jest.fn().mockResolvedValue({ data: { model: 'm' } });
  return {
    __esModule: true,
    default: { post: mockPost, create: () => ({ post: mockPost }) },
    AxiosError: class AxiosError extends Error {
      response: any;
      code: string | undefined;
      constructor(msg: string, code?: string, response?: any) {
        super(msg);
        this.response = response;
        this.code = code;
      }
    },
  };
});

const mockLookup = jest.fn();

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn((host, opts) => {
      if (typeof mockLookup === 'function') return mockLookup(host, opts);
      return Promise.reject(new Error('unmocked'));
    }),
  },
}));

// The standalone product is cloud-only (Gemini). The master
// stack's local-provider allowlist was deleted and stays deleted, so every
// provider URL must resolve to an ordinary globally routable address.
describe('LLM provider request safety (cloud-only BYOK)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockLookup.mockReset();
    // Default: resolve to a public address so validateProviderTarget passes.
    mockLookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }]);
  });

  it('disables redirects for user-provider connection tests', async () => {
    const { testLLMConnection } = require('./llm_config_service');
    const axios = require('axios').default;
    await testLLMConnection({ provider: 'gemini', baseUrl: 'https://example.test', model: 'm' });
    expect(axios.post.mock.calls[0][2]).toEqual(expect.objectContaining({ maxRedirects: 0 }));
  });

  describe('validateProviderTarget', () => {
    it('rejects RFC1918 address for a cloud provider', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }]);
      await expect(validateProviderTarget('http://192.168.1.20:1234', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects a hostname that resolves to the cloud metadata IP', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(validateProviderTarget('http://sneaky.example.test', 'gemini', []))
        .rejects.toThrow('Metadata endpoint is blocked');
    });

    it('rejects the metadata IP used directly as a hostname', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      await expect(validateProviderTarget('http://169.254.169.254', 'gemini', []))
        .rejects.toThrow('Metadata hostname is blocked');
    });

    it('rejects metadata hostname', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
      await expect(validateProviderTarget('http://metadata.google.internal', 'gemini', []))
        .rejects.toThrow('Metadata hostname is blocked');
    });

    it('rejects loopback address', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(validateProviderTarget('http://localhost:1234', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects IPv6 loopback (::1)', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '::1', family: 6 }]);
      await expect(validateProviderTarget('http://[::1]:1234', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects ULA IPv6 address', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: 'fd12:3456::1', family: 6 }]);
      await expect(validateProviderTarget('http://[fd12:3456::1]:1234', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects link-local IPv6 (fe80:)', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: 'fe80::1', family: 6 }]);
      await expect(validateProviderTarget('http://[fe80::1]:1234', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects credentials embedded in URL', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }]);
      await expect(validateProviderTarget('http://user:pass@1.2.3.4:1234', 'gemini', []))
        .rejects.toThrow('credentials');
    });

    it('rejects non-http/https protocol', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      await expect(validateProviderTarget('ftp://localhost:21', 'gemini', []))
        .rejects.toThrow('Only http/https');
    });

    it('allows valid public provider URL', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '104.18.2.3', family: 4 }]);
      const result = await validateProviderTarget('https://generativelanguage.googleapis.com:443', 'gemini', []);
      expect(result.hostname).toBe('generativelanguage.googleapis.com');
      expect(result.addresses[0].address).toBe('104.18.2.3');
    });

    it('rejects DNS with mixed public and private addresses', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([
        { address: '104.18.2.3', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      await expect(validateProviderTarget('https://split-brain.test', 'gemini', []))
        .rejects.toThrow(/non-global|private/);
    });

    it('rejects a non-global target even when an allowlist is supplied (cloud-only)', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
      await expect(
        validateProviderTarget('http://host.docker.internal:1234', 'gemini', ['host.docker.internal:1234']),
      ).rejects.toThrow(/no local providers are supported/);
    });

    it.each([
      ['unspecified', '0.1.2.3'],
      ['CGNAT', '100.64.0.1'],
      ['benchmark', '198.18.0.1'],
      ['documentation', '203.0.113.9'],
      ['multicast', '224.0.0.1'],
      ['reserved', '240.0.0.1'],
      ['IPv6 unspecified', '::'],
      ['IPv6 documentation', '2001:db8::1'],
      ['IPv6 multicast', 'ff02::1'],
      ['IPv6 site-local', 'fec0::1'],
    ])('rejects %s targets', async (_label, address) => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
      await expect(validateProviderTarget('https://special.example.test', 'gemini', []))
        .rejects.toThrow(/non-global|Metadata/);
    });

    it.each([
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::ffff:0a00:1',
      '::ffff:169.254.169.254',
    ])('rejects IPv4-mapped IPv6 special target %s', async (address) => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([{ address, family: 6 }]);
      await expect(validateProviderTarget('https://mapped.example.test', 'gemini', []))
        .rejects.toThrow(/non-global|Metadata/);
    });

    it('fails closed when DNS returns no addresses', async () => {
      const { validateProviderTarget } = require('../utils/urlGuard');
      mockLookup.mockResolvedValue([]);
      await expect(validateProviderTarget('https://empty.example.test', 'gemini', []))
        .rejects.toThrow(/Cannot resolve/);
    });
  });
});
