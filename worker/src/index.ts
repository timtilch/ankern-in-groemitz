import apartment from '../../src/data/apartment.json';
import booking from '../../src/data/booking.json';
import { formatDate, nightsBetween } from '../../src/lib/date';
import { calculateStayPrice } from '../../src/lib/pricing';

type Env = {
  ALLOWED_ORIGIN: string;
  GOOGLE_CALENDAR_ID?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_MAILBOX_ADDRESS: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
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
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  addons?: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
let cachedToken: { value: string; expiresAt: number } | undefined;

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

async function googleAccessToken(env: Env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || 'Google-Authentifizierung fehlgeschlagen.');

  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3_000) * 1_000 };
  return cachedToken.value;
}

async function blockedRanges(env: Env) {
  const token = await googleAccessToken(env);
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

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sendMail(env: Env, message: { to: string; subject: string; text: string; replyTo?: string }) {
  const sanitize = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
  const token = await googleAccessToken(env);
  const headers = [
    `From: ${sanitize(env.GOOGLE_MAILBOX_ADDRESS)}`,
    `To: ${sanitize(message.to)}`,
    `Subject: ${sanitize(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
  ];
  if (message.replyTo) headers.push(`Reply-To: ${sanitize(message.replyTo)}`);

  const response = await fetch(`${GMAIL_API_URL}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64Url(`${headers.join('\r\n')}\r\n\r\n${message.text}`) })
  });
  if (!response.ok) throw new Error('E-Mail konnte nicht versendet werden.');
}

async function handleRequest(request: Request, env: Env) {
  const payload = await request.json() as BookingRequest;
  const arrival = requireText(payload.arrival, 'Anreise');
  const departure = requireText(payload.departure, 'Abreise');
  const name = requireText(payload.name, 'Name');
  const email = requireText(payload.email, 'E-Mail');
  const guests = Number(payload.guests);

  if (!ISO_DATE.test(arrival) || !ISO_DATE.test(departure) || departure <= arrival) throw new Error('Der Reisezeitraum ist ungültig.');
  if (!Number.isInteger(guests) || guests < 1 || guests > apartment.capacity) throw new Error('Die Anzahl der Personen ist ungültig.');
  const minimumStay = Number.parseInt(apartment.houseRules.minimumStay, 10) || 3;
  if (nightsBetween(arrival, departure) < minimumStay) throw new Error(`Der Mindestaufenthalt beträgt ${minimumStay} Nächte.`);

  const ranges = await blockedRanges(env);
  if (ranges.some((range) => arrival <= range.to && departure > range.from)) return { status: 409, payload: { ok: false, error: 'Der gewählte Zeitraum ist inzwischen nicht mehr verfügbar.' } };

  const selectedAddons = booking.addons.filter((addon) => payload.addons?.includes(addon.id));
  const stayPrice = calculateStayPrice(arrival, departure).total;
  const addonTotal = selectedAddons.reduce((sum, addon) => sum + addon.pricePerGuest * guests, 0);
  const details = [
    `Anreise: ${formatDate(arrival)}`,
    `Abreise: ${formatDate(departure)}`,
    `Nächte: ${nightsBetween(arrival, departure)}`,
    `Personen: ${guests}`,
    `Endreinigung: ${booking.cleaningFee} EUR`,
    `Geschätzter Gesamtpreis: ${stayPrice + booking.cleaningFee + addonTotal} EUR`,
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
