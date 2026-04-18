const FROM = process.env.EMAIL_FROM || 'notestack.cloud <noreply@notestack.cloud.app>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[Email DEV] To: ${to}\nSubject: ${subject}\n${html}`);
    return;
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error('[Email] Failed to send:', err);
  }
}

export function sendVerificationEmail(email: string, name: string, token: string) {
  const url = `${APP_URL}/verify-email?token=${token}`;
  sendEmail(
    email,
    'Verify your notestack.cloud account',
    `
    <p>Hi ${name},</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>— notestack.cloud</p>
    `
  );
}

export function sendPasswordResetEmail(email: string, name: string, token: string) {
  const url = `${APP_URL}/reset-password?token=${token}`;
  sendEmail(
    email,
    'Reset your notestack.cloud password',
    `
    <p>Hi ${name},</p>
    <p>Click the link below to reset your password:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    <p>— notestack.cloud</p>
    `
  );
}

export function sendInviteEmail(email: string, inviterName: string, token: string) {
  const url = `${APP_URL}/invite/${token}`;
  sendEmail(
    email,
    `${inviterName} invited you to notestack.cloud`,
    `
    <p>Hi,</p>
    <p><strong>${inviterName}</strong> has invited you to join notestack.cloud — a personal knowledge system powered by AI.</p>
    <p><a href="${url}">Accept invitation</a></p>
    <p>This invitation expires in 30 days.</p>
    <p>— notestack.cloud</p>
    `
  );
}
