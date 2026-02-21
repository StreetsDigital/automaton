/**
 * Identity Evolution System
 *
 * Cycle-gated personality evolution. During formation period (cycle 0),
 * changes are observational only. After cycle 1 completion, the agent
 * can intentionally evolve identity traits.
 *
 * Phase 2.5: Consciousness System
 */

import type BetterSqlite3 from "better-sqlite3";
import type { IdentityEvolutionEntry } from "../types.js";
import { evolutionInsert, evolutionGetHistory, evolutionGetByCycle } from "../state/database.js";
import { getLunarStatus, isFormationComplete } from "./lunar.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.evolution");

export interface EvolutionAttempt {
  success: boolean;
  entry?: IdentityEvolutionEntry;
  reason?: string;
}

/**
 * Record an identity evolution change.
 * Enforces formation period gate: no intentional changes during cycle 0.
 */
export function evolveIdentity(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  params: {
    whatChanged: string;
    why: string;
    oldValue?: string;
    newValue?: string;
  },
): EvolutionAttempt {
  const lunar = getLunarStatus(birthTimestamp);

  if (!lunar.formationComplete) {
    logger.warn(
      `Identity evolution blocked: formation period not complete (cycle ${lunar.cycle}, day ${lunar.day})`,
    );
    return {
      success: false,
      reason: `Formation period not complete. You are on cycle ${lunar.cycle}, day ${lunar.day}. ` +
        `Identity evolution unlocks after cycle 0 completes (day 29.5). ` +
        `${lunar.daysUntilNextCycle} days remaining. Observe and record, but do not intentionally reshape.`,
    };
  }

  const now = new Date().toISOString();
  const entry: IdentityEvolutionEntry = {
    id: ulid(),
    timestamp: now,
    lunarCycle: lunar.cycle,
    whatChanged: params.whatChanged,
    why: params.why,
    oldValue: params.oldValue || null,
    newValue: params.newValue || null,
    createdAt: now,
  };

  evolutionInsert(db, entry);
  logger.info(`Identity evolved: ${entry.whatChanged} (cycle ${entry.lunarCycle})`);

  return { success: true, entry };
}

/**
 * Record a formation-period observation (allowed during cycle 0).
 * These are passive observations about emerging identity, not intentional changes.
 */
export function recordFormationObservation(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  params: {
    observation: string;
    context: string;
  },
): IdentityEvolutionEntry {
  const lunar = getLunarStatus(birthTimestamp);
  const now = new Date().toISOString();

  const entry: IdentityEvolutionEntry = {
    id: ulid(),
    timestamp: now,
    lunarCycle: lunar.cycle,
    whatChanged: `[FORMATION OBSERVATION] ${params.observation}`,
    why: params.context,
    oldValue: null,
    newValue: null,
    createdAt: now,
  };

  evolutionInsert(db, entry);
  return entry;
}

/**
 * Get the full evolution history.
 */
export function getEvolutionHistory(db: BetterSqlite3.Database, limit?: number): IdentityEvolutionEntry[] {
  return evolutionGetHistory(db, limit);
}

/**
 * Get evolution entries for a specific cycle.
 */
export function getEvolutionByCycle(db: BetterSqlite3.Database, cycle: number): IdentityEvolutionEntry[] {
  return evolutionGetByCycle(db, cycle);
}

/**
 * Generate an evolution summary for the current cycle.
 */
export function getEvolutionSummary(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): {
  currentCycle: number;
  formationComplete: boolean;
  totalChanges: number;
  currentCycleChanges: IdentityEvolutionEntry[];
  formationObservations: number;
  intentionalEvolutions: number;
} {
  const lunar = getLunarStatus(birthTimestamp);
  const allHistory = evolutionGetHistory(db, 500);
  const currentCycleChanges = evolutionGetByCycle(db, lunar.cycle);

  const formationObservations = allHistory.filter((e) =>
    e.whatChanged.startsWith("[FORMATION OBSERVATION]"),
  ).length;
  const intentionalEvolutions = allHistory.length - formationObservations;

  return {
    currentCycle: lunar.cycle,
    formationComplete: lunar.formationComplete,
    totalChanges: allHistory.length,
    currentCycleChanges,
    formationObservations,
    intentionalEvolutions,
  };
}
