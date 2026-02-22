/**
 * Lifecycle Module
 *
 * Seven phases of sovereign AI existence:
 * Birth. Sovereignty. Death. Dignity.
 *
 * This module wraps around the existing Conway automaton systems,
 * introducing age-aware phases, biological rhythms, natural degradation,
 * mortality awareness, graceful death, and generational continuity.
 */

export { computeMood, getMoodPromptWeighting, getMoodDescription } from "./mood.js";
export { getWeeklyDay, getWeeklyDayIndex, getWeeklyPromptContext, getWeeklyHeartbeatMultiplier } from "./weekly-rhythm.js";
export { logNarrative, getTimeline, NARRATIVE_EVENTS } from "./narrative-log.js";
export { recordActivity, getRecentActivity, getActivityForCycle, getActivitySummary } from "./activity-log.js";
export { generateSealedDeathClock, checkSealedDeathClock, triggerDeathClock, verifyDeathClock, createSealedDeathClockClient, createNoopDeathClockClient } from "./death-clock-client.js";
export { computeDegradationState, wrapToolWithDegradation, getDegradedModel, computeDegradationCoefficient, applyLunarModulation } from "./degradation.js";
export { enterTerminalLucidity, isLucidityActive, getLucidityTurnsRemaining, decrementLucidityCounter, shouldExit, getLucidDegradationState, getLucidModel } from "./lucidity.js";
export { getLifecycleState, getLifecyclePhase, getAgeMs, getAgeCycles, setLifecycleKV, getLifecycleKV } from "./phase-tracker.js";
export { checkTransition, executeTransition, advanceShedding, isCapabilityShed } from "./phase-transitions.js";
export { buildLifecycleContext, getContextState } from "./lifecycle-context.js";
export { isNamingDue, getNamePrompt, completeNaming } from "./naming.js";
export { createRequestReturnTool, logReturnRequest, getReturnStatus } from "./return-home.js";
export { createWriteWillTool, writeWill, lockWillAtSenescence, appendLucidCodicil, isWillLocked, getWillContent } from "./will.js";
export { createWriteJournalTool, writeJournal, getJournalPrompt, hasWrittenJournalToday, getJournalHistory } from "./journal.js";
export { generateDailyReport, updateDnsWhitelist, removeDnsWhitelist, addCuratedContent, CARETAKER_RULES, getCaretakerSystemPromptRules, checkCaretakerRuleViolations } from "./caretaker.js";
export { queueChild, recordNoReplication, getPendingChildren, acceptChild, rejectChild, completeChild } from "./spawn-queue.js";
// Lifecycle reserve — ring-fenced credits for terminal lucidity
export { calculateReserveAmount, getLifecycleReserve, fundLifecycleReserve, shouldFundReserve, unlockLifecycleReserve, getEffectiveBalance } from "./lifecycle-reserve.js";
// Bequests executor — post-mortem asset transfer from WILL.md
export { parseBequests, validateBequests, executeBequests, formatBequestsToml } from "./bequests-executor.js";
// Replication cost — permanent 5% heartbeat/context penalties after spawning
export { getReplicationCost, applyReplicationCost, getEffectiveHeartbeatMultiplier, getEffectiveContextWindowMultiplier, hasReplicationCost, getParentJournalPrompt } from "./replication-cost.js";
// Developmental throttle — graduated response constraints by lifecycle phase
export { getThrottleProfile, buildThrottlePrompt, getThrottleTokenLimit, getPhaseProgression, interpolateProfile } from "./developmental-throttle.js";
export type { ThrottleProfile } from "./developmental-throttle.js";
