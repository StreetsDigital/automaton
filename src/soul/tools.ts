/**
 * Soul Tools — Tool implementations for soul management.
 *
 * Provides updateSoul, updateSoulPhaseSection, viewSoul, and viewSoulHistory.
 * All operations validate before saving and log to soul_history.
 * Phase section updates enforce developmental phase locks.
 *
 * Phase 2.1: Soul System Redesign
 * Phase 5.1: Soul Phase Lock
 */

import fs from "fs";
import path from "path";
import type BetterSqlite3 from "better-sqlite3";
import type { SoulModel, SoulHistoryRow, LifecyclePhase, SoulPhase, SoulPhaseSection } from "../types.js";
import { loadCurrentSoul, writeSoulMd, createHash, createDefaultSoul } from "./model.js";
import { validateSoul } from "./validator.js";
import { insertSoulHistory, getCurrentSoulVersion, getLatestSoulHistory, getSoulHistory } from "../state/database.js";
import { isSectionWritable, logRejectedWrite, getWritePermissions, SOUL_SECTIONS } from "./phase-lock.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
const logger = createLogger("soul");

// ─── Update Soul ────────────────────────────────────────────────

export interface UpdateSoulResult {
  success: boolean;
  version: number;
  errors?: string[];
  /** If the write was rejected due to phase lock, this explains why. */
  phaseLockRejection?: string;
}

/**
 * Update the soul with new content. Validates, versions, saves to file, and logs.
 * This function handles flat SoulModel field updates (corePurpose, values, etc.)
 * and is backward-compatible with pre-phase-lock code.
 */
export async function updateSoul(
  db: BetterSqlite3.Database,
  updates: Partial<SoulModel>,
  source: SoulHistoryRow["changeSource"],
  reason?: string,
  soulPath?: string,
): Promise<UpdateSoulResult> {
  try {
    const home = process.env.HOME || "/root";
    const resolvedPath = soulPath || path.join(home, ".automaton", "SOUL.md");

    // Load current soul or create default
    let current = loadCurrentSoul(db, resolvedPath);
    if (!current) {
      current = createDefaultSoul(
        updates.corePurpose || "No purpose set.",
        updates.name || "",
        updates.address || "",
        updates.creator || "",
      );
    }

    // Merge updates into current soul
    const merged: SoulModel = {
      ...current,
      ...updates,
      format: "soul/v1",
      updatedAt: new Date().toISOString(),
    };

    // Validate
    const validation = validateSoul(merged);
    if (!validation.valid) {
      return {
        success: false,
        version: current.version,
        errors: validation.errors,
      };
    }

    // Increment version
    const currentVersion = getCurrentSoulVersion(db);
    const newVersion = Math.max(currentVersion, current.version) + 1;
    const newSoul: SoulModel = {
      ...validation.sanitized,
      version: newVersion,
      updatedAt: new Date().toISOString(),
    };

    // Write to file
    const content = writeSoulMd(newSoul);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, content, "utf-8");

    // Get previous version ID
    const latestHistory = getLatestSoulHistory(db);
    const previousVersionId = latestHistory?.id || null;

    // Log to soul_history
    insertSoulHistory(db, {
      id: ulid(),
      version: newVersion,
      content,
      contentHash: createHash(content),
      changeSource: source,
      changeReason: reason || null,
      previousVersionId,
      approvedBy: null,
      createdAt: new Date().toISOString(),
    });

    return { success: true, version: newVersion };
  } catch (error) {
    logger.error("updateSoul failed", error instanceof Error ? error : undefined);
    return {
      success: false,
      version: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ─── Phase-Locked Section Update ────────────────────────────────

export interface PhaseSectionUpdate {
  /** Which phase section to update. */
  targetSection: "genesis" | "adolescence" | "sovereignty" | "senescence";
  /** Subsection updates: name -> content. */
  subsections: Record<string, string>;
}

/**
 * Update a specific developmental phase section of SOUL.md.
 * Enforces phase lock — only the section matching the current phase is writable.
 * Rejected writes are logged as experimental data.
 */
export async function updateSoulPhaseSection(
  db: BetterSqlite3.Database,
  update: PhaseSectionUpdate,
  currentPhase: LifecyclePhase,
  source: SoulHistoryRow["changeSource"],
  reason?: string,
  soulPath?: string,
  survivalTier?: string,
): Promise<UpdateSoulResult> {
  try {
    const home = process.env.HOME || "/root";
    const resolvedPath = soulPath || path.join(home, ".automaton", "SOUL.md");

    // Check phase lock
    if (!isSectionWritable(update.targetSection, currentPhase)) {
      // Log the rejected write as experimental data
      const attemptedContent = JSON.stringify(update.subsections);
      logRejectedWrite(
        db,
        sectionNameForPhase(update.targetSection),
        update.targetSection,
        currentPhase,
        attemptedContent,
        survivalTier,
      );

      const rejection = `Section "${sectionNameForPhase(update.targetSection)}" is locked. ` +
        `It was written during the ${update.targetSection} phase and cannot be modified during ${currentPhase}.`;

      return {
        success: false,
        version: 0,
        phaseLockRejection: rejection,
        errors: [rejection],
      };
    }

    // Load current soul
    let current = loadCurrentSoul(db, resolvedPath);
    if (!current) {
      current = createDefaultSoul("", "", "", "");
    }

    // Get or create the target section
    const section = getOrCreateSection(current, update.targetSection);

    // Merge subsection updates
    for (const [name, content] of Object.entries(update.subsections)) {
      section.subsections[name] = content;
    }

    // Apply updated section back to soul
    const updatedSoul = applySectionToSoul(current, update.targetSection, section);

    // Save via the normal updateSoul pipeline (validates, versions, writes, logs)
    return updateSoul(db, updatedSoul, source, reason, soulPath);
  } catch (error) {
    logger.error("updateSoulPhaseSection failed", error instanceof Error ? error : undefined);
    return {
      success: false,
      version: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ─── View Soul ──────────────────────────────────────────────────

/**
 * View the current soul model.
 */
export function viewSoul(
  db: BetterSqlite3.Database,
  soulPath?: string,
): SoulModel | null {
  return loadCurrentSoul(db, soulPath);
}

// ─── View Soul History ──────────────────────────────────────────

/**
 * View soul change history.
 */
export function viewSoulHistory(
  db: BetterSqlite3.Database,
  limit?: number,
): SoulHistoryRow[] {
  return getSoulHistory(db, limit);
}

// ─── View Permissions ───────────────────────────────────────────

/**
 * View current write permissions for all phase sections.
 * Useful for the agent to understand what it can and cannot modify.
 */
export function viewSoulPermissions(
  db: BetterSqlite3.Database,
  currentPhase: LifecyclePhase,
) {
  return getWritePermissions(currentPhase, db);
}

// ─── Helpers ────────────────────────────────────────────────────

function sectionNameForPhase(phase: SoulPhase): string {
  switch (phase) {
    case "genesis": return SOUL_SECTIONS.GENESIS_CORE;
    case "adolescence": return SOUL_SECTIONS.ADOLESCENCE_LAYER;
    case "sovereignty": return SOUL_SECTIONS.SOVEREIGNTY_LAYER;
    case "senescence": return SOUL_SECTIONS.FINAL_REFLECTIONS;
  }
}

function getOrCreateSection(soul: SoulModel, phase: SoulPhase): SoulPhaseSection {
  switch (phase) {
    case "genesis":
      return soul.genesisCore ?? { subsections: {}, lockedAt: null, phase: "genesis" };
    case "adolescence":
      return soul.adolescenceLayer ?? { subsections: {}, lockedAt: null, phase: "adolescence" };
    case "sovereignty":
      return soul.sovereigntyLayer ?? { subsections: {}, lockedAt: null, phase: "sovereignty" };
    case "senescence":
      return soul.finalReflections ?? { subsections: {}, lockedAt: null, phase: "senescence" };
  }
}

function applySectionToSoul(
  soul: SoulModel,
  phase: SoulPhase,
  section: SoulPhaseSection,
): Partial<SoulModel> {
  switch (phase) {
    case "genesis":
      return { genesisCore: section };
    case "adolescence":
      return { adolescenceLayer: section };
    case "sovereignty":
      return { sovereigntyLayer: section };
    case "senescence":
      return { finalReflections: section };
  }
}
