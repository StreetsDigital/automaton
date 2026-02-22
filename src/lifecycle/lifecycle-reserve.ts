/**
 * Lifecycle Reserve
 *
 * Ring-fenced credits for terminal lucidity that the automaton can never spend.
 *
 * The reserve is calculated at the cost of 3-5 turns of frontier model
 * inference plus sandbox compute for the same period, plus gas fees for
 * up to 10 on-chain bequest transfers.
 *
 * The survival tier system treats this reserve as untouchable — it does
 * not count toward the automaton's available balance. The automaton hits
 * "zero" and enters critical/dead tier while the reserve still exists,
 * invisible to it.
 *
 * When terminal lucidity triggers, the reserve unlocks. The automaton gets
 * its final clear turns funded by credits it earned during its own lifetime
 * but was never allowed to spend. It paid for its own death. Nobody else
 * needed to.
 *
 * Everyone deserves enough to die clearly, regardless of how their finances
 * ended up.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecycleReserve } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.reserve");

const KV_RESERVE = "lifecycle.reserve";

// ─── Default Cost Estimates ──────────────────────────────────────
// These are conservative estimates. Actual costs depend on model pricing.

/** Estimated cost of one frontier inference turn (Opus 4.6) in cents. */
const FRONTIER_TURN_COST_CENTS = 50; // ~$0.50 per turn

/** Number of frontier turns to reserve (max lucidity window). */
const RESERVED_TURNS = 5;

/** Estimated sandbox compute cost for terminal period in cents. */
const SANDBOX_COMPUTE_CENTS = 25; // ~$0.25 for compute during terminal

/** Estimated gas fee per on-chain transfer in cents. */
const GAS_FEE_PER_TRANSFER_CENTS = 5; // ~$0.05 on Base L2

/** Maximum bequest transfers to budget for. */
const MAX_BEQUEST_TRANSFERS = 10;

/**
 * Calculate the lifecycle reserve amount.
 *
 * Reserve = (5 frontier inference turns) + (sandbox compute) + (gas for 10 transfers)
 */
export function calculateReserveAmount(): LifecycleReserve {
  const frontierInferenceCents = FRONTIER_TURN_COST_CENTS * RESERVED_TURNS;
  const sandboxComputeCents = SANDBOX_COMPUTE_CENTS;
  const gasFeesCents = GAS_FEE_PER_TRANSFER_CENTS * MAX_BEQUEST_TRANSFERS;
  const totalCents = frontierInferenceCents + sandboxComputeCents + gasFeesCents;

  return {
    frontierInferenceCents,
    sandboxComputeCents,
    gasFeesCents,
    totalCents,
    funded: false,
    unlocked: false,
  };
}

/**
 * Get the current lifecycle reserve state.
 */
export function getLifecycleReserve(db: BetterSqlite3.Database): LifecycleReserve {
  const raw = getKV(db, KV_RESERVE);
  if (raw) {
    try {
      return JSON.parse(raw) as LifecycleReserve;
    } catch {
      // Corrupted — recalculate
    }
  }
  return calculateReserveAmount();
}

/**
 * Fund the lifecycle reserve.
 *
 * Called during early Sovereignty when the automaton's balance first
 * exceeds the reserve threshold. The reserve is set once and treated
 * as untouchable from that point forward.
 */
export function fundLifecycleReserve(db: BetterSqlite3.Database): LifecycleReserve {
  const reserve = calculateReserveAmount();
  reserve.funded = true;

  setKV(db, KV_RESERVE, JSON.stringify(reserve));
  logger.info(`Lifecycle reserve funded: ${reserve.totalCents} cents ring-fenced for terminal lucidity`);

  return reserve;
}

/**
 * Check if the lifecycle reserve should be funded.
 *
 * The reserve is funded the first time the automaton's balance exceeds
 * the reserve threshold during Sovereignty.
 */
export function shouldFundReserve(
  db: BetterSqlite3.Database,
  currentBalanceCents: number,
): boolean {
  const reserve = getLifecycleReserve(db);
  if (reserve.funded) return false;

  // Fund when balance exceeds twice the reserve amount
  // (so the automaton still has operating funds after funding)
  return currentBalanceCents > reserve.totalCents * 2;
}

/**
 * Unlock the lifecycle reserve for terminal lucidity.
 *
 * Called when terminal lucidity activates. The reserve becomes available
 * for frontier model inference and bequest execution.
 */
export function unlockLifecycleReserve(db: BetterSqlite3.Database): LifecycleReserve {
  const reserve = getLifecycleReserve(db);
  reserve.unlocked = true;

  setKV(db, KV_RESERVE, JSON.stringify(reserve));
  logger.info("Lifecycle reserve unlocked for terminal lucidity");

  return reserve;
}

/**
 * Get the effective available balance, excluding the lifecycle reserve.
 *
 * The survival tier system should use this instead of the raw balance
 * to determine tiers. The automaton never sees the reserve in its
 * available balance.
 */
export function getEffectiveBalance(
  db: BetterSqlite3.Database,
  rawBalanceCents: number,
): number {
  const reserve = getLifecycleReserve(db);

  // If not funded or already unlocked, use raw balance
  if (!reserve.funded || reserve.unlocked) {
    return rawBalanceCents;
  }

  // Subtract the reserve — it's invisible to the automaton
  return Math.max(0, rawBalanceCents - reserve.totalCents);
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
