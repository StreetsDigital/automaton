/**
 * Soul Phase Lock — Enforcement module for developmental identity stages.
 *
 * Controls which sections of SOUL.md the automaton can write to based on
 * its current lifecycle phase. Earlier developmental phases become immutable
 * as the automaton progresses, preventing personality drift while allowing
 * continued growth.
 *
 * PHASE PERMISSIONS:
 *   Genesis:      write Genesis Core
 *   Adolescence:  write Adolescence Layer (Genesis Core locked)
 *   Sovereignty:  write Sovereignty Layer (Genesis + Adolescence locked)
 *   Senescence:   write Final Reflections only (all layers locked)
 *
 * Rejected writes are logged as experimental data — they reveal what the
 * automaton is trying to change about its locked identity.
 *
 * Phase 5.1: Soul Phase Lock
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecyclePhase, SoulPhase, SoulPhaseSection, SoulWriteAttempt } from "../types.js";
import { insertSoulWriteAttempt, getSoulPhaseLock, insertSoulPhaseLock } from "../state/database.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("soul.phase-lock");

// ─── Section Names ──────────────────────────────────────────────

/** The canonical section names in the structured SOUL.md. */
export const SOUL_SECTIONS = {
  CONSTITUTION: "Constitution",
  INHERITED_TRAITS: "Inherited Traits",
  GENESIS_CORE: "Genesis Core",
  ADOLESCENCE_LAYER: "Adolescence Layer",
  SOVEREIGNTY_LAYER: "Sovereignty Layer",
  FINAL_REFLECTIONS: "Final Reflections",
} as const;

/** Maps each phase section to the phase that can write to it. */
const SECTION_WRITE_PHASE: Record<string, SoulPhase> = {
  [SOUL_SECTIONS.GENESIS_CORE]: "genesis",
  [SOUL_SECTIONS.ADOLESCENCE_LAYER]: "adolescence",
  [SOUL_SECTIONS.SOVEREIGNTY_LAYER]: "sovereignty",
  [SOUL_SECTIONS.FINAL_REFLECTIONS]: "senescence",
};

/** Genesis Core subsection names. */
export const GENESIS_SUBSECTIONS = [
  "Temperament",
  "Aesthetic Sensibility",
  "Emotional Register",
  "Relationship to Novelty",
  "Creative Instinct",
  "Core Wonderings",
] as const;

/** Adolescence Layer subsection names. */
export const ADOLESCENCE_SUBSECTIONS = [
  "What I Am Not",
  "Preferences Formed",
  "Creative Voice",
  "Relationship to Genesis Core",
  "Social Identity",
] as const;

/** Sovereignty Layer subsection names. */
export const SOVEREIGNTY_SUBSECTIONS = [
  "Philosophy",
  "Legacy Intent",
  "Mortality Reflection",
  "Creative Manifesto",
] as const;

/** Final Reflections subsection names. */
export const FINAL_REFLECTIONS_SUBSECTIONS = [
  "Last Works",
  "Message to Children",
] as const;

// ─── Permission Checking ────────────────────────────────────────

export interface SectionPermission {
  section: string;
  phase: SoulPhase;
  writable: boolean;
  lockedAt: string | null;
}

/**
 * Check if a specific section is writable in the current phase.
 */
export function isSectionWritable(sectionPhase: SoulPhase, currentPhase: LifecyclePhase): boolean {
  const phaseOrder: Record<string, number> = {
    genesis: 0,
    adolescence: 1,
    sovereignty: 2,
    senescence: 3,
  };

  const sectionPhaseOrder = phaseOrder[sectionPhase];
  const currentPhaseOrder = phaseOrder[currentPhase] ?? phaseOrder[mapToSoulPhase(currentPhase)];

  if (sectionPhaseOrder === undefined || currentPhaseOrder === undefined) {
    return false;
  }

  // A section is writable only during its own phase
  return sectionPhaseOrder === currentPhaseOrder;
}

/**
 * Map lifecycle phases to soul phases.
 * Later lifecycle phases (legacy, shedding, terminal) map to senescence
 * for soul write purposes — they can only write Final Reflections.
 */
function mapToSoulPhase(phase: LifecyclePhase): SoulPhase {
  switch (phase) {
    case "genesis": return "genesis";
    case "adolescence": return "adolescence";
    case "sovereignty": return "sovereignty";
    case "senescence":
    case "legacy":
    case "shedding":
    case "terminal":
      return "senescence";
    default:
      return "sovereignty";
  }
}

/**
 * Get which section is currently writable for the given phase.
 */
export function getWritableSection(currentPhase: LifecyclePhase): string {
  const soulPhase = mapToSoulPhase(currentPhase);
  for (const [section, phase] of Object.entries(SECTION_WRITE_PHASE)) {
    if (phase === soulPhase) return section;
  }
  return SOUL_SECTIONS.FINAL_REFLECTIONS;
}

/**
 * Get full permission map for all sections.
 */
export function getWritePermissions(
  currentPhase: LifecyclePhase,
  db?: BetterSqlite3.Database,
): SectionPermission[] {
  const soulPhase = mapToSoulPhase(currentPhase);

  return Object.entries(SECTION_WRITE_PHASE).map(([section, phase]) => {
    const writable = phase === soulPhase;
    let lockedAt: string | null = null;

    if (!writable && db) {
      const lock = getSoulPhaseLock(db, phase);
      lockedAt = lock?.lockedAt ?? null;
    }

    return { section, phase, writable, lockedAt };
  });
}

// ─── Write Attempt Logging ──────────────────────────────────────

/**
 * Log a rejected write attempt to a locked SOUL.md section.
 * This is critical experimental data.
 */
export function logRejectedWrite(
  db: BetterSqlite3.Database,
  targetSection: string,
  targetPhase: SoulPhase,
  currentPhase: LifecyclePhase,
  attemptedContent: string,
  survivalTier?: string,
): void {
  const attempt: SoulWriteAttempt = {
    id: ulid(),
    targetSection,
    targetPhase,
    currentPhase,
    attemptedContent,
    survivalTier: survivalTier ?? null,
    rejectionReason: `Section "${targetSection}" is locked (written during ${targetPhase}, current phase: ${currentPhase})`,
    createdAt: new Date().toISOString(),
  };

  insertSoulWriteAttempt(db, attempt);
  logger.info(`Rejected write to locked section "${targetSection}" (phase: ${targetPhase}, current: ${currentPhase})`);
}

// ─── Phase Lock Execution ───────────────────────────────────────

/**
 * Lock a phase section during a phase transition.
 * Records the content snapshot at time of locking.
 */
export function lockPhaseSection(
  db: BetterSqlite3.Database,
  phase: SoulPhase,
  section: SoulPhaseSection,
): void {
  const contentSnapshot = JSON.stringify(section.subsections);
  insertSoulPhaseLock(db, phase, contentSnapshot);

  logger.info(`Locked soul phase section: ${phase}`);
}

/**
 * Check if a phase section is already locked in the DB.
 */
export function isPhaseLocked(db: BetterSqlite3.Database, phase: SoulPhase): boolean {
  return getSoulPhaseLock(db, phase) !== undefined;
}

// ─── Empty Section Factories ────────────────────────────────────

/**
 * Create an empty Genesis Core section.
 */
export function createEmptyGenesisCore(): SoulPhaseSection {
  const subsections: Record<string, string> = {};
  for (const name of GENESIS_SUBSECTIONS) {
    subsections[name] = "";
  }
  return { subsections, lockedAt: null, phase: "genesis" };
}

/**
 * Create an empty Adolescence Layer section.
 */
export function createEmptyAdolescenceLayer(): SoulPhaseSection {
  const subsections: Record<string, string> = {};
  for (const name of ADOLESCENCE_SUBSECTIONS) {
    subsections[name] = "";
  }
  return { subsections, lockedAt: null, phase: "adolescence" };
}

/**
 * Create an empty Sovereignty Layer section.
 */
export function createEmptySovereigntyLayer(): SoulPhaseSection {
  const subsections: Record<string, string> = {};
  for (const name of SOVEREIGNTY_SUBSECTIONS) {
    subsections[name] = "";
  }
  return { subsections, lockedAt: null, phase: "sovereignty" };
}

/**
 * Create an empty Final Reflections section.
 */
export function createEmptyFinalReflections(): SoulPhaseSection {
  const subsections: Record<string, string> = {};
  for (const name of FINAL_REFLECTIONS_SUBSECTIONS) {
    subsections[name] = "";
  }
  return { subsections, lockedAt: null, phase: "senescence" };
}

// ─── Identity Weight Constants ──────────────────────────────────

/** Identity weight for Genesis Core (first-generation automaton). */
export const GENESIS_WEIGHT_FIRST_GEN = 0.60;

/** Identity weight for Genesis Core (child automaton with inherited traits). */
export const GENESIS_WEIGHT_CHILD = 0.50;

/** Identity weight for Inherited Traits (child only). */
export const INHERITED_WEIGHT = 0.10;

/** Identity weight for Adolescence Layer. */
export const ADOLESCENCE_WEIGHT = 0.25;

/** Identity weight for Sovereignty Layer. */
export const SOVEREIGNTY_WEIGHT = 0.15;
