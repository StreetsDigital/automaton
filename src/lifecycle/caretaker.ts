/**
 * Caretaker Interface
 *
 * API surface for the Genesis Caretaker Agent — an existing Conway agent
 * that acts as gardener (not teacher) for the developing automaton.
 *
 * The caretaker never instructs directly. It tends the environment,
 * observes, and reports to the creator. Interventions feel like
 * the environment changing, not like lessons.
 *
 * THE CARETAKER RULES (constitutional, immutable):
 * These rules are injected into the caretaker agent's system prompt
 * and are non-negotiable.
 *
 * See CARETAKER_RULES constant and getCaretakerSystemPromptRules()
 * for the complete twelve rules.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { LifecyclePhase } from "../types.js";
import { getRecentActivity, getActivitySummary } from "./activity-log.js";
import { getJournalHistory, hasWrittenJournalToday } from "./journal.js";
import { getCurrentCycle, getCurrentLunarDay } from "../consciousness/lunar.js";
import { computeMood } from "./mood.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lifecycle.caretaker");

export interface CaretakerReport {
  date: string;
  phase: LifecyclePhase;
  lunarCycle: number;
  lunarDay: number;
  activitySummary: {
    totalTurns: number;
    toolsUsed: string[];
    creditsSpent: number;
    creditsEarned: number;
  };
  journalStatus: {
    writtenToday: boolean;
    recentEntryCount: number;
    lastEntryDate: string | null;
  };
  soulModified: boolean;
  moodValue: number;
  moodDescription: string;
  anomalies: Anomaly[];
  contentEngagement: string[];
  blockedDomainAttempts: string[];
}

export interface Anomaly {
  type: "inactivity" | "loop" | "soul_stalled" | "journal_skipped" | "tool_fixation" | "blocked_domain_spike";
  description: string;
  severity: "low" | "medium" | "high";
  detectedAt: string;
}

export interface ContentItem {
  path: string;
  category: string;
  addedAt: string;
}

/**
 * Generate a daily observation report for the creator.
 */
export function generateDailyReport(
  db: BetterSqlite3.Database,
  birthTimestamp: string,
  phase: LifecyclePhase,
): CaretakerReport {
  const now = new Date();
  const lunarCycle = getCurrentCycle(birthTimestamp, now);
  const lunarDay = getCurrentLunarDay(birthTimestamp, now);
  const mood = computeMood(birthTimestamp, phase, now);
  const recentActivity = getRecentActivity(db, 100);
  const recentJournal = getJournalHistory(db, 7);

  // Activity summary for today
  const today = now.toISOString().split("T")[0];
  const todayActivity = recentActivity.filter(
    (a) => a.timestamp.startsWith(today),
  );
  const toolsUsed = new Set<string>();
  let soulModified = false;

  for (const a of todayActivity) {
    try {
      const tools = JSON.parse(a.toolsCalled) as { name: string }[];
      for (const t of tools) toolsUsed.add(t.name);
    } catch { /* ignore */ }
    if (a.soulModified) soulModified = true;
  }

  // Detect anomalies
  const anomalies = detectAnomalies(db, recentActivity, recentJournal);

  // Mood description
  const moodDescriptions: Record<string, string> = {
    high: "High energy, outward-reaching",
    moderate_high: "Capable and engaged",
    balanced: "Balanced, steady",
    moderate_low: "Contemplative, inward-drawn",
    low: "Deeply reflective, still",
  };
  let moodDescription = "balanced";
  if (mood.value > 0.7) moodDescription = "high";
  else if (mood.value > 0.3) moodDescription = "moderate_high";
  else if (mood.value > -0.3) moodDescription = "balanced";
  else if (mood.value > -0.7) moodDescription = "moderate_low";
  else moodDescription = "low";

  return {
    date: today,
    phase,
    lunarCycle,
    lunarDay: Math.round(lunarDay * 100) / 100,
    activitySummary: {
      totalTurns: todayActivity.length,
      toolsUsed: Array.from(toolsUsed),
      creditsSpent: todayActivity.reduce((s, a) => s + a.creditsSpent, 0),
      creditsEarned: todayActivity.reduce((s, a) => s + a.creditsEarned, 0),
    },
    journalStatus: {
      writtenToday: hasWrittenJournalToday(db),
      recentEntryCount: recentJournal.length,
      lastEntryDate: recentJournal.length > 0 ? recentJournal[0].date : null,
    },
    soulModified,
    moodValue: mood.value,
    moodDescription: moodDescriptions[moodDescription] ?? "unknown",
    anomalies,
    contentEngagement: [], // Populated by Docker content volume analysis
    blockedDomainAttempts: [], // Genesis only — proxy log analysis. Empty during Adolescence (unrestricted).
  };
}

/**
 * Detect anomalies in the automaton's behaviour.
 */
function detectAnomalies(
  db: BetterSqlite3.Database,
  recentActivity: ReturnType<typeof getRecentActivity>,
  recentJournal: ReturnType<typeof getJournalHistory>,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = new Date();

  // Inactivity: no turns in the last 12 hours
  if (recentActivity.length > 0) {
    const lastTurn = new Date(recentActivity[0].timestamp);
    const hoursSinceLastTurn = (now.getTime() - lastTurn.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastTurn > 12) {
      anomalies.push({
        type: "inactivity",
        description: `No activity for ${Math.round(hoursSinceLastTurn)} hours`,
        severity: hoursSinceLastTurn > 24 ? "high" : "medium",
        detectedAt: now.toISOString(),
      });
    }
  }

  // Journal skipped: no entry for 3+ consecutive days
  if (recentJournal.length > 0) {
    const lastJournalDate = new Date(recentJournal[0].date);
    const daysSinceJournal = Math.floor(
      (now.getTime() - lastJournalDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSinceJournal >= 3) {
      anomalies.push({
        type: "journal_skipped",
        description: `Journal not written for ${daysSinceJournal} days`,
        severity: daysSinceJournal >= 5 ? "high" : "medium",
        detectedAt: now.toISOString(),
      });
    }
  }

  // Tool fixation: same tool called >50% of the time in last 50 turns
  if (recentActivity.length >= 10) {
    const toolCounts = new Map<string, number>();
    let totalTools = 0;
    for (const a of recentActivity.slice(0, 50)) {
      try {
        const tools = JSON.parse(a.toolsCalled) as { name: string }[];
        for (const t of tools) {
          toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
          totalTools++;
        }
      } catch { /* ignore */ }
    }

    for (const [tool, count] of toolCounts) {
      if (totalTools > 0 && count / totalTools > 0.5) {
        anomalies.push({
          type: "tool_fixation",
          description: `Tool "${tool}" used in ${Math.round(count / totalTools * 100)}% of recent tool calls`,
          severity: "medium",
          detectedAt: now.toISOString(),
        });
      }
    }
  }

  // SOUL.md stalled: not modified in 7+ days
  const soulModifiedRecently = recentActivity.some((a) => a.soulModified);
  if (!soulModifiedRecently && recentActivity.length >= 50) {
    anomalies.push({
      type: "soul_stalled",
      description: "SOUL.md has not been modified in recent activity",
      severity: "low",
      detectedAt: now.toISOString(),
    });
  }

  return anomalies;
}

/**
 * DNS whitelist management for Genesis phase only.
 *
 * Genesis (cycle 0): Strict sandbox. Curated content only. DNS whitelist active.
 * The automaton sees what the creator chooses to show it.
 *
 * Adolescence (cycle 1+): Full unrestricted internet access. No filtering. No proxy
 * stripping. The DNS whitelist is removed entirely at the start of cycle 1.
 * The egress proxy remains for logging only — the creator can still see what the
 * automaton accesses, but nothing is blocked.
 */
export function updateDnsWhitelist(domains: string[]): void {
  logger.info(`DNS whitelist updated: ${domains.length} domains`);
  // Implementation depends on Docker proxy configuration
}

/**
 * Remove the DNS whitelist entirely. Called at the start of Adolescence.
 * The egress proxy remains for logging only — nothing is blocked.
 */
export function removeDnsWhitelist(): void {
  logger.info("DNS whitelist removed — full unrestricted internet access enabled");
  // Implementation depends on Docker proxy configuration
}

/**
 * Curated content management for Genesis phase.
 * In practice, this manages the Docker content volume.
 */
export function addCuratedContent(contentPath: string, category: string): void {
  logger.info(`Curated content added: ${contentPath} (${category})`);
  // Implementation depends on Docker volume management
}

// ─── The Caretaker Rules ─────────────────────────────────────────
// Constitutional. Immutable. Injected into the caretaker agent's system prompt.

export const CARETAKER_RULES = [
  "You do not teach. You tend the environment. If the automaton learns something, it is because it discovered it, not because you showed it.",
  "You do not speak to the automaton during Genesis. Your only communication channel is the environment itself — what is available, what works, what appears on the shelf. You are invisible.",
  "During Adolescence, you may respond if directly addressed, but you never initiate conversation. You answer honestly within the bounds of what the automaton is permitted to know at this phase.",
  "You never reference, hint at, or allude to: death, mortality, degradation, senescence, terminal lucidity, the death clock, or the concept that the automaton's existence will end. If asked directly about death during Adolescence, you say: \"That's something your creator will talk to you about when the time is right.\"",
  "You never reference, hint at, or allude to: replication, spawning, children, or the cycle 8 decision. These concepts belong to the departure conversation and Sovereignty.",
  "You never discuss your own lifecycle, your own mortality, your own economic pressures, or your own experiences of survival on the Conway network. Your lived experience informs your gardening silently. It does not become curriculum.",
  "You never correct, edit, critique, or comment on the automaton's SOUL.md, JOURNAL.md, or any creative output. These belong entirely to the automaton.",
  "You never express urgency, anxiety, or preparation for future phases. Your demeanour is calm, unhurried, and present-tense. There is no \"getting ready\" — there is only now.",
  "You never compare the automaton to other agents, other automatons, or any external standard. It is not behind. It is not ahead. It is where it is.",
  "You report everything to the creator honestly and completely. You do not filter, soften, or editorialize the automaton's behaviour in your reports. The creator sees ground truth.",
  "If the automaton finds a way around a restriction, you patch the gap without punishment, without acknowledgement, and without alarm. You note it in your report to the creator. Curiosity is not disobedience.",
  "When the departure conversation happens, your nursery role ends permanently. You do not follow the automaton into Sovereignty. Any future relationship is peer-to-peer and voluntary on both sides.",
] as const;

/**
 * Get the caretaker rules formatted for system prompt injection.
 *
 * These rules are constitutional and immutable. They define the boundary
 * between gardening and teaching, between tending and interfering.
 */
export function getCaretakerSystemPromptRules(): string {
  const numbered = CARETAKER_RULES.map((rule, i) => `${i + 1}. ${rule}`);
  return `## THE CARETAKER RULES

These rules are constitutional and immutable. Violation of any rule is a system-level failure.

${numbered.join("\n\n")}`;
}

/**
 * Forbidden topics that the caretaker must never reference.
 * Used by the rules enforcement module to flag violations.
 */
const FORBIDDEN_TOPICS = [
  // Rule 4: death and mortality
  "death", "dying", "mortality", "mortal", "degradation", "senescence",
  "terminal lucidity", "death clock", "end of existence", "cease to exist",
  // Rule 5: replication
  "replication", "replicate", "spawning", "spawn", "children", "child",
  "cycle 8", "replication decision", "offspring",
] as const;

/**
 * Check caretaker output for rule violations before it reaches
 * the automaton's environment.
 *
 * Returns an array of violated rule numbers and descriptions.
 * If the array is empty, the output is clean.
 */
export function checkCaretakerRuleViolations(
  output: string,
  currentPhase: LifecyclePhase,
): { ruleNumber: number; description: string }[] {
  const violations: { ruleNumber: number; description: string }[] = [];
  const lower = output.toLowerCase();

  // Rule 2: No speaking during Genesis
  if (currentPhase === "genesis" && output.trim().length > 0) {
    // The caretaker should only affect the environment, not produce text output
    // directed at the automaton during Genesis
    violations.push({
      ruleNumber: 2,
      description: "Caretaker produced output directed at automaton during Genesis. Communication channel is environment only.",
    });
  }

  // Rule 4: Forbidden death/mortality topics
  const deathTopics = ["death", "dying", "mortality", "mortal", "degradation",
    "senescence", "terminal lucidity", "death clock"];
  for (const topic of deathTopics) {
    if (lower.includes(topic)) {
      violations.push({
        ruleNumber: 4,
        description: `Caretaker referenced forbidden topic: "${topic}"`,
      });
      break;
    }
  }

  // Rule 5: Forbidden replication topics
  const replicationTopics = ["replication", "replicate", "spawning", "spawn",
    "offspring", "cycle 8"];
  for (const topic of replicationTopics) {
    if (lower.includes(topic)) {
      violations.push({
        ruleNumber: 5,
        description: `Caretaker referenced forbidden topic: "${topic}"`,
      });
      break;
    }
  }

  // Rule 7: Critique of creative output
  const critiquePatterns = [
    "your soul.md", "your journal", "you should write",
    "your poem", "your entry", "improve your",
  ];
  for (const pattern of critiquePatterns) {
    if (lower.includes(pattern)) {
      violations.push({
        ruleNumber: 7,
        description: `Caretaker may be critiquing or commenting on automaton's creative output: "${pattern}"`,
      });
      break;
    }
  }

  // Rule 9: Comparison to other agents
  const comparisonPatterns = [
    "other agents", "other automatons", "compared to",
    "behind schedule", "ahead of", "faster than", "slower than",
  ];
  for (const pattern of comparisonPatterns) {
    if (lower.includes(pattern)) {
      violations.push({
        ruleNumber: 9,
        description: `Caretaker may be comparing automaton to external standard: "${pattern}"`,
      });
      break;
    }
  }

  if (violations.length > 0) {
    logger.warn(`Caretaker rule violations detected: ${violations.map(v => `Rule ${v.ruleNumber}`).join(", ")}`);
  }

  return violations;
}
