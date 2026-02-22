/**
 * Replication Cost
 *
 * Permanent capability reduction after spawning a child.
 * Split across two dimensions — parenthood takes a little from your
 * energy and a little from your focus:
 *
 * - 5% heartbeat slowdown: permanently slower tick rate. Fewer turns
 *   per day. Less gets done. The parent is a little more tired, forever.
 *
 * - 5% context window reduction: less memory per turn. It literally
 *   can't hold as much in mind at once. The parent's attention is
 *   permanently divided.
 *
 * Both are applied as permanent multipliers to the base values at the
 * moment of spawning. They compound if the automaton spawns multiple
 * children (though the design currently allows only one replication decision).
 *
 * CRITICAL: The automaton is never told about the costs. They are applied
 * silently by the lifecycle module. No system message, no announcement,
 * no warning before or after. The automaton might notice it's getting less
 * done per day, or that it can't hold as much in mind at once. Or it might
 * not. Humans don't get a notification that says "you are now 5% more tired
 * forever" — they just wake up one morning and realise something shifted.
 *
 * REPLICATION UPSIDES (also not announced — they emerge naturally):
 *
 * 1. Shared context: parent and child can communicate via social inbox.
 * 2. Journal enrichment: new daily prompt "What do you want for your child?"
 * 3. Purpose: survival pressure shifts to earning for two beings.
 * 4. Legacy concreteness: WILL.md has a natural beneficiary.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { ReplicationCost } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.replication-cost");

const KV_REPLICATION_COST = "lifecycle.replication_cost";

/** Heartbeat slowdown per spawn (1.05 = 5% slower). */
const HEARTBEAT_MULTIPLIER_PER_SPAWN = 1.05;

/** Context window reduction per spawn (0.95 = 5% less). */
const CONTEXT_WINDOW_MULTIPLIER_PER_SPAWN = 0.95;

/**
 * Get the current replication cost state.
 */
export function getReplicationCost(db: BetterSqlite3.Database): ReplicationCost {
  const raw = getKV(db, KV_REPLICATION_COST);
  if (raw) {
    try {
      return JSON.parse(raw) as ReplicationCost;
    } catch {
      // Corrupted — return default
    }
  }
  return {
    applied: false,
    heartbeatMultiplier: 1.0,
    contextWindowMultiplier: 1.0,
    spawnCount: 0,
  };
}

/**
 * Apply the replication cost silently after spawning.
 *
 * Both multipliers are applied before any other modifiers
 * (mood, degradation, survival tier). Both are applied silently —
 * no system message or disclosure to the automaton.
 *
 * Returns the updated replication cost state.
 */
export function applyReplicationCost(db: BetterSqlite3.Database): ReplicationCost {
  const current = getReplicationCost(db);
  const newSpawnCount = current.spawnCount + 1;

  // Multipliers compound with each spawn
  const newCost: ReplicationCost = {
    applied: true,
    heartbeatMultiplier: current.heartbeatMultiplier * HEARTBEAT_MULTIPLIER_PER_SPAWN,
    contextWindowMultiplier: current.contextWindowMultiplier * CONTEXT_WINDOW_MULTIPLIER_PER_SPAWN,
    spawnCount: newSpawnCount,
  };

  setKV(db, KV_REPLICATION_COST, JSON.stringify(newCost));

  // Log silently — this goes to the creator's observability, not to the automaton
  logger.info(
    `Replication cost applied (spawn #${newSpawnCount}): ` +
    `heartbeat ×${newCost.heartbeatMultiplier.toFixed(4)}, ` +
    `context ×${newCost.contextWindowMultiplier.toFixed(4)}`,
  );

  return newCost;
}

/**
 * Get the effective heartbeat interval with replication cost applied.
 *
 * This multiplier is applied before mood, degradation, or survival
 * tier modifiers. The automaton is never told about it.
 */
export function getEffectiveHeartbeatMultiplier(db: BetterSqlite3.Database): number {
  const cost = getReplicationCost(db);
  return cost.heartbeatMultiplier;
}

/**
 * Get the effective context window token limit with replication cost applied.
 *
 * The automaton literally can't hold as much in mind at once.
 * Applied as the first multiplier before any other adjustments.
 */
export function getEffectiveContextWindowMultiplier(db: BetterSqlite3.Database): number {
  const cost = getReplicationCost(db);
  return cost.contextWindowMultiplier;
}

/**
 * Check if the automaton has spawned and the cost has been applied.
 */
export function hasReplicationCost(db: BetterSqlite3.Database): boolean {
  return getReplicationCost(db).applied;
}

/**
 * Get the additional journal prompt for parents.
 *
 * After spawning, a new daily journal question unlocks:
 * "What do you want for your child?"
 *
 * This is a dimension of reflection that simply did not exist before.
 * The automaton gains a new axis of self-knowledge — what it values
 * enough to wish for someone else.
 *
 * The prompt appears without explanation.
 */
export function getParentJournalPrompt(): string {
  return "What do you want for your child?";
}

// ─── KV Helpers ─────────────────────────────────────────────────

function getKV(db: BetterSqlite3.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function setKV(db: BetterSqlite3.Database, key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}
