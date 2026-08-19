import priceSeasons from '../data/prices.json';
import { eachNight, formatDate, nightsBetween, parseIsoDate } from './date';

type PriceSeason = {
  from: string;
  to: string;
  pricePerNight: number;
  label: string;
};

const seasons = (priceSeasons as PriceSeason[]).slice().sort((a, b) => a.from.localeCompare(b.from));

export function getPriceForNight(date: string) {
  return seasons.find((season) => {
    const current = parseIsoDate(date).getTime();
    return current >= parseIsoDate(season.from).getTime() && current <= parseIsoDate(season.to).getTime();
  });
}

export function calculateStayPrice(start: string, end: string) {
  const nights = eachNight(start, end);
  const grouped = new Map<string, { label: string; nights: number; pricePerNight: number }>();

  let total = 0;

  nights.forEach((night) => {
    const season = getPriceForNight(night);
    if (!season) {
      throw new Error(`Kein Preis definiert für ${night}`);
    }

    total += season.pricePerNight;
    const current = grouped.get(season.label);
    if (current) {
      current.nights += 1;
    } else {
      grouped.set(season.label, {
        label: season.label,
        nights: 1,
        pricePerNight: season.pricePerNight
      });
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
  const prices = seasons.map((season) => season.pricePerNight);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices)
  };
}

export function getSeasonTable() {
  return seasons.map((season) => ({
    ...season,
    fromLabel: formatDate(season.from),
    toLabel: formatDate(season.to)
  }));
}
