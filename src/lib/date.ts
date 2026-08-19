export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

export function formatDate(value: string, locale = 'de-DE') {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(parseIsoDate(value));
}

export function formatMonthLabel(date: Date, locale = 'de-DE') {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric'
  }).format(date);
}

export function nightsBetween(start: string, end: string) {
  return Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / DAY_IN_MS);
}

export function eachNight(start: string, end: string) {
  const nights = nightsBetween(start, end);
  return Array.from({ length: nights }, (_, index) => {
    const date = new Date(parseIsoDate(start).getTime() + index * DAY_IN_MS);
    return toIsoDate(date);
  });
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

export function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthMatrix(monthStart: Date) {
  const first = startOfWeek(startOfMonth(monthStart));
  const last = endOfWeek(endOfMonth(monthStart));
  const days: string[] = [];
  for (let cursor = new Date(first); cursor <= last; cursor = addDays(cursor, 1)) {
    days.push(toIsoDate(cursor));
  }

  return Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
}
