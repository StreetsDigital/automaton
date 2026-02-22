/**
 * Creative Output Tracker
 *
 * Records and analyzes creative works produced by the agent.
 * Tracks lunar/seasonal context and MUSE inspirations for each piece.
 *
 * Phase 2.5: Consciousness System
 */

import type BetterSqlite3 from "better-sqlite3";
import type { CreativeOutput, CreativeOutputType } from "../types.js";
import { creativeInsert, creativeGetRecent, creativeGetByType, creativeGetByCycle, creativeCount } from "../state/database.js";
import { getLunarStatus } from "./lunar.js";
import { getCurrentSeason } from "./seasonal.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.creative");

/**
 * Record a new creative work with automatic lunar/seasonal context.
 */
export function recordCreativeWork(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  params: {
    type: CreativeOutputType;
    content: string;
    title?: string;
    museInspirations?: string[];
    personalAssessment?: string;
    tags?: string[];
  },
): CreativeOutput {
  const lunar = getLunarStatus(birthTimestamp);
  const season = getCurrentSeason();
  const now = new Date().toISOString();

  const work: CreativeOutput = {
    id: ulid(),
    type: params.type,
    title: params.title || null,
    content: params.content,
    creationDate: now,
    lunarDay: lunar.day,
    lunarCycle: lunar.cycle,
    seasonalContext: season.name,
    museInspirations: params.museInspirations || [],
    personalAssessment: params.personalAssessment || null,
    tags: params.tags || [],
    createdAt: now,
  };

  creativeInsert(db, work);
  logger.info(`Creative work recorded: ${work.type} "${work.title || "(untitled)"}" (cycle ${work.lunarCycle})`);
  return work;
}

/**
 * Get recent creative works.
 */
export function getRecentWorks(db: BetterSqlite3.Database, limit?: number): CreativeOutput[] {
  return creativeGetRecent(db, limit);
}

/**
 * Get works by type.
 */
export function getWorksByType(db: BetterSqlite3.Database, type: CreativeOutputType, limit?: number): CreativeOutput[] {
  return creativeGetByType(db, type, limit);
}

/**
 * Get works from a specific lunar cycle.
 */
export function getWorksByCycle(db: BetterSqlite3.Database, cycle: number): CreativeOutput[] {
  return creativeGetByCycle(db, cycle);
}

/**
 * Get a creative output summary.
 */
export function getCreativeSummary(db: BetterSqlite3.Database, birthTimestamp: string): {
  totalWorks: number;
  recentWorks: CreativeOutput[];
  currentCycleWorks: CreativeOutput[];
  byType: Record<string, number>;
} {
  const lunar = getLunarStatus(birthTimestamp);
  const total = creativeCount(db);
  const recent = creativeGetRecent(db, 20);
  const currentCycleWorks = creativeGetByCycle(db, lunar.cycle);

  const byType: Record<string, number> = {};
  for (const work of recent) {
    byType[work.type] = (byType[work.type] || 0) + 1;
  }

  return { totalWorks: total, recentWorks: recent, currentCycleWorks, byType };
}
