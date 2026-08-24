import { addDays, eachNight, formatDate, nightsBetween, parseIsoDate, toIsoDate } from './date';

export const FINAL_CLEANING_FEE = 60;

type NightPrice = {
  label: string;
  pricePerNight: number;
};

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month, day);
}

function isInHolidayPeriod(date: string) {
  const year = parseIsoDate(date).getFullYear();
  const easter = easterSunday(year);
  const pentecost = addDays(easter, 49);
  const periods = [
    { from: toIsoDate(addDays(easter, -2)), to: toIsoDate(addDays(easter, 6)) },
    { from: toIsoDate(addDays(pentecost, -2)), to: toIsoDate(addDays(pentecost, 6)) }
  ];

  return periods.some((period) => date >= period.from && date <= period.to);
}

export function getPriceForNight(date: string): NightPrice {
  const monthDay = date.slice(5);

  if (
    isInHolidayPeriod(date) ||
    (monthDay >= '06-15' && monthDay <= '08-31') ||
    monthDay >= '12-24' ||
    monthDay <= '01-02'
  ) {
    return { label: 'Hauptsaison', pricePerNight: 85 };
  }

  if ((monthDay >= '04-01' && monthDay <= '06-14') || (monthDay >= '09-01' && monthDay <= '10-31')) {
    return { label: 'Nebensaison', pricePerNight: 65 };
  }

  return { label: 'Verbleibende Zeit', pricePerNight: 55 };
}

export function calculateStayPrice(start: string, end: string) {
  const nights = eachNight(start, end);
  const grouped = new Map<string, { label: string; nights: number; pricePerNight: number }>();

  let total = 0;
  nights.forEach((night) => {
    const season = getPriceForNight(night);
    total += season.pricePerNight;
    const current = grouped.get(season.label);
    if (current) {
      current.nights += 1;
    } else {
      grouped.set(season.label, { ...season, nights: 1 });
    }
  });

  return {
    arrival: formatDate(start),
    departure: formatDate(end),
    nights: nightsBetween(start, end),
    total,
    breakdown: Array.from(grouped.values())
  };
}

export function getDisplayedPriceRange() {
  return { min: 55, max: 85 };
}

export function getSeasonTable() {
  return [
    { label: 'Hauptsaison', fromLabel: '15.06. bis 31.08. / 24.12. bis 02.01.', pricePerNight: 85 },
    { label: 'Hauptsaison', fromLabel: 'Ostern und Pfingsten: Freitag vor bis Samstag danach', pricePerNight: 85 },
    { label: 'Nebensaison', fromLabel: '01.04. bis 14.06. / 01.09. bis 31.10.', pricePerNight: 65 },
    { label: 'Verbleibende Zeit', fromLabel: 'Alle übrigen Termine', pricePerNight: 55 }
  ];
}
