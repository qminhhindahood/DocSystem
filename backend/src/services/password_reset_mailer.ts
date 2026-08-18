import nodemailer, { type SendMailOptions } from 'nodemailer';

export interface PasswordResetMailerDependencies {
  resetBaseUrl: string;
  from: string;
  sendMail(message: SendMailOptions): Promise<unknown>;
}

function productionDependencies(): PasswordResetMailerDependencies {
  const port = Number(process.env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    ...(process.env.SMTP_USER && process.env.SMTP_PASS
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
  });
  return {
    resetBaseUrl: process.env.PASSWORD_RESET_BASE_URL ?? '',
    from: process.env.SMTP_FROM ?? '',
    sendMail: (message) => transporter.sendMail(message),
  };
}

export async function sendPasswordResetEmail(
  recipient: string,
  rawToken: string,
  deps: PasswordResetMailerDependencies = productionDependencies(),
): Promise<void> {
  try {
    const resetUrl = new URL(deps.resetBaseUrl);
    resetUrl.searchParams.set('token', rawToken);
    const url = resetUrl.toString();
    const htmlUrl = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

    await deps.sendMail({
      from: deps.from,
      to: recipient,
      subject: 'Đặt lại mật khẩu DocAI',
      text: `Mở liên kết sau để đặt lại mật khẩu DocAI. Liên kết hết hạn sau 30 phút:\n\n${url}\n\nNếu bạn không yêu cầu thao tác này, hãy bỏ qua email.`,
      html: `<p>Mở liên kết sau để đặt lại mật khẩu DocAI. Liên kết hết hạn sau 30 phút:</p><p><a href="${htmlUrl}">Đặt lại mật khẩu</a></p><p>Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p>`,
    });
  } catch {
    throw new Error('Password reset email delivery failed');
  }
}
