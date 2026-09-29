import apartment from '../../src/data/apartment.json';
import booking from '../../src/data/booking.json';
import { formatDate, nightsBetween } from '../../src/lib/date';
import { calculateStayPrice, calculateTouristTax } from '../../src/lib/pricing';
import { connect } from 'cloudflare:sockets';

type Env = {
  ALLOWED_ORIGIN: string;
  GOOGLE_CALENDAR_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  GOOGLE_MAILBOX_ADDRESS: string;
  GMAIL_SMTP_APP_PASSWORD: string;
};

type BlockedRange = { from: string; to: string };
type GoogleEvent = {
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};
type BookingRequest = {
  arrival?: string;
  departure?: string;
  guests?: number;
  children?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  message?: string;
  addons?: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
let cachedCalendarToken: { value: string; expiresAt: number } | undefined;

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function json(request: Request, env: Env, payload: unknown, status = 200) {
  return Response.json(payload, { headers: { ...corsHeaders(request, env), 'Cache-Control': 'no-store' }, status });
}

function requireText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} fehlt.`);
  return value.trim();
}

function addIsoDays(isoDate: string, amount: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function mapEventToBlockedRange(event: GoogleEvent): BlockedRange | null {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end) return null;

  const from = start.slice(0, 10);
  const endDate = end.slice(0, 10);
  const to = event.start?.date && event.end?.date ? addIsoDays(endDate, -1) : endDate;
  return to >= from ? { from, to } : null;
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function calendarAccessToken(env: Env) {
  if (cachedCalendarToken && cachedCalendarToken.expiresAt > Date.now() + 60_000) return cachedCalendarToken.value;

  let serviceAccount: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY) as { client_email?: string; private_key?: string; token_uri?: string };
  } catch {
    serviceAccount = {
      client_email: 'booking-calendar-reader@ankern-in-groemitz-506017.iam.gserviceaccount.com',
      private_key: env.GOOGLE_SERVICE_ACCOUNT_KEY
    };
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('Dienstkonto-Schlüssel ist ungültig.');

  const now = Math.floor(Date.now() / 1_000);
  const tokenUrl = serviceAccount.token_uri || GOOGLE_TOKEN_URL;
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: tokenUrl,
    iat: now,
    exp: now + 3_600
  }))}`;
  const privateKey = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(serviceAccount.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsignedJwt));
  const signatureBinary = String.fromCharCode(...new Uint8Array(signature));
  const assertion = `${unsignedJwt}.${btoa(signatureBinary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || 'Google-Kalender-Authentifizierung fehlgeschlagen.');

  cachedCalendarToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3_000) * 1_000 };
  return cachedCalendarToken.value;
}

async function blockedRanges(env: Env) {
  const token = await calendarAccessToken(env);
  const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true', orderBy: 'startTime', timeMin: new Date().toISOString() });
  const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json() as { items?: GoogleEvent[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || 'Google-Kalender konnte nicht geladen werden.');

  return (payload.items ?? [])
    .filter((event) => event.status !== 'cancelled' && event.status !== 'tentative')
    .map(mapEventToBlockedRange)
    .filter((range): range is BlockedRange => Boolean(range));
}

function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

type SmtpReaderState = { buffer: string };

async function smtpResponse(reader: ReadableStreamDefaultReader<Uint8Array>, state: SmtpReaderState) {
  const decoder = new TextDecoder();
  while (true) {
    const newline = state.buffer.indexOf('\n');
    if (newline >= 0) {
      const line = state.buffer.slice(0, newline).replace(/\r$/, '');
      state.buffer = state.buffer.slice(newline + 1);
      const match = /^(\d{3})([ -])/.exec(line);
      if (match?.[2] === ' ') return { code: Number(match[1]), line };
      continue;
    }

    const { done, value } = await reader.read();
    if (done) throw new Error('SMTP-Verbindung wurde unerwartet beendet.');
    state.buffer += decoder.decode(value, { stream: true });
  }
}

async function smtpCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: SmtpReaderState,
  command: string,
  expected: number[]
) {
  await writer.write(new TextEncoder().encode(`${command}\r\n`));
  const response = await smtpResponse(reader, state);
  if (!expected.includes(response.code)) throw new Error(`SMTP-Server hat den Versand abgelehnt (${response.code}).`);
}

async function sendMail(env: Env, message: { to: string; subject: string; text: string; replyTo?: string }) {
  const sanitize = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
  if (!env.GMAIL_SMTP_APP_PASSWORD) throw new Error('E-Mail-Versand ist noch nicht eingerichtet.');

  const headers = [
    `From: ${sanitize(env.GOOGLE_MAILBOX_ADDRESS)}`,
    `To: ${sanitize(message.to)}`,
    `Subject: =?UTF-8?B?${base64(sanitize(message.subject))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  if (message.replyTo) headers.push(`Reply-To: ${sanitize(message.replyTo)}`);

  const socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const state: SmtpReaderState = { buffer: '' };
  try {
    const greeting = await smtpResponse(reader, state);
    if (greeting.code !== 220) throw new Error('Gmail SMTP ist nicht erreichbar.');
    await smtpCommand(writer, reader, state, 'EHLO ankerningroemitz.de', [250]);
    await smtpCommand(writer, reader, state, 'AUTH LOGIN', [334]);
    await smtpCommand(writer, reader, state, base64(env.GOOGLE_MAILBOX_ADDRESS), [334]);
    await smtpCommand(writer, reader, state, base64(env.GMAIL_SMTP_APP_PASSWORD.replaceAll(' ', '')), [235]);
    await smtpCommand(writer, reader, state, `MAIL FROM:<${sanitize(env.GOOGLE_MAILBOX_ADDRESS)}>`, [250]);
    await smtpCommand(writer, reader, state, `RCPT TO:<${sanitize(message.to)}>`, [250, 251]);
    await smtpCommand(writer, reader, state, 'DATA', [354]);

    const encodedBody = base64(message.text).replace(/.{1,76}/g, '$&\r\n');
    await writer.write(new TextEncoder().encode(`${headers.join('\r\n')}\r\n\r\n${encodedBody}\r\n.\r\n`));
    const accepted = await smtpResponse(reader, state);
    if (accepted.code !== 250) throw new Error(`SMTP-Server hat den Versand abgelehnt (${accepted.code}).`);
    await smtpCommand(writer, reader, state, 'QUIT', [221]);
  } finally {
    try { await writer.close(); } catch { /* Verbindung ist bereits geschlossen. */ }
    reader.releaseLock();
    writer.releaseLock();
  }
}

async function handleRequest(request: Request, env: Env) {
  const payload = await request.json() as BookingRequest;
  const arrival = requireText(payload.arrival, 'Anreise');
  const departure = requireText(payload.departure, 'Abreise');
  const firstName = requireText(payload.firstName, 'Vorname');
  const lastName = requireText(payload.lastName, 'Nachname');
  const name = `${firstName} ${lastName}`;
  const email = requireText(payload.email, 'E-Mail');
  const guests = Number(payload.guests);
  const children = Number(payload.children ?? 0);

  if (!ISO_DATE.test(arrival) || !ISO_DATE.test(departure) || departure <= arrival) throw new Error('Der Reisezeitraum ist ungültig.');
  if (!Number.isInteger(guests) || guests < 1 || guests > apartment.capacity) throw new Error('Die Anzahl der Personen ist ungültig.');
  if (!Number.isInteger(children) || children < 0 || children >= guests) throw new Error('Die Anzahl der Kinder ist ungültig.');
  const minimumStay = Number.parseInt(apartment.houseRules.minimumStay, 10) || 3;
  if (nightsBetween(arrival, departure) < minimumStay) throw new Error(`Der Mindestaufenthalt beträgt ${minimumStay} Nächte.`);

  const ranges = await blockedRanges(env);
  if (ranges.some((range) => arrival <= range.to && departure > range.from)) return { status: 409, payload: { ok: false, error: 'Der gewählte Zeitraum ist inzwischen nicht mehr verfügbar.' } };

  const selectedAddons = booking.addons.filter((addon) => payload.addons?.includes(addon.id));
  const stayPrice = calculateStayPrice(arrival, departure).total;
  const addonTotal = selectedAddons.reduce((sum, addon) => sum + addon.pricePerGuest * guests, 0);
  const touristTax = calculateTouristTax(arrival, departure, guests - children).total;
  const details = [
    `Anreise: ${formatDate(arrival)}`,
    `Abreise: ${formatDate(departure)}`,
    `Nächte: ${nightsBetween(arrival, departure)}`,
    `Personen: ${guests}`,
    `Davon unter 18: ${children}`,
    `Endreinigung: ${booking.cleaningFee} EUR`,
    `Kurabgabe: ${touristTax.toFixed(2)} EUR`,
    `Geschätzter Gesamtpreis: ${(stayPrice + booking.cleaningFee + addonTotal + touristTax).toFixed(2)} EUR`,
    `Name: ${name}`,
    `E-Mail: ${email}`,
    `Telefon: ${typeof payload.phone === 'string' ? payload.phone.trim() || '-' : '-'}`,
    `Zusatzoptionen: ${selectedAddons.length ? selectedAddons.map((addon) => `${addon.label} (${addon.pricePerGuest * guests} EUR)`).join(', ') : '-'}`,
    `Nachricht: ${typeof payload.message === 'string' ? payload.message.trim() || '-' : '-'}`
  ].join('\n');

  await sendMail(env, { to: env.GOOGLE_MAILBOX_ADDRESS, replyTo: email, subject: `Neue Buchungsanfrage: ${name} | ${formatDate(arrival)} - ${formatDate(departure)}`, text: `Neue unverbindliche Buchungsanfrage fuer ${apartment.name}.\n\n${details}` });
  await sendMail(env, { to: email, subject: `Ihre Anfrage bei ${apartment.name} ist eingegangen`, text: `Hallo ${name},\n\nvielen Dank fuer Ihre unverbindliche Anfrage. Sie ist bei uns eingegangen und wir melden uns zeitnah persoenlich bei Ihnen.\n\nIhre Angaben:\n${details}\n\nFreundliche Gruesse\n${apartment.contact.hostName}\n${apartment.name}` });
  return { status: 200, payload: { ok: true } };
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return origin === env.ALLOWED_ORIGIN ? new Response(null, { headers: corsHeaders(request, env) }) : new Response(null, { status: 403 });

    try {
      if (request.method === 'GET' && url.pathname === '/bookings') return json(request, env, { ok: true, bookings: await blockedRanges(env) });
      if (request.method === 'POST' && url.pathname === '/requests') {
        const result = await handleRequest(request, env);
        return json(request, env, result.payload, result.status);
      }
      return json(request, env, { ok: false, error: 'Nicht gefunden.' }, 404);
    } catch (error) {
      return json(request, env, { ok: false, error: error instanceof Error ? error.message : 'Die Anfrage konnte nicht verarbeitet werden.' }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
