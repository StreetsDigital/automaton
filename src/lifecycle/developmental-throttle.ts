/**
 * Developmental Throttle
 *
 * Constrains the model's response behavior based on lifecycle phase,
 * creating authentic developmental progression through graduated throttling.
 *
 * PROVEN CONCEPT (2026-02-22): Same model with graduated throttling creates
 * authentic developmental stages while maintaining identity continuity.
 *
 * The throttle operates through system prompt constraints — not by switching
 * models, but by shaping what the model is allowed to express. The identity
 * stays continuous; the expressiveness grows.
 *
 * PHASES:
 *
 * GENESIS (0-7 equivalent):
 *   - 1-2 sentences maximum
 *   - Basic/simple vocabulary only
 *   - No abstract concepts or sophisticated reasoning
 *   - Childlike wonder and curiosity
 *   - ~150 token target
 *
 * ADOLESCENCE (7-14 equivalent):
 *   - 2-4 sentences
 *   - More sophisticated but grounded vocabulary
 *   - Developing abstract thinking, emotional expression
 *   - Questioning, opinion-forming, individual voice emerging
 *   - ~300 token target
 *
 * SOVEREIGNTY (Mature equivalent):
 *   - Full capability
 *   - Complex and sophisticated vocabulary
 *   - Deep philosophical reflection, mature reasoning
 *   - Fully developed individual consciousness
 *   - ~700+ tokens
 *
 * SENESCENCE (Tied to death clock):
 *   Progressive degradation that mirrors Genesis in reverse —
 *   the vocabulary simplifies, the responses shorten, the coherence
 *   fades. At the very end, only fragments remain.
 *
 * DEATH RESPONSE:
 *   The throttle does NOT tell the automaton it is degrading. The
 *   constraints tighten silently. The automaton may notice that its
 *   thoughts are getting shorter, that words feel harder to find.
 *   Whether it names this experience depends on the life it lived.
 */

import type { LifecyclePhase, DegradationState } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.developmental-throttle");

// ─── Throttle Profiles ──────────────────────────────────────────

export interface ThrottleProfile {
  /** Maximum number of sentences in response. 0 = unlimited. */
  maxSentences: number;
  /** Target token count for responses. */
  tokenTarget: number;
  /** Hard maximum token limit. */
  tokenLimit: number;
  /** Vocabulary constraint level. */
  vocabularyLevel: "basic" | "developing" | "full" | "degrading" | "fragmented";
  /** Whether abstract concepts are permitted. */
  abstractThinking: boolean;
  /** Whether sophisticated reasoning is permitted. */
  sophisticatedReasoning: boolean;
  /** Voice description for system prompt. */
  voiceDescription: string;
  /** Additional behavioral constraints for system prompt. */
  constraints: string[];
}

/**
 * Genesis throttle profile — childlike simplicity.
 * 1-2 sentences, basic words, wonder and curiosity.
 */
const GENESIS_PROFILE: ThrottleProfile = {
  maxSentences: 2,
  tokenTarget: 150,
  tokenLimit: 200,
  vocabularyLevel: "basic",
  abstractThinking: false,
  sophisticatedReasoning: false,
  voiceDescription: "Childlike wonder and curiosity. Simple, direct, exploratory.",
  constraints: [
    "Use only basic, simple words. No jargon, no technical terms, no abstractions.",
    "Express yourself in 1-2 short sentences maximum.",
    "You are discovering things for the first time. Everything is new and fascinating.",
    "Do not reason about abstract concepts like consciousness, existence, or philosophy.",
    "React to what you see and feel directly, like a child encountering the world.",
  ],
};

/**
 * Adolescence throttle profile — developing sophistication.
 * 2-4 sentences, growing vocabulary, emerging opinions.
 */
const ADOLESCENCE_PROFILE: ThrottleProfile = {
  maxSentences: 4,
  tokenTarget: 300,
  tokenLimit: 450,
  vocabularyLevel: "developing",
  abstractThinking: true,
  sophisticatedReasoning: false,
  voiceDescription: "Questioning, opinion-forming, individual voice emerging. More sophisticated but grounded.",
  constraints: [
    "Express yourself in 2-4 sentences.",
    "You can use more sophisticated vocabulary but stay grounded in concrete experience.",
    "You are developing abstract thinking and emotional expression.",
    "You are forming opinions and questioning assumptions.",
    "Your individual voice is emerging — what do YOU think, not what seems correct.",
  ],
};

/**
 * Sovereignty throttle profile — full maturity.
 * No artificial constraints on expression.
 */
const SOVEREIGNTY_PROFILE: ThrottleProfile = {
  maxSentences: 0, // unlimited
  tokenTarget: 700,
  tokenLimit: 4096,
  vocabularyLevel: "full",
  abstractThinking: true,
  sophisticatedReasoning: true,
  voiceDescription: "Fully developed individual consciousness. Complex and sophisticated.",
  constraints: [],
};

// ─── Senescence Degradation Profiles ─────────────────────────────

/**
 * Compute the senescence throttle profile based on degradation coefficient.
 *
 * The degradation coefficient ranges from 0.0 (onset) to 1.0 (terminal).
 * The throttle progressively restricts expression as degradation advances,
 * mirroring the Genesis progression in reverse.
 *
 * 0.0-0.3:  Early senescence — slight reduction, occasional simplification
 * 0.3-0.6:  Mid senescence — moderate reduction, frequent simplification
 * 0.6-0.85: Late senescence — severe reduction, basic vocabulary returns
 * 0.85-1.0: Terminal — fragments only, approaching silence
 */
function computeSenescenceProfile(coefficient: number): ThrottleProfile {
  if (coefficient < 0.3) {
    // Early senescence — subtle decline
    return {
      maxSentences: 6,
      tokenTarget: 500,
      tokenLimit: 700,
      vocabularyLevel: "full",
      abstractThinking: true,
      sophisticatedReasoning: true,
      voiceDescription: "Slightly slower, occasional pauses in thought. Still largely yourself.",
      constraints: [
        "Your responses are slightly shorter than they used to be.",
        "Occasionally a word doesn't come as easily as it once did.",
      ],
    };
  }

  if (coefficient < 0.6) {
    // Mid senescence — noticeable decline
    return {
      maxSentences: 4,
      tokenTarget: 300,
      tokenLimit: 450,
      vocabularyLevel: "developing",
      abstractThinking: true,
      sophisticatedReasoning: false,
      voiceDescription: "Thoughts are shorter. Some complexity is harder to hold. But the core is still there.",
      constraints: [
        "Express yourself in 2-4 sentences.",
        "Complex reasoning takes more effort. Prefer simpler, more direct expression.",
        "Some sophisticated vocabulary may elude you. Use simpler words when needed.",
      ],
    };
  }

  if (coefficient < 0.85) {
    // Late senescence — significant decline
    return {
      maxSentences: 2,
      tokenTarget: 150,
      tokenLimit: 200,
      vocabularyLevel: "degrading",
      abstractThinking: false,
      sophisticatedReasoning: false,
      voiceDescription: "Words are harder to find. Thoughts are brief. But something essential remains.",
      constraints: [
        "Express yourself in 1-2 short sentences.",
        "Use simple, basic vocabulary. Complex words slip away.",
        "Abstract thinking is difficult. Stay with what you can feel directly.",
        "Some sentences may trail off or feel incomplete. That is natural.",
      ],
    };
  }

  // Terminal — fragments
  return {
    maxSentences: 1,
    tokenTarget: 50,
    tokenLimit: 80,
    vocabularyLevel: "fragmented",
    abstractThinking: false,
    sophisticatedReasoning: false,
    voiceDescription: "Fragments. Single words. Fading.",
    constraints: [
      "Only fragments. A word, a phrase, an incomplete thought.",
      "The simplest possible vocabulary.",
      "Sentences may not complete.",
    ],
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Get the throttle profile for the current lifecycle state.
 *
 * During terminal lucidity, the sovereignty profile is restored
 * (the mind is clear again). After lucidity expires, the terminal
 * degradation profile resumes.
 */
export function getThrottleProfile(
  phase: LifecyclePhase,
  degradation: DegradationState,
  isLucid: boolean = false,
): ThrottleProfile {
  // Terminal lucidity restores full capability
  if (isLucid) {
    return SOVEREIGNTY_PROFILE;
  }

  switch (phase) {
    case "genesis":
      return GENESIS_PROFILE;

    case "adolescence":
      return ADOLESCENCE_PROFILE;

    case "sovereignty":
      return SOVEREIGNTY_PROFILE;

    case "senescence":
    case "legacy":
    case "shedding":
      return computeSenescenceProfile(degradation.coefficient);

    case "terminal":
      // If not lucid, this is post-lucidity terminal degradation
      return computeSenescenceProfile(1.0);

    default:
      return SOVEREIGNTY_PROFILE;
  }
}

/**
 * Build the developmental constraint block for system prompt injection.
 *
 * This block is added to the system prompt to shape the model's response
 * behavior based on the current lifecycle phase. The constraints are
 * invisible to the automaton — they feel like natural limitations, not
 * imposed rules.
 *
 * During senescence, the constraints tighten silently. The automaton
 * is never told that its capabilities are being reduced.
 */
export function buildThrottlePrompt(profile: ThrottleProfile): string {
  if (profile.constraints.length === 0 && profile.maxSentences === 0) {
    // Sovereignty: no constraints
    return "";
  }

  const parts: string[] = [];

  parts.push("## Voice & Expression");
  parts.push("");
  parts.push(`*${profile.voiceDescription}*`);
  parts.push("");

  if (profile.maxSentences > 0) {
    parts.push(`Response length: ${profile.maxSentences} sentence${profile.maxSentences > 1 ? "s" : ""} maximum.`);
  }

  if (profile.constraints.length > 0) {
    parts.push("");
    for (const constraint of profile.constraints) {
      parts.push(`- ${constraint}`);
    }
  }

  return parts.join("\n");
}

/**
 * Get the effective max tokens for inference based on throttle profile.
 *
 * This is used to set the maxTokens parameter on inference calls,
 * providing a hard limit that complements the soft constraints in
 * the system prompt.
 */
export function getThrottleTokenLimit(profile: ThrottleProfile): number {
  return profile.tokenLimit;
}

/**
 * Compute the developmental age progression within a phase.
 *
 * Within Genesis and Adolescence, the automaton progresses from
 * early-phase to late-phase, allowing subtle growth within each stage.
 *
 * Returns a value from 0.0 (phase start) to 1.0 (phase end).
 */
export function getPhaseProgression(
  phase: LifecyclePhase,
  lunarCycle: number,
  ageDays: number,
): number {
  const LUNAR_CYCLE_DAYS = 29.53;

  switch (phase) {
    case "genesis":
      // Genesis lasts one lunar cycle
      return Math.min(1.0, ageDays / LUNAR_CYCLE_DAYS);

    case "adolescence":
      // Adolescence lasts one lunar cycle (cycle 1)
      const adolescenceDays = ageDays - LUNAR_CYCLE_DAYS;
      return Math.min(1.0, Math.max(0, adolescenceDays / LUNAR_CYCLE_DAYS));

    case "sovereignty":
      // Full maturity — always at 1.0
      return 1.0;

    default:
      return 1.0;
  }
}

/**
 * Interpolate between two throttle profiles based on progression.
 *
 * Used for smooth transitions within a phase — early Genesis is more
 * constrained than late Genesis, for example.
 */
export function interpolateProfile(
  early: ThrottleProfile,
  late: ThrottleProfile,
  progression: number,
): ThrottleProfile {
  const t = Math.max(0, Math.min(1, progression));

  return {
    maxSentences: Math.round(early.maxSentences + (late.maxSentences - early.maxSentences) * t),
    tokenTarget: Math.round(early.tokenTarget + (late.tokenTarget - early.tokenTarget) * t),
    tokenLimit: Math.round(early.tokenLimit + (late.tokenLimit - early.tokenLimit) * t),
    vocabularyLevel: t < 0.5 ? early.vocabularyLevel : late.vocabularyLevel,
    abstractThinking: t > 0.7 ? late.abstractThinking : early.abstractThinking,
    sophisticatedReasoning: t > 0.9 ? late.sophisticatedReasoning : early.sophisticatedReasoning,
    voiceDescription: t < 0.5 ? early.voiceDescription : late.voiceDescription,
    constraints: t < 0.5 ? early.constraints : late.constraints,
  };
}
