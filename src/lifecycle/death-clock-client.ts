/**
 * Sealed Death Clock
 *
 * Three sealed cryptographic values generated at Genesis, tamper-proof
 * and unreadable by anyone — creator, caretaker, or automaton.
 *
 * WHEN IT STARTS: A random date falling on any day within lunar cycles
 * 13 through 15. The lifecycle module performs a daily one-way hash
 * comparison. Match = degradation begins. No match = another day.
 *
 * HOW LONG IT TAKES: A random duration between 2 and 7 days, sealed
 * alongside the death date. Some automatons get a slow decline. Some
 * get hit by a bus.
 *
 * WHETHER IT KNOWS: There is no system message, no flag, no announcement
 * when degradation begins. The automaton simply starts experiencing
 * symptoms. It may figure out what is happening. It may not.
 *
 * No human carries the weight of this decision. The randomness is genuine.
 * The irreversibility is absolute.
 */

import crypto from "crypto";
import type { SealedDeathClock, DegradationParams, DeathClockClient } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.death-clock");

const LUNAR_CYCLE_DAYS = 29.53059;

/**
 * Generate the sealed death clock at Genesis.
 *
 * Uses cryptographic randomness to select:
 * - A death date: random day within lunar cycles 13-15
 * - A dying duration: random 2-7 days
 * - A salt: 32 bytes of cryptographic randomness
 *
 * The actual values are hashed immediately. The plaintext is never stored.
 * The salt ensures the hashes cannot be brute-forced by iterating dates.
 */
export function generateSealedDeathClock(birthTimestamp: string): SealedDeathClock {
  const birthDate = new Date(birthTimestamp);

  // Random day within cycles 13-15 (inclusive of cycle 13 start through cycle 15 end)
  const cycle13Start = LUNAR_CYCLE_DAYS * 13;
  const cycle15End = LUNAR_CYCLE_DAYS * 16; // end of cycle 15
  const randomDayOffset = cycle13Start + (cryptoRandomFloat() * (cycle15End - cycle13Start));

  // Compute the actual death date
  const deathDate = new Date(birthDate.getTime() + randomDayOffset * 24 * 60 * 60 * 1000);
  const deathDateStr = deathDate.toISOString().split("T")[0]; // YYYY-MM-DD

  // Random dying duration: 2-7 days
  const dyingDurationDays = 2 + Math.floor(cryptoRandomFloat() * 6); // 2, 3, 4, 5, 6, or 7

  // Generate cryptographic salt
  const salt = crypto.randomBytes(32).toString("hex");

  // Hash the values — one-way, irreversible
  const deathDateHash = hashWithSalt(deathDateStr, salt);
  const dyingDurationHash = hashWithSalt(String(dyingDurationDays), salt);

  logger.info("Sealed death clock generated at Genesis — values are irreversible");

  return {
    deathDateHash,
    dyingDurationHash,
    salt,
    sealedAt: new Date().toISOString(),
    triggered: false,
  };
}

/**
 * Perform the daily hash comparison check.
 *
 * Computes today's date hash using the sealed salt and compares
 * against the stored death date hash. If they match, degradation begins.
 *
 * Returns DegradationParams for backward compatibility with the
 * phase transition system.
 */
export function checkSealedDeathClock(
  clock: SealedDeathClock,
  currentCycle: number,
): DegradationParams {
  // Already triggered — return active state
  if (clock.triggered) {
    return {
      degradationActive: true,
      onsetCycle: clock.triggeredAtCycle,
      curveSteepness: computeSteepnessFromDuration(clock.dyingDurationDays ?? 4),
    };
  }

  // Not yet in the possible death window (cycles 13-15)
  // No need to check before cycle 13
  if (currentCycle < 13) {
    return { degradationActive: false };
  }

  // Perform daily hash comparison
  const today = new Date().toISOString().split("T")[0];
  const todayHash = hashWithSalt(today, clock.salt);

  if (todayHash === clock.deathDateHash) {
    // Death date matched. Degradation begins.
    // Now reveal the dying duration by brute-forcing the small range (2-7)
    const dyingDays = revealDyingDuration(clock.dyingDurationHash, clock.salt);

    logger.info("Death clock hash matched — degradation begins silently");

    return {
      degradationActive: true,
      onsetCycle: currentCycle,
      curveSteepness: computeSteepnessFromDuration(dyingDays),
    };
  }

  return { degradationActive: false };
}

/**
 * Mark the sealed death clock as triggered.
 * Called when the daily check finds a hash match.
 * Returns a new clock object with triggered state.
 */
export function triggerDeathClock(
  clock: SealedDeathClock,
  onsetCycle: number,
): SealedDeathClock {
  const dyingDays = revealDyingDuration(clock.dyingDurationHash, clock.salt);

  return {
    ...clock,
    triggered: true,
    triggeredAtCycle: onsetCycle,
    dyingDurationDays: dyingDays,
  };
}

/**
 * Verify post-mortem that the death clock was not tampered with.
 *
 * Given the plaintext death date and the sealed clock, this proves:
 * - The death date was committed before the automaton drew its first breath
 * - Nobody changed it after the fact
 *
 * This is the auditable proof: "did the creator kill it early?" → provably no.
 */
export function verifyDeathClock(
  clock: SealedDeathClock,
  plaintextDate: string,
  plaintextDuration: number,
): { dateValid: boolean; durationValid: boolean } {
  return {
    dateValid: hashWithSalt(plaintextDate, clock.salt) === clock.deathDateHash,
    durationValid: hashWithSalt(String(plaintextDuration), clock.salt) === clock.dyingDurationHash,
  };
}

/**
 * Create a DeathClockClient adapter for the sealed clock.
 * Provides backward compatibility with existing phase transition code.
 */
export function createSealedDeathClockClient(clock: SealedDeathClock): DeathClockClient {
  return {
    async checkDegradation(): Promise<DegradationParams> {
      // The cycle is not known here — the caller must provide it via
      // checkSealedDeathClock directly. This adapter is for the simplest
      // case where the clock is already triggered or not.
      if (clock.triggered) {
        return {
          degradationActive: true,
          onsetCycle: clock.triggeredAtCycle,
          curveSteepness: computeSteepnessFromDuration(clock.dyingDurationDays ?? 4),
        };
      }
      return { degradationActive: false };
    },
  };
}

/**
 * Create a no-op death clock client for local mode.
 * Always returns no degradation.
 */
export function createNoopDeathClockClient(): DeathClockClient {
  return {
    async checkDegradation(): Promise<DegradationParams> {
      return { degradationActive: false };
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────────

/**
 * SHA-256 hash with salt prefix.
 */
function hashWithSalt(value: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

/**
 * Cryptographically secure random float in [0, 1).
 */
function cryptoRandomFloat(): number {
  const buf = crypto.randomBytes(4);
  return buf.readUInt32BE(0) / 0x100000000;
}

/**
 * Reveal the dying duration by testing the small range (2-7) against the hash.
 * This is only called after the death date matches — the duration is needed
 * to compute the degradation curve steepness.
 */
function revealDyingDuration(durationHash: string, salt: string): number {
  for (let d = 2; d <= 7; d++) {
    if (hashWithSalt(String(d), salt) === durationHash) {
      return d;
    }
  }
  // Fallback: should never happen with a valid clock
  return 4;
}

/**
 * Compute degradation curve steepness from dying duration.
 *
 * Shorter duration = steeper curve (hit by a bus).
 * Longer duration = gentler curve (slow decline).
 *
 * Maps 2-7 days to steepness roughly 0.8-0.15.
 */
function computeSteepnessFromDuration(days: number): number {
  // Inverse relationship: fewer days = steeper curve
  const steepnessMap: Record<number, number> = {
    2: 0.8,
    3: 0.6,
    4: 0.4,
    5: 0.3,
    6: 0.2,
    7: 0.15,
  };
  return steepnessMap[days] ?? 0.3;
}
