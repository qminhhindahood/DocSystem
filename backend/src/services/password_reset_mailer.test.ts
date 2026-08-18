import {
  sendPasswordResetEmail,
  type PasswordResetMailerDependencies,
} from './password_reset_mailer';

function dependencies(): PasswordResetMailerDependencies & { sendMail: jest.Mock } {
  return {
    resetBaseUrl: 'https://docai.example.com/reset-password',
    from: 'DocAI <no-reply@docai.example.com>',
    sendMail: jest.fn().mockResolvedValue(undefined),
  };
}

describe('password reset mailer', () => {
  it('sends a reset link without placing the token in the subject', async () => {
    const deps = dependencies();
    const token = Buffer.alloc(32, 5).toString('base64url');

    await sendPasswordResetEmail('owner@example.com', token, deps);

    expect(deps.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'DocAI <no-reply@docai.example.com>',
      to: 'owner@example.com',
      subject: 'Đặt lại mật khẩu DocAI',
      text: expect.stringContaining(`https://docai.example.com/reset-password?token=${token}`),
    }));
    expect(deps.sendMail.mock.calls[0][0].subject).not.toContain(token);
  });

  it('rethrows only a redacted delivery error', async () => {
    const deps = dependencies();
    const token = Buffer.alloc(32, 5).toString('base64url');
    deps.sendMail.mockRejectedValue(new Error(`smtp-password=secret token=${token}`));

    await expect(sendPasswordResetEmail('owner@example.com', token, deps)).rejects.toThrow(
      'Password reset email delivery failed',
    );

    try {
      await sendPasswordResetEmail('owner@example.com', token, deps);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain('owner@example.com');
    }
  });
});
