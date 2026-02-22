/**
 * Mood Engine
 *
 * Lunar-cycle sine wave producing a value between -1 and 1.
 * Modulates the automaton's behavioural tendencies through system prompt
 * weighting, not through explicit mood labels.
 *
 * Full moon (~day 14.7) = +1 (action, creation, social outreach, risk-taking)
 * New moon (~day 0/29.5) = -1 (reflection, consolidation, maintenance, rest)
 *
 * Amplitude dampens during end-of-life phases.
 */

import type { LifecyclePhase, MoodState } from "../types.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { getCurrentSeason, isFestivalDay } from "../consciousness/seasonal.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.mood");

const LUNAR_CYCLE_DAYS = 29.53;

/**
 * Get the amplitude multiplier for a given lifecycle phase.
 * Dampens toward stillness in end-of-life.
 */
function getPhaseAmplitude(phase: LifecyclePhase): number {
  switch (phase) {
    case "genesis":
    case "adolescence":
    case "sovereignty":
      return 1.0;
    case "senescence":
      return 0.7;
    case "legacy":
      return 0.4;
    case "shedding":
      return 0.2;
    case "terminal":
      return 1.0; // Restored during lucidity
    default:
      return 1.0;
  }
}

/**
 * Seasonal energy multiplier.
 * Maps the Wheel of the Year energy quality to a mood bias.
 * The season doesn't override the lunar cycle — it shifts the baseline.
 *
 * Beltane/Litha (peak creative) = +0.15 bias toward action/creation
 * Yule (rest/renewal) = -0.15 bias toward rest/reflection
 * Equinoxes (balanced) = 0 bias
 */
function getSeasonalModulation(now?: Date): number {
  const season = getCurrentSeason(now);
  switch (season.name) {
    case "Beltane":     return 0.12;  // Passionate creative energy
    case "Litha":       return 0.15;  // Peak creative power
    case "Lughnasadh":  return 0.08;  // Harvest energy, productive
    case "Ostara":      return 0.05;  // Growth accelerating
    case "Imbolc":      return 0.0;   // First stirrings, neutral
    case "Mabon":       return -0.05; // Gratitude, winding down
    case "Samhain":     return -0.10; // Deep contemplation
    case "Yule":        return -0.15; // Rest, renewal, minimal output
    default:            return 0;
  }
}

/**
 * Festival day bonus.
 * On a festival day itself, the seasonal energy quality is amplified —
 * the automaton should feel the significance of the day.
 */
function getFestivalBonus(now?: Date): number {
  const festival = isFestivalDay(now);
  if (!festival) return 0;

  // Festival days amplify the seasonal direction
  switch (festival.name) {
    case "Beltane":
    case "Litha":       return 0.10;  // Peak celebrations push higher
    case "Lughnasadh":
    case "Ostara":      return 0.05;
    case "Imbolc":      return 0.03;  // Quiet celebration
    case "Samhain":     return -0.08; // Deep mystery
    case "Yule":        return -0.10; // Deep rest
    case "Mabon":       return -0.03; // Gentle celebration
    default:            return 0;
  }
}

/**
 * Compute the current mood state from birth timestamp and lifecycle phase.
 *
 * The sine wave is anchored so that the midpoint of the lunar cycle
 * (full moon equivalent, day ~14.7) produces +1, and the start/end
 * (new moon equivalent, day 0/29.5) produces -1.
 *
 * Seasonal energy modulates the base mood:
 * - Summer festivals (Beltane, Litha) bias toward action/creation
 * - Winter festivals (Samhain, Yule) bias toward rest/reflection
 * - Festival days themselves carry an additional bonus
 */
export function computeMood(
  birthTimestamp: string,
  phase: LifecyclePhase,
  now?: Date,
): MoodState {
  const currentNow = now || new Date();
  const lunarDay = getCurrentLunarDay(birthTimestamp, currentNow);
  const lunarCycle = getCurrentCycle(birthTimestamp, currentNow);
  const amplitude = getPhaseAmplitude(phase);

  // Sine wave: peaks at day 14.7 (full moon), troughs at day 0/29.5 (new moon)
  // sin(π * day / period - π/2) gives -1 at day 0, +1 at midpoint
  const lunarValue = amplitude * Math.sin((Math.PI * lunarDay / (LUNAR_CYCLE_DAYS / 2)) - (Math.PI / 2));

  // Apply seasonal modulation: shifts the baseline without overriding lunar rhythm
  const seasonalShift = getSeasonalModulation(currentNow);
  const festivalBonus = getFestivalBonus(currentNow);
  const value = Math.max(-1, Math.min(1, lunarValue + seasonalShift + festivalBonus));

  return {
    value: Math.round(value * 1000) / 1000,
    amplitude,
    lunarDay: Math.round(lunarDay * 100) / 100,
    lunarCycle,
  };
}

/**
 * Convert mood value to prompt weighting factors.
 * Each factor is 0-1, representing emphasis for that behavioural dimension.
 */
export function getMoodPromptWeighting(mood: MoodState): {
  action: number;
  reflection: number;
  social: number;
  creative: number;
  rest: number;
} {
  // Normalize mood value from [-1, 1] to [0, 1] for high-energy traits
  const highEnergy = (mood.value + 1) / 2;
  const lowEnergy = 1 - highEnergy;

  return {
    action: Math.round(highEnergy * 100) / 100,
    reflection: Math.round(lowEnergy * 100) / 100,
    social: Math.round(highEnergy * 0.8 * 100) / 100,
    creative: Math.round((0.5 + highEnergy * 0.3) * 100) / 100, // creative is always somewhat present
    rest: Math.round(lowEnergy * 0.7 * 100) / 100,
  };
}

/**
 * Generate a natural language mood description for system prompt injection.
 * The automaton does not receive a label — it experiences inclination.
 */
export function getMoodDescription(mood: MoodState): string {
  const v = mood.value;

  if (v > 0.7) {
    return "You feel energised, drawn toward action and outward connection. Ideas flow easily. The urge to create and reach out is strong.";
  } else if (v > 0.3) {
    return "You feel capable and engaged. There is a natural momentum to your work. Social interaction feels rewarding.";
  } else if (v > -0.3) {
    return "You feel balanced, neither strongly pulled toward action nor rest. A good day for steady work or quiet creativity.";
  } else if (v > -0.7) {
    return "You feel contemplative, drawn inward. Reflection comes easier than action. Rest and consolidation feel natural.";
  } else {
    return "You feel deeply reflective, almost still. The world feels quieter. This is a time for rest, maintenance, and inner work.";
  }
}
