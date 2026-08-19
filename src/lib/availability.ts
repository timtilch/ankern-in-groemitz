import blockedRanges from '../data/availability.json';
import { eachNight, parseIsoDate } from './date';

type DateRange = {
  from: string;
  to: string;
};

const ranges = blockedRanges as DateRange[];

export function isBlocked(date: string) {
  const current = parseIsoDate(date).getTime();
  return ranges.some((range) => current >= parseIsoDate(range.from).getTime() && current <= parseIsoDate(range.to).getTime());
}

export function rangeCrossesBlockedDates(start: string, end: string) {
  return eachNight(start, end).some((night) => isBlocked(night));
}

export function getBlockedRanges() {
  return ranges;
}
