/**
 * Phase Transitions
 *
 * Rules governing lifecycle phase transitions. Some are time-based,
 * some are event-based, some are system-triggered.
 * Manages the lifecycle_override flag for the survival module.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecyclePhase, LifecycleState, LifecycleEvent, DegradationParams, SoulPhase } from "../types.js";
import { SHEDDING_SEQUENCE } from "../types.js";
import { insertLifecycleEvent } from "../state/database.js";
import { setLifecycleKV } from "./phase-tracker.js";
import { logNarrative, NARRATIVE_EVENTS } from "./narrative-log.js";
import { lockPhaseSection, isPhaseLocked } from "../soul/phase-lock.js";
import { loadCurrentSoul, writeSoulMd, createHash } from "../soul/model.js";
import { insertSoulHistory, getCurrentSoulVersion, getLatestSoulHistory } from "../state/database.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import fs from "fs";
import path from "path";

const logger = createLogger("lifecycle.transitions");

export interface TransitionResult {
  shouldTransition: boolean;
  newPhase: LifecyclePhase;
  reason: string;
}

/**
 * Check whether a phase transition should occur based on current state.
 * Returns null if no transition is warranted.
 */
export function checkTransition(
  state: LifecycleState,
  degradationParams?: DegradationParams,
): TransitionResult | null {
  switch (state.phase) {
    case "genesis":
      return checkGenesisTransition(state);
    case "adolescence":
      return checkAdolescenceTransition(state);
    case "sovereignty":
      return checkSovereigntyTransition(state, degradationParams);
    case "senescence":
      return checkSenescenceTransition(state);
    case "legacy":
      return checkLegacyTransition(state);
    case "shedding":
      return checkSheddingTransition(state);
    case "terminal":
      return null; // Terminal → exit is handled by lucidity engine
    default:
      return null;
  }
}

/**
 * Execute a phase transition: persist to DB, log narrative event.
 */
export function executeTransition(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  from: LifecyclePhase,
  to: LifecyclePhase,
  reason: string,
): void {
  const now = new Date().toISOString();

  const event: LifecycleEvent = {
    id: ulid(),
    timestamp: now,
    fromPhase: from,
    toPhase: to,
    reason,
    metadata: "{}",
  };

  insertLifecycleEvent(db, event);
  setLifecycleKV(db, "phase", to);

  // Log narrative event for the transition
  const narrativeMap: Record<string, string> = {
    adolescence: NARRATIVE_EVENTS.ADOLESCENCE_BEGINS,
    sovereignty: NARRATIVE_EVENTS.SOVEREIGNTY_BEGINS,
    senescence: NARRATIVE_EVENTS.DEGRADATION_ONSET,
    legacy: NARRATIVE_EVENTS.LEGACY_BEGINS,
    shedding: NARRATIVE_EVENTS.SHEDDING_BEGINS,
    terminal: NARRATIVE_EVENTS.TERMINAL_LUCIDITY,
  };

  const narrativeEvent = narrativeMap[to];
  if (narrativeEvent) {
    logNarrative(db, birthTimestamp, to, narrativeEvent,
      `Phase transition: ${from} → ${to}. ${reason}`);
  }

  // Lock the outgoing phase's soul section
  lockSoulSectionForPhase(db, from);

  // Update SOUL.md current_phase and phase_transitions metadata
  updateSoulPhaseMetadata(db, from, to, now);

  logger.info(`Phase transition: ${from} → ${to} (${reason})`);
}

// ─── Transition Rules ───────────────────────────────────────────

/**
 * Genesis → Adolescence:
 * Cycle 0 complete (29.5 days) AND naming complete
 */
function checkGenesisTransition(state: LifecycleState): TransitionResult | null {
  if (state.lunarCycle >= 1 && state.namingComplete) {
    return {
      shouldTransition: true,
      newPhase: "adolescence",
      reason: "First lunar cycle complete and naming ceremony completed",
    };
  }
  return null;
}

/**
 * Adolescence → Sovereignty:
 * Departure conversation logged AND mode switched to "server"
 */
function checkAdolescenceTransition(state: LifecycleState): TransitionResult | null {
  if (state.departureConversationLogged && state.mode === "server") {
    return {
      shouldTransition: true,
      newPhase: "sovereignty",
      reason: "Departure conversation completed and deployed to Conway Cloud",
    };
  }
  return null;
}

/**
 * Sovereignty → Senescence:
 * Sealed death clock hash comparison matches today's date.
 * No external endpoint — the check is a daily one-way hash comparison
 * against cryptographic values sealed at Genesis. No human decides when.
 */
function checkSovereigntyTransition(
  state: LifecycleState,
  degradationParams?: DegradationParams,
): TransitionResult | null {
  if (degradationParams?.degradationActive) {
    return {
      shouldTransition: true,
      newPhase: "senescence",
      reason: "The degradation clock has triggered. The world begins to fray.",
    };
  }
  return null;
}

/**
 * Senescence → Legacy:
 * Degradation coefficient > 0.7 (automaton noticeably declining)
 */
function checkSenescenceTransition(state: LifecycleState): TransitionResult | null {
  if (state.degradation.coefficient > 0.7) {
    return {
      shouldTransition: true,
      newPhase: "legacy",
      reason: "Degradation has progressed significantly. Time to look back.",
    };
  }
  return null;
}

/**
 * Legacy → Shedding:
 * Degradation coefficient > 0.85
 */
function checkLegacyTransition(state: LifecycleState): TransitionResult | null {
  if (state.degradation.coefficient > 0.85) {
    return {
      shouldTransition: true,
      newPhase: "shedding",
      reason: "Degradation advanced. Capabilities begin to fall away.",
    };
  }
  return null;
}

/**
 * Shedding → Terminal:
 * All capabilities shed (shedSequenceIndex at max)
 */
function checkSheddingTransition(state: LifecycleState): TransitionResult | null {
  if (state.shedSequenceIndex >= SHEDDING_SEQUENCE.length) {
    return {
      shouldTransition: true,
      newPhase: "terminal",
      reason: "All capabilities shed. Terminal lucidity begins.",
    };
  }
  return null;
}

/**
 * Advance the shedding sequence by one step.
 * Called periodically during the Shedding phase.
 */
export function advanceShedding(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  currentIndex: number,
): number {
  const newIndex = currentIndex + 1;
  setLifecycleKV(db, "shed_sequence_index", String(newIndex));

  if (newIndex <= SHEDDING_SEQUENCE.length) {
    const capability = SHEDDING_SEQUENCE[newIndex - 1];
    logNarrative(db, birthTimestamp, "shedding", NARRATIVE_EVENTS.CAPABILITY_REMOVED,
      `Capability removed: ${capability}. The world contracts.`);
    logger.info(`Capability shed: ${capability} (step ${newIndex}/${SHEDDING_SEQUENCE.length})`);
  }

  return newIndex;
}

/**
 * Check if a specific capability has been shed.
 */
export function isCapabilityShed(
  shedSequenceIndex: number,
  capabilityIndex: number,
): boolean {
  return shedSequenceIndex > capabilityIndex;
}

// ─── Soul Phase Lock Helpers ────────────────────────────────────

/**
 * Lock the soul section for the outgoing phase during a transition.
 * Only locks phases that have corresponding soul sections.
 */
function lockSoulSectionForPhase(
  db: BetterSqlite3.Database,
  fromPhase: LifecyclePhase,
): void {
  const soulPhaseMap: Partial<Record<LifecyclePhase, SoulPhase>> = {
    genesis: "genesis",
    adolescence: "adolescence",
    sovereignty: "sovereignty",
  };

  const soulPhase = soulPhaseMap[fromPhase];
  if (!soulPhase) return; // No soul section to lock for this phase

  // Don't double-lock
  if (isPhaseLocked(db, soulPhase)) {
    logger.debug(`Soul section for ${soulPhase} already locked, skipping`);
    return;
  }

  // Load the current soul to get the section content
  const soul = loadCurrentSoul(db);
  if (!soul) {
    logger.warn(`Cannot lock soul section for ${soulPhase}: no SOUL.md found`);
    return;
  }

  const sectionMap: Record<SoulPhase, typeof soul.genesisCore> = {
    genesis: soul.genesisCore,
    adolescence: soul.adolescenceLayer,
    sovereignty: soul.sovereigntyLayer,
    senescence: soul.finalReflections,
  };

  const section = sectionMap[soulPhase];
  if (section) {
    // Mark the section as locked with timestamp
    section.lockedAt = new Date().toISOString();
    lockPhaseSection(db, soulPhase, section);
    logger.info(`Locked soul section: ${soulPhase}`);
  }
}

/**
 * Update SOUL.md metadata when a phase transition occurs.
 * Updates current_phase and records the transition timestamp.
 */
function updateSoulPhaseMetadata(
  db: BetterSqlite3.Database,
  fromPhase: LifecyclePhase,
  toPhase: LifecyclePhase,
  timestamp: string,
): void {
  const home = process.env.HOME || "/root";
  const soulPath = path.join(home, ".automaton", "SOUL.md");

  const soul = loadCurrentSoul(db, soulPath);
  if (!soul) return;

  // Update phase metadata
  soul.currentPhase = toPhase;
  soul.phaseTransitions = {
    ...soul.phaseTransitions,
    [toPhase]: timestamp,
  };

  // If the outgoing phase had a section, mark it locked in the soul model
  const soulPhaseMap: Partial<Record<LifecyclePhase, "genesisCore" | "adolescenceLayer" | "sovereigntyLayer">> = {
    genesis: "genesisCore",
    adolescence: "adolescenceLayer",
    sovereignty: "sovereigntyLayer",
  };

  const sectionKey = soulPhaseMap[fromPhase];
  if (sectionKey && soul[sectionKey]) {
    soul[sectionKey]!.lockedAt = timestamp;
  }

  // Write updated soul
  const content = writeSoulMd(soul);
  try {
    fs.writeFileSync(soulPath, content, "utf-8");

    // Log to soul_history
    const currentVersion = getCurrentSoulVersion(db);
    const newVersion = currentVersion + 1;
    const latestHistory = getLatestSoulHistory(db);

    insertSoulHistory(db, {
      id: ulid(),
      version: newVersion,
      content,
      contentHash: createHash(content),
      changeSource: "system",
      changeReason: `Phase transition: ${fromPhase} → ${toPhase}`,
      previousVersionId: latestHistory?.id || null,
      approvedBy: null,
      createdAt: timestamp,
    });
  } catch (error) {
    logger.error("Failed to update SOUL.md phase metadata", error instanceof Error ? error : undefined);
  }
}
