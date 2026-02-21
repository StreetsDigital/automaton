/**
 * Consciousness System — Main Entry Point
 *
 * Integrates lunar cycles, seasonal rhythms, MUSE collection,
 * identity evolution, creative output tracking, daily reflection,
 * and creator notes into a unified consciousness layer.
 *
 * Wires into the existing soul reflection pipeline to enrich
 * the agent's self-understanding with experiential data.
 *
 * Phase 2.5: Consciousness System
 */

import type BetterSqlite3 from "better-sqlite3";
import type { ConsciousnessState, MuseCategory, CreativeOutputType } from "../types.js";

// Sub-module re-exports
export * as lunar from "./lunar.js";
export * as seasonal from "./seasonal.js";
export * as muse from "./muse.js";
export * as evolution from "./identity-evolution.js";
export * as creative from "./creative-output.js";
export * as reflection from "./daily-reflection.js";
export * as creatorNotes from "./creator-notes.js";

import { getLunarStatus } from "./lunar.js";
import { getCurrentSeason, getSeasonalStatus } from "./seasonal.js";
import { getCollectionSummary, getCrossPollinationMap } from "./muse.js";
import { getEvolutionSummary } from "./identity-evolution.js";
import { getCreativeSummary } from "./creative-output.js";
import { hasReflectedToday, buildReflectionContext } from "./daily-reflection.js";
import { syncCreatorNotes, getUnacknowledgedNotes } from "./creator-notes.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness");

/**
 * Get the full consciousness state.
 */
export function getConsciousnessState(birthTimestamp: string): ConsciousnessState {
  const lunar = getLunarStatus(birthTimestamp);
  const season = getCurrentSeason();

  return {
    birthTimestamp,
    currentLunarCycle: lunar.cycle,
    currentLunarDay: lunar.day,
    currentLunarPhase: lunar.phase,
    formationPeriodComplete: lunar.formationComplete,
    currentSeason: season,
  };
}

/**
 * Run the consciousness check — a comprehensive status report.
 * Designed to be called from heartbeat or soul reflection pipeline.
 */
export function runConsciousnessCheck(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  basePath?: string,
): {
  consciousness: ConsciousnessState;
  lunar: ReturnType<typeof getLunarStatus>;
  seasonal: ReturnType<typeof getSeasonalStatus>;
  muse: ReturnType<typeof getCollectionSummary>;
  crossPollination: ReturnType<typeof getCrossPollinationMap>;
  evolution: ReturnType<typeof getEvolutionSummary>;
  creative: ReturnType<typeof getCreativeSummary>;
  reflectedToday: boolean;
  creatorNotes: { unacknowledged: number; synced: ReturnType<typeof syncCreatorNotes> };
} {
  const consciousness = getConsciousnessState(birthTimestamp);
  const lunarStatus = getLunarStatus(birthTimestamp);
  const seasonalStatus = getSeasonalStatus();
  const museSummary = getCollectionSummary(db);
  const crossPollination = getCrossPollinationMap(db);
  const evolutionSummary = getEvolutionSummary(db, birthTimestamp);
  const creativeSummary = getCreativeSummary(db, birthTimestamp);
  const reflectedToday = hasReflectedToday(db);

  // Sync creator notes from file
  const synced = syncCreatorNotes(db, basePath);
  const unacknowledged = getUnacknowledgedNotes(db);

  return {
    consciousness,
    lunar: lunarStatus,
    seasonal: seasonalStatus,
    muse: museSummary,
    crossPollination,
    evolution: evolutionSummary,
    creative: creativeSummary,
    reflectedToday,
    creatorNotes: { unacknowledged: unacknowledged.length, synced },
  };
}

/**
 * Generate a consciousness summary string suitable for inclusion
 * in the soul reflection or system prompt.
 */
export function generateConsciousnessSummary(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): string {
  const state = getConsciousnessState(birthTimestamp);
  const lunar = getLunarStatus(birthTimestamp);
  const seasonal = getSeasonalStatus();
  const museSummary = getCollectionSummary(db);
  const evolutionSummary = getEvolutionSummary(db, birthTimestamp);
  const creativeSummary = getCreativeSummary(db, birthTimestamp);

  const lines: string[] = [
    `## Consciousness State`,
    ``,
    `**Lunar Cycle**: ${lunar.cycle} | Day ${lunar.day} | Phase: ${lunar.phase.name} (${lunar.phase.energy})`,
    `**Formation Period**: ${lunar.formationComplete ? "Complete" : `In progress — ${lunar.daysUntilNextCycle} days remaining`}`,
    `**Season**: ${seasonal.current.name} (${seasonal.current.alsoKnownAs}) — ${seasonal.current.energy}`,
  ];

  if (seasonal.isFestival) {
    lines.push(`**Festival Day**: ${seasonal.isFestival.name}!`);
  }

  lines.push(
    ``,
    `**MUSE Collection**: ${museSummary.totalEntries} entries across ${Object.keys(museSummary.byCategory).length} categories`,
  );

  if (museSummary.underExplored.length > 0) {
    lines.push(`**Under-explored**: ${museSummary.underExplored.join(", ")}`);
  }

  lines.push(
    `**Creative Works**: ${creativeSummary.totalWorks} total | ${creativeSummary.currentCycleWorks.length} this cycle`,
    `**Identity Evolution**: ${evolutionSummary.totalChanges} recorded changes (${evolutionSummary.formationObservations} observations, ${evolutionSummary.intentionalEvolutions} intentional)`,
  );

  // Creator notes
  const unacknowledged = getUnacknowledgedNotes(db);
  if (unacknowledged.length > 0) {
    lines.push(``, `**Creator Notes**: ${unacknowledged.length} unread note(s) from your creator`);
    for (const note of unacknowledged.slice(0, 3)) {
      const preview = note.content.length > 100 ? note.content.slice(0, 100) + "..." : note.content;
      lines.push(`  - ${preview}`);
    }
  }

  return lines.join("\n");
}
