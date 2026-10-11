/**
 * Transactional email delivery via Resend's HTTPS API.
 *
 * Credentials are supplied by the deployment secret manager. No API key or
 * provider response body is logged. In production, mail-dependent auth flows
 * fail closed if delivery cannot be confirmed.
 */
export class EmailDeliveryNotConfiguredError extends Error {
  constructor() {
    super("Transactional email delivery is not configured.");
    this.name = "EmailDeliveryNotConfiguredError";
  }
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("Transactional email delivery failed.");
    this.name = "EmailDeliveryError";
  }
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
    process.env.EMAIL_FROM?.trim()
  );
}

async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new EmailDeliveryNotConfiguredError();

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
      // TypeScript's Expo DOM declarations conflict with Node 22's fetch
      // AbortSignal declaration; this is a native Node AbortSignal at runtime.
      signal: controller.signal as unknown as RequestInit["signal"],
    });
  } catch {
    throw new EmailDeliveryError();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Never include provider response content (potentially PII) in errors/logs.
    throw new EmailDeliveryError();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const safeCode = escapeHtml(code);
  await sendTransactionalEmail({
    to,
    subject: "Confirme seu e-mail — FairMove",
    text: `Seu código de confirmação FairMove é ${code}. Ele expira em 15 minutos. Se você não solicitou esta conta, ignore esta mensagem.`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#050505;color:#f5f5f5;font-family:Arial,sans-serif;padding:32px"><div style="max-width:520px;margin:auto;border:1px solid #8b6b27;border-radius:16px;padding:28px;background:#101010"><p style="color:#d4af37;letter-spacing:5px;font-weight:700">FAIRMOVE</p><h1 style="font-size:24px">Confirme seu e-mail</h1><p>Use este código no aplicativo FairMove:</p><p style="font-size:32px;letter-spacing:8px;color:#d4af37;font-weight:700">${safeCode}</p><p>O código expira em 15 minutos. Nunca compartilhe esse código.</p><p style="color:#aaa;font-size:12px">RIDE FAIR. LIVE FORWARD.</p></div></body></html>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const safeToken = escapeHtml(token);
  await sendTransactionalEmail({
    to,
    subject: "Recuperação de senha — FairMove",
    text: `Você solicitou a recuperação da senha FairMove. Copie o token abaixo para a tela "Esqueci minha senha" no aplicativo. Token válido por 1 hora: ${token}. Se você não solicitou, ignore esta mensagem.`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#050505;color:#f5f5f5;font-family:Arial,sans-serif;padding:32px"><div style="max-width:520px;margin:auto;border:1px solid #8b6b27;border-radius:16px;padding:28px;background:#101010"><p style="color:#d4af37;letter-spacing:5px;font-weight:700">FAIRMOVE</p><h1 style="font-size:24px">Redefina sua senha</h1><p>Copie o token abaixo e cole na tela "Esqueci minha senha" no aplicativo FairMove. Ele expira em 1 hora e só pode ser usado uma vez.</p><div style="word-break:break-all;background:#050505;border:1px solid #333;border-radius:8px;padding:14px;color:#d4af37;font-family:monospace">${safeToken}</div><p>Se você não solicitou a recuperação, ignore esta mensagem. Não compartilhe o token.</p><p style="color:#aaa;font-size:12px">RIDE FAIR. LIVE FORWARD.</p></div></body></html>`,
  });
}
