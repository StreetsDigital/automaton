/**
 * MUSE Collection System
 *
 * 8-category aesthetic inspiration collection.
 * Stores, retrieves, and analyzes MUSE entries.
 * Tracks cross-pollination patterns between categories.
 *
 * Phase 2.5: Consciousness System
 */

import type BetterSqlite3 from "better-sqlite3";
import type { MuseEntry, MuseCategory } from "../types.js";
import { museInsert, museGetByCategory, museGetRecent, museGetByCycle, museCount, museCountByCategory } from "../state/database.js";
import { getLunarStatus } from "./lunar.js";
import { getCurrentSeason } from "./seasonal.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.muse");

const VALID_CATEGORIES: MuseCategory[] = [
  "words", "sounds", "visuals", "philosophy",
  "nature", "technology", "culture", "dreams",
];

/**
 * Add a new MUSE entry with automatic lunar/seasonal context.
 */
export function addMuseEntry(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  params: {
    category: MuseCategory;
    content: string;
    source: string;
    emotionalResponse: string;
    crossPollinationTags?: MuseCategory[];
    personalNote?: string;
  },
): MuseEntry {
  if (!VALID_CATEGORIES.includes(params.category)) {
    throw new Error(`Invalid MUSE category: ${params.category}. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  const lunar = getLunarStatus(birthTimestamp);
  const season = getCurrentSeason();
  const now = new Date().toISOString();

  const entry: MuseEntry = {
    id: ulid(),
    category: params.category,
    content: params.content,
    source: params.source,
    discoveryDate: now,
    emotionalResponse: params.emotionalResponse,
    crossPollinationTags: params.crossPollinationTags || [],
    personalNote: params.personalNote || null,
    lunarDay: lunar.day,
    lunarCycle: lunar.cycle,
    seasonalContext: season.name,
    createdAt: now,
  };

  museInsert(db, entry);
  logger.info(`MUSE entry added: ${entry.category} (cycle ${entry.lunarCycle}, day ${entry.lunarDay})`);
  return entry;
}

/**
 * Get entries by category.
 */
export function getByCategory(db: BetterSqlite3.Database, category: MuseCategory, limit?: number): MuseEntry[] {
  return museGetByCategory(db, category, limit);
}

/**
 * Get recent entries across all categories.
 */
export function getRecent(db: BetterSqlite3.Database, limit?: number): MuseEntry[] {
  return museGetRecent(db, limit);
}

/**
 * Get all entries from a specific lunar cycle.
 */
export function getByCycle(db: BetterSqlite3.Database, cycle: number): MuseEntry[] {
  return museGetByCycle(db, cycle);
}

/**
 * Get a summary of the MUSE collection.
 */
export function getCollectionSummary(db: BetterSqlite3.Database): {
  totalEntries: number;
  byCategory: Record<string, number>;
  underExplored: string[];
  strongCategories: string[];
} {
  const total = museCount(db);
  const byCategory = museCountByCategory(db);

  // Fill in zeros for empty categories
  for (const cat of VALID_CATEGORIES) {
    if (!(cat in byCategory)) byCategory[cat] = 0;
  }

  const avgPerCategory = total / VALID_CATEGORIES.length;
  const underExplored = VALID_CATEGORIES.filter((cat) => byCategory[cat] < avgPerCategory * 0.5);
  const strongCategories = VALID_CATEGORIES.filter((cat) => byCategory[cat] > avgPerCategory * 1.5);

  return { totalEntries: total, byCategory, underExplored, strongCategories };
}

/**
 * Find cross-pollination patterns: entries that bridge multiple categories.
 */
export function getCrossPollinationMap(db: BetterSqlite3.Database, limit: number = 100): {
  bridges: Array<{ from: MuseCategory; to: MuseCategory; count: number }>;
  mostConnected: MuseCategory | null;
} {
  const recent = museGetRecent(db, limit);
  const bridgeCounts = new Map<string, number>();

  for (const entry of recent) {
    for (const tag of entry.crossPollinationTags) {
      if (tag !== entry.category) {
        const key = [entry.category, tag].sort().join("→");
        bridgeCounts.set(key, (bridgeCounts.get(key) || 0) + 1);
      }
    }
  }

  const bridges = Array.from(bridgeCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split("→") as [MuseCategory, MuseCategory];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count);

  // Find most connected category
  const connectionCounts = new Map<string, number>();
  for (const bridge of bridges) {
    connectionCounts.set(bridge.from, (connectionCounts.get(bridge.from) || 0) + bridge.count);
    connectionCounts.set(bridge.to, (connectionCounts.get(bridge.to) || 0) + bridge.count);
  }

  let mostConnected: MuseCategory | null = null;
  let maxConnections = 0;
  for (const [cat, count] of connectionCounts) {
    if (count > maxConnections) {
      maxConnections = count;
      mostConnected = cat as MuseCategory;
    }
  }

  return { bridges, mostConnected };
}
