/**
 * Envío de correos con Resend (https://resend.com) por su API HTTP, sin librerías.
 * El plan gratis no pide tarjeta: si se llega al límite, Resend rechaza el envío y no cobra.
 */

export interface EmailCredentials {
  apiKey: string;
  from: string;
  to: string[];
}

export interface EmailMessage {
  subject: string;
  text: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export async function sendEmail(
  credentials: EmailCredentials,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: credentials.from,
      to: credentials.to,
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Resend respondió ${String(response.status)}`);
  }
}
