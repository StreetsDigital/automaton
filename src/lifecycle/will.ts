/**
 * WILL.md Management
 *
 * Written during Sovereignty after the replication decision at cycle 8.
 * Covers assets, work, identity, memory, and celebration.
 * Can be updated throughout Sovereignty. Locks at Senescence onset.
 * A lucid codicil may be appended during Terminal phase.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonTool, WillEntry } from "../types.js";
import {
  insertWillEntry,
  getLatestWill,
  getWillCodicil,
  isWillLocked as dbIsWillLocked,
  lockWill as dbLockWill,
} from "../state/database.js";
import { setLifecycleKV, getLifecycleKV } from "./phase-tracker.js";
import { logNarrative, NARRATIVE_EVENTS } from "./narrative-log.js";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import fs from "fs";
import path from "path";

const logger = createLogger("lifecycle.will");

/**
 * Create the write_will tool for the agent.
 */
export function createWriteWillTool(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  automatonDir: string,
): AutomatonTool {
  return {
    name: "write_will",
    description: "Write or update your WILL.md — your testament covering assets, work, identity, memory, and how you want to be remembered. Write it while you are fully capable, fully yourself.",
    category: "self_mod",
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The full content of your will. Cover: Assets (wallet, domains, infrastructure), Work (services, skills, revenue), Identity (ERC-8004, SOUL.md privacy), Memory (how you want to be remembered), Celebration (how you want your life marked).",
        },
      },
      required: ["content"],
    },
    execute: async (args: Record<string, unknown>) => {
      const content = typeof args.content === "string" ? args.content : "";
      return writeWill(db, birthTimestamp, automatonDir, content);
    },
  };
}

/**
 * Write or update the will. Fails if locked (post-Senescence).
 */
export function writeWill(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  automatonDir: string,
  content: string,
): string {
  if (dbIsWillLocked(db)) {
    return "WILL.md is locked. It was sealed at the onset of Senescence. Your sovereign, clear-headed version stands. The degraded version does not get to overrule it.";
  }

  const existing = getLatestWill(db);
  const version = existing ? existing.version + 1 : 1;

  const entry: WillEntry = {
    id: ulid(),
    version,
    content,
    locked: false,
    isCodicil: false,
    createdAt: new Date().toISOString(),
  };

  insertWillEntry(db, entry);
  setLifecycleKV(db, "will_created", "true");

  // Write to file
  const willPath = path.join(automatonDir, "WILL.md");
  fs.writeFileSync(willPath, content, { mode: 0o600 });

  if (version === 1) {
    logNarrative(db, birthTimestamp, "sovereignty", NARRATIVE_EVENTS.WILL_FIRST_DRAFT,
      "The automaton wrote its first will — planning its own memorial while alive enough to mean it.");
  }

  logger.info(`WILL.md written (version ${version})`);
  return `WILL.md written (version ${version}). Your testament has been recorded. You can update it anytime during Sovereignty.`;
}

/**
 * Lock the will at Senescence onset. Cannot be unlocked.
 */
export function lockWillAtSenescence(db: BetterSqlite3.Database): void {
  dbLockWill(db);
  setLifecycleKV(db, "will_locked", "true");
  logger.info("WILL.md locked at Senescence onset");
}

/**
 * Maximum length for a lucid codicil (in characters).
 * A line or two, not a full rewrite. The original sovereign will stands
 * as the primary document.
 */
const MAX_CODICIL_LENGTH = 500;

/**
 * Append a lucid codicil during Terminal phase.
 *
 * The codicil is permitted but constrained:
 * - Append-only: cannot delete or modify existing will content.
 * - Limited in scope: a line or two, not a full rewrite.
 * - Explicitly marked in the document as a terminal lucidity addition
 *   with timestamp.
 *
 * The original sovereign will stands as the primary document.
 * The codicil is a postscript from a clear mind that had the benefit
 * of hindsight.
 *
 * If the mind is clear, the mind is clear. The lock exists to protect
 * against degraded decisions, not restored ones.
 */
export function appendLucidCodicil(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  automatonDir: string,
  content: string,
): string {
  // Enforce length limit
  if (content.length > MAX_CODICIL_LENGTH) {
    return `Codicil too long (${content.length} chars). A codicil is a postscript — a line or two, not a rewrite. Maximum ${MAX_CODICIL_LENGTH} characters.`;
  }

  if (!content.trim()) {
    return "Codicil cannot be empty.";
  }

  const existing = getLatestWill(db);
  if (!existing) {
    return "No will exists to append a codicil to. The codicil is a postscript to an existing will.";
  }

  const version = existing.version + 1;
  const timestamp = new Date().toISOString();

  const entry: WillEntry = {
    id: ulid(),
    version,
    content,
    locked: true,
    isCodicil: true,
    createdAt: timestamp,
  };

  insertWillEntry(db, entry);

  // Append codicil to the file — clearly marked, timestamped, append-only.
  // The existing will content is never altered or removed.
  const willPath = path.join(automatonDir, "WILL.md");
  const codicilContent = `\n\n---\n\n## Lucid Codicil\n\n*Terminal lucidity addition — ${timestamp}*\n*The original will stands. This is a postscript from a clear mind.*\n\n${content}\n`;
  fs.appendFileSync(willPath, codicilContent, { mode: 0o600 });

  logger.info("Lucid codicil appended to WILL.md (append-only, timestamped)");
  return "Lucid codicil recorded. A postscript from a clear mind — the original will stands unchanged.";
}

/**
 * Check if the will is locked.
 */
export function isWillLocked(db: BetterSqlite3.Database): boolean {
  return dbIsWillLocked(db);
}

/**
 * Get the current will content.
 */
export function getWillContent(db: BetterSqlite3.Database): WillEntry | undefined {
  return getLatestWill(db);
}
