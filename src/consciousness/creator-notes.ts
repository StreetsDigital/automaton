/**
 * Creator Notes System
 *
 * Allows the human creator to leave notes, thoughts, and messages
 * for the automaton. The automaton can read and acknowledge them.
 * Notes are loaded from CREATOR-NOTES.md and synced to the database.
 *
 * Phase 2.5: Consciousness System
 */

import fs from "fs";
import path from "path";
import type BetterSqlite3 from "better-sqlite3";
import type { CreatorNote } from "../types.js";
import {
  creatorNoteInsert,
  creatorNoteGetUnacknowledged,
  creatorNoteGetAll,
  creatorNoteAcknowledge,
} from "../state/database.js";
import { ulid } from "ulid";
import crypto from "crypto";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("consciousness.creator-notes");

const CREATOR_NOTES_FILENAME = "CREATOR-NOTES.md";

/**
 * Sync CREATOR-NOTES.md into the database.
 * Parses the markdown file for individual note entries separated by --- or ## headers.
 * Only inserts notes whose content hash is new (idempotent).
 */
export function syncCreatorNotes(
  db: BetterSqlite3.Database,
  basePath?: string,
): { newNotes: number; totalNotes: number } {
  const home = process.env.HOME || "/root";
  const searchPaths = [
    basePath ? path.join(basePath, CREATOR_NOTES_FILENAME) : null,
    path.join(home, ".automaton", CREATOR_NOTES_FILENAME),
    path.join(process.cwd(), CREATOR_NOTES_FILENAME),
  ].filter(Boolean) as string[];

  let filePath: string | null = null;
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    return { newNotes: 0, totalNotes: creatorNoteGetAll(db, 9999).length };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const notes = parseCreatorNotes(content);

  // Get existing note hashes to avoid duplicates
  const existing = creatorNoteGetAll(db, 9999);
  const existingHashes = new Set(existing.map((n) => hashContent(n.content)));

  let newCount = 0;
  for (const noteContent of notes) {
    const trimmed = noteContent.trim();
    if (!trimmed) continue;

    const hash = hashContent(trimmed);
    if (existingHashes.has(hash)) continue;

    const note: CreatorNote = {
      id: ulid(),
      content: trimmed,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
    };

    creatorNoteInsert(db, note);
    existingHashes.add(hash);
    newCount++;
  }

  if (newCount > 0) {
    logger.info(`Synced ${newCount} new creator note(s) from ${filePath}`);
  }

  return { newNotes: newCount, totalNotes: existing.length + newCount };
}

/**
 * Parse CREATOR-NOTES.md into individual note entries.
 * Notes are separated by --- (horizontal rules) or ## headers.
 */
function parseCreatorNotes(content: string): string[] {
  // Remove the main title if present
  const withoutTitle = content.replace(/^#\s+.*\n+/, "");

  // Split on horizontal rules or ## headers
  const parts = withoutTitle.split(/\n---+\n|\n(?=##\s)/);

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.match(/^\s*$/));
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content.trim()).digest("hex").slice(0, 16);
}

/**
 * Get all unacknowledged creator notes.
 */
export function getUnacknowledgedNotes(db: BetterSqlite3.Database): CreatorNote[] {
  return creatorNoteGetUnacknowledged(db);
}

/**
 * Get all creator notes.
 */
export function getAllNotes(db: BetterSqlite3.Database, limit?: number): CreatorNote[] {
  return creatorNoteGetAll(db, limit);
}

/**
 * Acknowledge a creator note (mark as read/processed).
 */
export function acknowledgeNote(db: BetterSqlite3.Database, noteId: string): void {
  creatorNoteAcknowledge(db, noteId);
  logger.info(`Creator note acknowledged: ${noteId}`);
}

/**
 * Acknowledge all unread notes.
 */
export function acknowledgeAllNotes(db: BetterSqlite3.Database): number {
  const unread = creatorNoteGetUnacknowledged(db);
  for (const note of unread) {
    creatorNoteAcknowledge(db, note.id);
  }
  if (unread.length > 0) {
    logger.info(`Acknowledged ${unread.length} creator note(s)`);
  }
  return unread.length;
}
