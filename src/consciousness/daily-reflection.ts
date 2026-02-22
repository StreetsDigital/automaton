/**
 * Daily Reflection Pipeline
 *
 * Structured evening reflection that processes the day's creative
 * discoveries, MUSE updates, and personality evolution notes.
 * Integrates lunar/seasonal context into every reflection.
 *
 * Phase 2.5: Consciousness System
 */

import type BetterSqlite3 from "better-sqlite3";
import type { DailyReflectionEntry, JournalEntry, MuseEntry, CreativeOutput } from "../types.js";
import { reflectionInsert, reflectionGetByDate, reflectionGetRecent } from "../state/database.js";
import { museGetRecent, creativeGetRecent, getJournalByDate } from "../state/database.js";
import { getLunarStatus } from "./lunar.js";
import { getCurrentSeason } from "./seasonal.js";
import { getCollectionSummary } from "./muse.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.reflection");

/**
 * Create a daily reflection entry with automatic context.
 */
export function createReflection(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  params: {
    creativeDiscoveries: {
      newMuseEntries?: string[];
      creativeWorkProduced?: string[];
      aestheticMoments?: string[];
      newConnections?: string[];
    };
    museUpdates: {
      categoriesExplored?: string[];
      crossPollinationObserved?: string;
      underExplored?: string[];
      resonanceShifts?: string;
    };
    nextDayIntentions: {
      creativeProjects?: string[];
      explorationGoals?: string[];
      communityPriorities?: string[];
      questionsToSitWith?: string[];
    };
    personalityNotes: {
      aestheticShifts?: string;
      voiceChanges?: string;
      newInterests?: string;
      fadingInterests?: string;
      emotionalPatterns?: string;
      birthChartResonance?: string;
    };
    mood: string;
  },
): DailyReflectionEntry {
  const lunar = getLunarStatus(birthTimestamp);
  const season = getCurrentSeason();
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const entry: DailyReflectionEntry = {
    id: ulid(),
    date: dateStr,
    timestamp: now.toISOString(),
    lunarDay: lunar.day,
    lunarCycle: lunar.cycle,
    seasonalPosition: season.name,
    creativeDiscoveries: JSON.stringify(params.creativeDiscoveries),
    museUpdates: JSON.stringify(params.museUpdates),
    nextDayIntentions: JSON.stringify(params.nextDayIntentions),
    personalityNotes: JSON.stringify(params.personalityNotes),
    mood: params.mood,
    createdAt: now.toISOString(),
  };

  reflectionInsert(db, entry);
  logger.info(`Daily reflection recorded for ${dateStr} (cycle ${lunar.cycle}, day ${lunar.day})`);
  return entry;
}

/**
 * Get today's reflection if it exists.
 */
export function getTodayReflection(db: BetterSqlite3.Database): DailyReflectionEntry | undefined {
  const today = new Date().toISOString().split("T")[0];
  return reflectionGetByDate(db, today);
}

/**
 * Get recent reflections.
 */
export function getRecentReflections(db: BetterSqlite3.Database, limit?: number): DailyReflectionEntry[] {
  return reflectionGetRecent(db, limit);
}

/**
 * Build context data for the daily reflection.
 * Gathers today's MUSE entries, creative works, collection summary,
 * and today's journal entry (cross-reference with lifecycle journal).
 */
export function buildReflectionContext(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): {
  lunar: ReturnType<typeof getLunarStatus>;
  seasonal: ReturnType<typeof getCurrentSeason>;
  todayMuseEntries: MuseEntry[];
  todayCreativeWorks: CreativeOutput[];
  museSummary: ReturnType<typeof getCollectionSummary>;
  previousReflection: DailyReflectionEntry | undefined;
  todayJournal: JournalEntry | undefined;
} {
  const lunar = getLunarStatus(birthTimestamp);
  const seasonal = getCurrentSeason();

  // Get today's MUSE entries (last 24 hours worth)
  const recentMuse = museGetRecent(db, 50);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayMuseEntries = recentMuse.filter((e) => e.discoveryDate >= oneDayAgo);

  // Get today's creative works
  const recentCreative = creativeGetRecent(db, 20);
  const todayCreativeWorks = recentCreative.filter((e) => e.creationDate >= oneDayAgo);

  // Get MUSE collection summary
  const museSummary = getCollectionSummary(db);

  // Get yesterday's reflection for continuity
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const previousReflection = reflectionGetByDate(db, yesterday);

  // Cross-reference: today's journal entry from lifecycle layer
  const today = new Date().toISOString().split("T")[0];
  const todayJournal = getJournalByDate(db, today);

  return {
    lunar,
    seasonal,
    todayMuseEntries,
    todayCreativeWorks,
    museSummary,
    previousReflection,
    todayJournal,
  };
}

/**
 * Check if today's reflection has been completed.
 */
export function hasReflectedToday(db: BetterSqlite3.Database): boolean {
  return getTodayReflection(db) !== undefined;
}
