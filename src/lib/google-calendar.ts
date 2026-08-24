import { addDays, parseIsoDate, toIsoDate } from './date';
import { getGoogleOAuthConfig, getValidGoogleAccessToken } from './google-oauth';

type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
};

type CalendarListResponse = {
  items?: GoogleCalendarEvent[];
  error?: {
    message?: string;
  };
};

export type BlockedRange = {
  from: string;
  to: string;
};

function extractIsoDate(value: string) {
  return value.slice(0, 10);
}

function addIsoDays(isoDate: string, amount: number) {
  return toIsoDate(addDays(parseIsoDate(isoDate), amount));
}

function mapEventToBlockedRange(event: GoogleCalendarEvent): BlockedRange | null {
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date;

  if (!startValue || !endValue) {
    return null;
  }

  const startDate = extractIsoDate(startValue);
  const endDate = extractIsoDate(endValue);
  const isAllDayEvent = Boolean(event.start?.date && event.end?.date);
  const blockedUntil = isAllDayEvent ? addIsoDays(endDate, -1) : endDate;

  if (blockedUntil < startDate) {
    return null;
  }

  return {
    from: startDate,
    to: blockedUntil
  };
}

async function fetchCalendarEvents(maxResults = 250) {
  const accessToken = await getValidGoogleAccessToken();
  const { calendarId } = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date().toISOString()
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const payload = (await response.json()) as CalendarListResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || 'Failed to load Google Calendar events.');
  }

  return payload.items || [];
}

export async function listUpcomingCalendarEvents(maxResults = 10) {
  const events = await fetchCalendarEvents(maxResults);

  return events.map((event) => ({
    id: event.id,
    status: event.status,
    summary: event.summary || '(Ohne Titel)',
    description: event.description || '',
    link: event.htmlLink || '',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null
  }));
}

export async function listBlockedCalendarRanges() {
  const events = await fetchCalendarEvents();

  return events
    .filter((event) => event.status !== 'cancelled' && event.status !== 'tentative')
    .map(mapEventToBlockedRange)
    .filter((range): range is BlockedRange => Boolean(range));
}
