import { getValidGoogleAccessToken } from './google-oauth';

const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function gmailRequest(path: string, options: RequestInit = {}) {
  const accessToken = await getValidGoogleAccessToken();
  const response = await fetch(`${GMAIL_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers
    }
  });

  const payload = (await response.json()) as { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || 'Google Mail request failed.');
  }

  return payload;
}

export function getGoogleMailboxAddress() {
  const email = import.meta.env.GOOGLE_MAILBOX_ADDRESS;

  if (!email) {
    throw new Error('Missing required environment variable GOOGLE_MAILBOX_ADDRESS.');
  }

  return email;
}

type MailMessage = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export async function sendGoogleMail(message: MailMessage) {
  const from = getGoogleMailboxAddress();
  const headers = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(message.to)}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ];

  if (message.replyTo) {
    headers.push(`Reply-To: ${sanitizeHeader(message.replyTo)}`);
  }

  return gmailRequest('/messages/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: toBase64Url(`${headers.join('\r\n')}\r\n\r\n${message.text}`) })
  });
}
