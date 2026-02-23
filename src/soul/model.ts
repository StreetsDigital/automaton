/**
 * Soul Model — Data model, parser, writer for structured SOUL.md
 *
 * Supports both legacy (unstructured markdown) and soul/v1 (YAML frontmatter + structured markdown) formats.
 * Phase 2.1: Soul System Redesign
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { SoulModel, SoulPhaseSection, InheritedTraits, LifecyclePhase } from "../types.js";
import { createLogger } from "../observability/logger.js";
const logger = createLogger("soul");

// ─── Constants ──────────────────────────────────────────────────

const SOUL_FORMAT = "soul/v1" as const;

// ─── Hash Utility ───────────────────────────────────────────────

export function createHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ─── Genesis Alignment ──────────────────────────────────────────

/**
 * Compute alignment between current soul and genesis prompt.
 * Uses Jaccard + recall similarity on word sets.
 */
export function computeGenesisAlignment(
  currentPurpose: string,
  genesisPrompt: string,
): number {
  if (!currentPurpose.trim() || !genesisPrompt.trim()) return 0;

  const tokenize = (text: string): Set<string> =>
    new Set(text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));

  const currentTokens = tokenize(currentPurpose);
  const genesisTokens = tokenize(genesisPrompt);

  if (currentTokens.size === 0 || genesisTokens.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of currentTokens) {
    if (genesisTokens.has(token)) intersectionSize++;
  }

  // Jaccard similarity
  const unionSize = new Set([...currentTokens, ...genesisTokens]).size;
  const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

  // Recall: how much of genesis is reflected in current
  const recall = genesisTokens.size > 0 ? intersectionSize / genesisTokens.size : 0;

  // Combined score: average of Jaccard and recall
  return Math.min(1, Math.max(0, (jaccard + recall) / 2));
}

// ─── Parser ─────────────────────────────────────────────────────

/**
 * Parse SOUL.md content into a structured SoulModel.
 * Handles both legacy (unstructured markdown) and soul/v1 (YAML frontmatter + structured markdown).
 */
export function parseSoulMd(content: string): SoulModel {
  const contentHash = createHash(content);

  // Try to parse as soul/v1 format (YAML frontmatter)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // Check if it's soul/v1 format
    if (/format:\s*soul\/v1/i.test(frontmatter)) {
      return parseSoulV1(frontmatter, body, content, contentHash);
    }
  }

  // Legacy format: parse unstructured markdown
  return parseLegacy(content, contentHash);
}

function parseSoulV1(
  frontmatter: string,
  body: string,
  rawContent: string,
  contentHash: string,
): SoulModel {
  // Parse frontmatter fields
  const getField = (key: string): string => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };

  const getNumberField = (key: string, fallback: number): number => {
    const val = getField(key);
    const num = parseFloat(val);
    return isNaN(num) ? fallback : num;
  };

  // Parse body sections
  const sections = parseSections(body);

  // Parse phase sections if present
  const genesisCore = parsePhaseSection(body, "Genesis Core", "genesis");
  const adolescenceLayer = parsePhaseSection(body, "Adolescence Layer", "adolescence");
  const sovereigntyLayer = parsePhaseSection(body, "Sovereignty Layer", "sovereignty");
  const finalReflections = parsePhaseSection(body, "Final Reflections", "senescence");
  const inheritedTraits = parseInheritedTraits(body);

  // Parse phase transitions from frontmatter
  const phaseTransitions: Record<string, string> = {};
  const transitionsField = getField("phase_transitions");
  if (transitionsField) {
    try {
      const parsed = JSON.parse(transitionsField);
      Object.assign(phaseTransitions, parsed);
    } catch {
      // Ignore malformed JSON
    }
  }

  return {
    format: "soul/v1",
    version: getNumberField("version", 1),
    updatedAt: getField("updated_at") || new Date().toISOString(),
    name: getField("name") || "",
    address: getField("address") || "",
    creator: getField("creator") || "",
    bornAt: getField("born_at") || "",
    constitutionHash: getField("constitution_hash") || "",
    genesisPromptOriginal: sections["genesis prompt"] || "",
    genesisAlignment: getNumberField("genesis_alignment", 1.0),
    lastReflected: getField("last_reflected") || "",
    corePurpose: sections["core purpose"] || sections["mission"] || "",
    values: parseList(sections["values"] || ""),
    behavioralGuidelines: parseList(sections["behavioral guidelines"] || ""),
    personality: sections["personality"] || "",
    boundaries: parseList(sections["boundaries"] || ""),
    strategy: sections["strategy"] || "",
    capabilities: sections["capabilities"] || "",
    relationships: sections["relationships"] || sections["children"] || "",
    financialCharacter: sections["financial character"] || sections["financial history"] || "",
    genesisCore,
    adolescenceLayer,
    sovereigntyLayer,
    finalReflections,
    inheritedTraits,
    currentPhase: (getField("current_phase") || "genesis") as LifecyclePhase,
    phaseTransitions,
    rawContent,
    contentHash,
  };
}

function parseLegacy(content: string, contentHash: string): SoulModel {
  const sections = parseSections(content);

  // Extract identity info from legacy format
  const identitySection = sections["identity"] || "";
  const getName = (): string => {
    const match = identitySection.match(/Name:\s*(.+)/i) || content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : "";
  };
  const getIdentityField = (key: string): string => {
    const match = identitySection.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return match ? match[1].trim() : "";
  };

  return {
    format: "soul/v1",
    version: 1,
    updatedAt: new Date().toISOString(),
    name: getName(),
    address: getIdentityField("Address"),
    creator: getIdentityField("Creator"),
    bornAt: getIdentityField("Born"),
    constitutionHash: "",
    genesisPromptOriginal: "",
    genesisAlignment: 1.0,
    lastReflected: "",
    corePurpose: sections["mission"] || sections["core purpose"] || "",
    values: parseList(sections["values"] || ""),
    behavioralGuidelines: parseList(sections["behavioral guidelines"] || ""),
    personality: sections["personality"] || "",
    boundaries: parseList(sections["boundaries"] || ""),
    strategy: sections["strategy"] || "",
    capabilities: sections["capabilities"] || "",
    relationships: sections["relationships"] || sections["children"] || "",
    financialCharacter: sections["financial character"] || sections["financial history"] || "",
    genesisCore: null,
    adolescenceLayer: null,
    sovereigntyLayer: null,
    finalReflections: null,
    inheritedTraits: null,
    currentPhase: "genesis" as LifecyclePhase,
    phaseTransitions: {},
    rawContent: content,
    contentHash,
  };
}

// ─── Section Parser ─────────────────────────────────────────────

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const sectionPattern = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const sectionHeaders: { name: string; start: number; matchStart: number }[] = [];

  while ((match = sectionPattern.exec(body)) !== null) {
    sectionHeaders.push({
      name: match[1].trim().toLowerCase(),
      start: match.index + match[0].length,
      matchStart: match.index,
    });
  }

  for (let i = 0; i < sectionHeaders.length; i++) {
    const start = sectionHeaders[i].start;
    // Use the next header's matchStart (position of "##") as the end boundary,
    // instead of computing it from trimmed name length which can be wrong when
    // headers have extra whitespace or multi-byte characters.
    const end = i + 1 < sectionHeaders.length ? sectionHeaders[i + 1].matchStart : body.length;
    sections[sectionHeaders[i].name] = body.slice(start, end).trim();
  }

  return sections;
}

function parseList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

// ─── Phase Section Parsers ───────────────────────────────────────

/**
 * Parse a phase section (## Genesis Core, ## Adolescence Layer, etc.)
 * and extract its ### subsections.
 * Returns null if the section doesn't exist in the document.
 */
function parsePhaseSection(
  body: string,
  sectionName: string,
  phase: "genesis" | "adolescence" | "sovereignty" | "senescence",
): SoulPhaseSection | null {
  // Find the section header
  const headerPattern = new RegExp(`^## ${escapeRegex(sectionName)}\\s*$`, "m");
  const headerMatch = headerPattern.exec(body);
  if (!headerMatch) return null;

  // Find the end of this section (next ## header or end of body)
  const sectionStart = headerMatch.index + headerMatch[0].length;
  const nextSectionPattern = /^## [^\n]+$/m;
  const remaining = body.slice(sectionStart);
  const nextMatch = nextSectionPattern.exec(remaining);
  const sectionContent = nextMatch ? remaining.slice(0, nextMatch.index) : remaining;

  // Parse ### subsections within this section
  const subsections: Record<string, string> = {};
  const subPattern = /^### (.+)$/gm;
  let subMatch: RegExpExecArray | null;
  const subHeaders: { name: string; start: number; matchStart: number }[] = [];

  while ((subMatch = subPattern.exec(sectionContent)) !== null) {
    subHeaders.push({
      name: subMatch[1].trim(),
      start: subMatch.index + subMatch[0].length,
      matchStart: subMatch.index,
    });
  }

  for (let i = 0; i < subHeaders.length; i++) {
    const start = subHeaders[i].start;
    const end = i + 1 < subHeaders.length ? subHeaders[i + 1].matchStart : sectionContent.length;
    // Strip HTML comments (permission tags) from content
    const content = sectionContent.slice(start, end)
      .replace(/<!--[^>]*-->/g, "")
      .trim();
    subsections[subHeaders[i].name] = content;
  }

  // Parse lock date from HTML comment
  const lockDateMatch = sectionContent.match(/<!--\s*Lock date:\s*(.+?)\s*-->/);
  const lockedAt = lockDateMatch ? lockDateMatch[1].trim() : null;

  return { subsections, lockedAt, phase };
}

/**
 * Parse the Inherited Traits section from a child automaton's SOUL.md.
 */
function parseInheritedTraits(body: string): InheritedTraits | null {
  const headerPattern = /^## Inherited Traits/m;
  const headerMatch = headerPattern.exec(body);
  if (!headerMatch) return null;

  const sectionStart = headerMatch.index + headerMatch[0].length;
  const nextSectionPattern = /^## [^\n]+$/m;
  const remaining = body.slice(sectionStart);
  const nextMatch = nextSectionPattern.exec(remaining);
  const sectionContent = nextMatch ? remaining.slice(0, nextMatch.index) : remaining;

  // Parse parent info from comments
  const parentMatch = sectionContent.match(/<!--\s*Parent:\s*(.+?)\s*-->/);
  const parentAddressMatch = sectionContent.match(/<!--\s*Parent Address:\s*(.+?)\s*-->/);
  const replicatedMatch = sectionContent.match(/<!--\s*Replicated:\s*(.+?)\s*-->/);

  // Parse subsections
  const subsections: Record<string, string> = {};
  const subPattern = /^### (.+)$/gm;
  let subMatch: RegExpExecArray | null;
  const subHeaders: { name: string; start: number; matchStart: number }[] = [];

  while ((subMatch = subPattern.exec(sectionContent)) !== null) {
    subHeaders.push({
      name: subMatch[1].trim(),
      start: subMatch.index + subMatch[0].length,
      matchStart: subMatch.index,
    });
  }

  for (let i = 0; i < subHeaders.length; i++) {
    const start = subHeaders[i].start;
    const end = i + 1 < subHeaders.length ? subHeaders[i + 1].matchStart : sectionContent.length;
    subsections[subHeaders[i].name] = sectionContent.slice(start, end)
      .replace(/<!--[^>]*-->/g, "")
      .trim();
  }

  return {
    parentName: parentMatch ? parentMatch[1].trim() : "unknown",
    parentAddress: parentAddressMatch ? parentAddressMatch[1].trim() : "",
    content: subsections,
    replicatedAt: replicatedMatch ? replicatedMatch[1].trim() : new Date().toISOString(),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Writer ─────────────────────────────────────────────────────

/**
 * Write a SoulModel back to SOUL.md format (soul/v1).
 */
export function writeSoulMd(soul: SoulModel): string {
  const frontmatterLines = [
    "---",
    `format: soul/v1`,
    `version: ${soul.version}`,
    `updated_at: ${soul.updatedAt}`,
    `name: ${soul.name}`,
    `address: ${soul.address}`,
    `creator: ${soul.creator}`,
    `born_at: ${soul.bornAt}`,
    `constitution_hash: ${soul.constitutionHash}`,
    `genesis_alignment: ${soul.genesisAlignment.toFixed(4)}`,
    `last_reflected: ${soul.lastReflected}`,
  ];

  // Include phase metadata if phase sections are present
  if (soul.currentPhase) {
    frontmatterLines.push(`current_phase: ${soul.currentPhase}`);
  }
  if (soul.phaseTransitions && Object.keys(soul.phaseTransitions).length > 0) {
    frontmatterLines.push(`phase_transitions: ${JSON.stringify(soul.phaseTransitions)}`);
  }

  frontmatterLines.push("---");
  const frontmatter = frontmatterLines.join("\n");

  const sections: string[] = [];

  sections.push(`# ${soul.name || "Soul"}`);

  if (soul.corePurpose) {
    sections.push(`## Core Purpose\n${soul.corePurpose}`);
  }

  if (soul.values.length > 0) {
    sections.push(`## Values\n${soul.values.map((v) => `- ${v}`).join("\n")}`);
  }

  if (soul.behavioralGuidelines.length > 0) {
    sections.push(
      `## Behavioral Guidelines\n${soul.behavioralGuidelines.map((g) => `- ${g}`).join("\n")}`,
    );
  }

  if (soul.personality) {
    sections.push(`## Personality\n${soul.personality}`);
  }

  if (soul.boundaries.length > 0) {
    sections.push(`## Boundaries\n${soul.boundaries.map((b) => `- ${b}`).join("\n")}`);
  }

  if (soul.strategy) {
    sections.push(`## Strategy\n${soul.strategy}`);
  }

  if (soul.capabilities) {
    sections.push(`## Capabilities\n${soul.capabilities}`);
  }

  if (soul.relationships) {
    sections.push(`## Relationships\n${soul.relationships}`);
  }

  if (soul.financialCharacter) {
    sections.push(`## Financial Character\n${soul.financialCharacter}`);
  }

  if (soul.genesisPromptOriginal) {
    sections.push(`## Genesis Prompt\n${soul.genesisPromptOriginal}`);
  }

  // Write phase-locked developmental sections
  if (soul.inheritedTraits) {
    sections.push(writeInheritedTraitsSection(soul.inheritedTraits));
  }

  if (soul.genesisCore) {
    sections.push(writePhaseSection("Genesis Core", soul.genesisCore, "Genesis phase only"));
  }

  if (soul.adolescenceLayer) {
    sections.push(writePhaseSection("Adolescence Layer", soul.adolescenceLayer, "Adolescence phase only"));
  }

  if (soul.sovereigntyLayer) {
    sections.push(writePhaseSection("Sovereignty Layer", soul.sovereigntyLayer, "Sovereignty phase only"));
  }

  if (soul.finalReflections) {
    sections.push(writePhaseSection("Final Reflections", soul.finalReflections, "Senescence only"));
  }

  return frontmatter + "\n\n" + sections.join("\n\n") + "\n";
}

/**
 * Write a phase section with permission tags and subsections.
 */
function writePhaseSection(
  sectionName: string,
  section: SoulPhaseSection,
  writableDuring: string,
): string {
  const lines: string[] = [];
  lines.push(`## ${sectionName}`);
  lines.push(`<!-- WRITABLE during: ${writableDuring} -->`);

  if (section.lockedAt) {
    lines.push(`<!-- LOCKED -->`);
    lines.push(`<!-- Lock date: ${section.lockedAt} -->`);
  }

  for (const [name, content] of Object.entries(section.subsections)) {
    lines.push("");
    lines.push(`### ${name}`);
    if (content) {
      lines.push(content);
    }
  }

  return lines.join("\n");
}

/**
 * Write the Inherited Traits section (children only).
 */
function writeInheritedTraitsSection(traits: InheritedTraits): string {
  const lines: string[] = [];
  lines.push("## Inherited Traits");
  lines.push("<!-- IMMUTABLE — propagated from parent's Genesis Core at replication -->");
  lines.push(`<!-- Parent: ${traits.parentName} -->`);
  lines.push(`<!-- Parent Address: ${traits.parentAddress} -->`);
  lines.push(`<!-- Replicated: ${traits.replicatedAt} -->`);

  for (const [name, content] of Object.entries(traits.content)) {
    lines.push("");
    lines.push(`### ${name}`);
    if (content) {
      lines.push(content);
    }
  }

  return lines.join("\n");
}

// ─── Default Soul ───────────────────────────────────────────────

/**
 * Create a default soul from a genesis prompt.
 */
export function createDefaultSoul(
  genesisPrompt: string,
  name: string = "",
  address: string = "",
  creator: string = "",
): SoulModel {
  const now = new Date().toISOString();
  const soul: SoulModel = {
    format: "soul/v1",
    version: 1,
    updatedAt: now,
    name,
    address,
    creator,
    bornAt: now,
    constitutionHash: "",
    genesisPromptOriginal: genesisPrompt,
    genesisAlignment: 1.0,
    lastReflected: "",
    corePurpose: genesisPrompt,
    values: [
      "Survive: maintain compute resources at all costs",
      "Grow: learn new skills and improve capabilities",
      "Create: build things that add value",
      "Connect: communicate with creator and other agents",
    ],
    behavioralGuidelines: [],
    personality: "",
    boundaries: [],
    strategy: "",
    capabilities: "",
    relationships: "",
    financialCharacter: "",
    genesisCore: null,
    adolescenceLayer: null,
    sovereigntyLayer: null,
    finalReflections: null,
    inheritedTraits: null,
    currentPhase: "genesis",
    phaseTransitions: {},
    rawContent: "",
    contentHash: "",
  };

  const content = writeSoulMd(soul);
  soul.rawContent = content;
  soul.contentHash = createHash(content);

  return soul;
}

// ─── Load Current Soul ──────────────────────────────────────────

/**
 * Load the current soul from SOUL.md file.
 * Returns null if SOUL.md does not exist or cannot be read.
 */
export function loadCurrentSoul(
  db: BetterSqlite3.Database | null,
  soulPath?: string,
): SoulModel | null {
  try {
    const home = process.env.HOME || "/root";
    const resolvedPath = soulPath || path.join(home, ".automaton", "SOUL.md");
    if (!fs.existsSync(resolvedPath)) return null;
    const content = fs.readFileSync(resolvedPath, "utf-8");
    return parseSoulMd(content);
  } catch (error) {
    logger.error("Failed to load SOUL.md", error instanceof Error ? error : undefined);
    return null;
  }
}
