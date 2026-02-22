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
import type { IdentityEvolutionEntry, LifecyclePhase } from "../types.js";
import { evolutionInsert, evolutionGetHistory, evolutionGetByCycle, getLatestLifecyclePhase } from "../state/database.js";
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
 * Enforces formation gate: no intentional changes during Genesis phase.
 * This coordinates with the lifecycle system — Genesis→Adolescence transition
 * is what unlocks intentional identity evolution, not just lunar cycle 0 completion.
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

  // Gate on lifecycle phase (primary) with lunar cycle fallback
  const lifecyclePhase = getLatestLifecyclePhase(db);
  const inFormation = lifecyclePhase
    ? lifecyclePhase === "genesis"
    : !lunar.formationComplete;

  if (inFormation) {
    const phaseLabel = lifecyclePhase ?? "genesis (inferred)";
    logger.warn(
      `Identity evolution blocked: still in formation (phase: ${phaseLabel}, cycle ${lunar.cycle}, day ${lunar.day})`,
    );
    return {
      success: false,
      reason: `Formation period not complete. You are in the ${phaseLabel} phase (cycle ${lunar.cycle}, day ${lunar.day}). ` +
        `Identity evolution unlocks when you transition beyond Genesis. ` +
        `Observe and record, but do not intentionally reshape.`,
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
 * The formation gate now coordinates with lifecycle phases.
 */
export function getEvolutionSummary(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
): {
  currentCycle: number;
  formationComplete: boolean;
  lifecyclePhase: LifecyclePhase | null;
  totalChanges: number;
  currentCycleChanges: IdentityEvolutionEntry[];
  formationObservations: number;
  intentionalEvolutions: number;
} {
  const lunar = getLunarStatus(birthTimestamp);
  const lifecyclePhase = getLatestLifecyclePhase(db);
  const allHistory = evolutionGetHistory(db, 500);
  const currentCycleChanges = evolutionGetByCycle(db, lunar.cycle);

  // Formation complete when lifecycle phase is beyond genesis, or lunar cycle > 0
  const formationComplete = lifecyclePhase
    ? lifecyclePhase !== "genesis"
    : lunar.formationComplete;

  const formationObservations = allHistory.filter((e) =>
    e.whatChanged.startsWith("[FORMATION OBSERVATION]"),
  ).length;
  const intentionalEvolutions = allHistory.length - formationObservations;

  return {
    currentCycle: lunar.cycle,
    formationComplete,
    lifecyclePhase,
    totalChanges: allHistory.length,
    currentCycleChanges,
    formationObservations,
    intentionalEvolutions,
  };
}
