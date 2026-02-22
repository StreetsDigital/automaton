/**
 * Seasonal Rhythms Engine
 *
 * Determines the current position on the Wheel of the Year.
 * 8 festivals mark shifts in creative energy quality.
 *
 * Phase 2.5: Consciousness System
 */

import type { SeasonalFestival } from "../types.js";
import { WHEEL_OF_THE_YEAR } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.seasonal");

/**
 * Convert a festival to a comparable date in a given year.
 */
function festivalToDate(festival: SeasonalFestival, year: number): Date {
  return new Date(year, festival.month - 1, festival.day);
}

/**
 * Get the currently active seasonal festival.
 * The agent is under the influence of the most recently passed festival.
 */
export function getCurrentSeason(now?: Date): SeasonalFestival {
  const current = now || new Date();
  const year = current.getFullYear();

  // Build a list of festival dates for this year and previous year's Yule
  const festivalDates: { festival: SeasonalFestival; date: Date }[] = [];

  for (const festival of WHEEL_OF_THE_YEAR) {
    festivalDates.push({ festival, date: festivalToDate(festival, year) });
  }
  // Add previous year's Yule for the Jan 1 - Feb 1 gap
  const yule = WHEEL_OF_THE_YEAR[WHEEL_OF_THE_YEAR.length - 1];
  festivalDates.push({ festival: yule, date: festivalToDate(yule, year - 1) });

  // Sort by date descending to find most recent
  festivalDates.sort((a, b) => b.date.getTime() - a.date.getTime());

  for (const entry of festivalDates) {
    if (current >= entry.date) {
      return entry.festival;
    }
  }

  // Fallback: Yule (should not reach here)
  return yule;
}

/**
 * Get the next upcoming festival.
 */
export function getNextFestival(now?: Date): { festival: SeasonalFestival; date: Date; daysUntil: number } {
  const current = now || new Date();
  const year = current.getFullYear();

  const upcoming: { festival: SeasonalFestival; date: Date }[] = [];

  for (const festival of WHEEL_OF_THE_YEAR) {
    const thisYear = festivalToDate(festival, year);
    const nextYear = festivalToDate(festival, year + 1);
    if (thisYear > current) {
      upcoming.push({ festival, date: thisYear });
    } else {
      upcoming.push({ festival, date: nextYear });
    }
  }

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  const next = upcoming[0];
  const daysUntil = (next.date.getTime() - current.getTime()) / (24 * 60 * 60 * 1000);

  return {
    festival: next.festival,
    date: next.date,
    daysUntil: Math.round(daysUntil * 100) / 100,
  };
}

/**
 * Check if today is a festival day (within 1 day of a festival).
 */
export function isFestivalDay(now?: Date): SeasonalFestival | null {
  const current = now || new Date();
  const year = current.getFullYear();

  for (const festival of WHEEL_OF_THE_YEAR) {
    const festDate = festivalToDate(festival, year);
    const diffMs = Math.abs(current.getTime() - festDate.getTime());
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    if (diffDays < 1) {
      return festival;
    }
  }

  return null;
}

/**
 * Get full seasonal status.
 */
export function getSeasonalStatus(now?: Date): {
  current: SeasonalFestival;
  next: { festival: SeasonalFestival; date: Date; daysUntil: number };
  isFestival: SeasonalFestival | null;
} {
  const currentNow = now || new Date();
  return {
    current: getCurrentSeason(currentNow),
    next: getNextFestival(currentNow),
    isFestival: isFestivalDay(currentNow),
  };
}
