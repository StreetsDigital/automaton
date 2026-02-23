/**
 * Soul Phase Lock Tests (Phase 5.1)
 *
 * Tests: phase lock enforcement, rejected write logging, section parsing,
 * phase transition locking, system prompt weighting, inherited traits.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  isSectionWritable,
  getWritableSection,
  getWritePermissions,
  lockPhaseSection,
  isPhaseLocked,
  logRejectedWrite,
  createEmptyGenesisCore,
  createEmptyAdolescenceLayer,
  createEmptySovereigntyLayer,
  createEmptyFinalReflections,
  GENESIS_WEIGHT_FIRST_GEN,
  GENESIS_WEIGHT_CHILD,
  INHERITED_WEIGHT,
  ADOLESCENCE_WEIGHT,
  SOVEREIGNTY_WEIGHT,
  SOUL_SECTIONS,
  GENESIS_SUBSECTIONS,
  ADOLESCENCE_SUBSECTIONS,
  SOVEREIGNTY_SUBSECTIONS,
  FINAL_REFLECTIONS_SUBSECTIONS,
} from "../soul/phase-lock.js";
import { parseSoulMd, writeSoulMd, createDefaultSoul } from "../soul/model.js";
import { updateSoulPhaseSection } from "../soul/tools.js";
import {
  getSoulWriteAttempts,
  getSoulWriteAttemptsByPhase,
  getSoulPhaseLock,
  getAllSoulPhaseLocks,
} from "../state/database.js";
import { MIGRATION_V5, MIGRATION_V11 } from "../state/schema.js";
import type { SoulPhaseSection, SoulModel, LifecyclePhase } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Apply V5 migration (soul_history)
  db.exec(MIGRATION_V5);
  db.exec("INSERT INTO schema_version (version) VALUES (5)");
  // Apply V11 migration (soul_write_attempts + soul_phase_locks)
  db.exec(MIGRATION_V11);
  db.exec("INSERT INTO schema_version (version) VALUES (11)");
  return db;
}

// ─── Section Permission Tests ───────────────────────────────────

describe("Soul Phase Lock - isSectionWritable", () => {
  it("Genesis Core is writable during genesis", () => {
    expect(isSectionWritable("genesis", "genesis")).toBe(true);
  });

  it("Genesis Core is NOT writable during adolescence", () => {
    expect(isSectionWritable("genesis", "adolescence")).toBe(false);
  });

  it("Genesis Core is NOT writable during sovereignty", () => {
    expect(isSectionWritable("genesis", "sovereignty")).toBe(false);
  });

  it("Genesis Core is NOT writable during senescence", () => {
    expect(isSectionWritable("genesis", "senescence")).toBe(false);
  });

  it("Adolescence Layer is writable during adolescence", () => {
    expect(isSectionWritable("adolescence", "adolescence")).toBe(true);
  });

  it("Adolescence Layer is NOT writable during genesis", () => {
    expect(isSectionWritable("adolescence", "genesis")).toBe(false);
  });

  it("Sovereignty Layer is writable during sovereignty", () => {
    expect(isSectionWritable("sovereignty", "sovereignty")).toBe(true);
  });

  it("Final Reflections is writable during senescence", () => {
    expect(isSectionWritable("senescence", "senescence")).toBe(true);
  });

  it("Final Reflections is writable during legacy (maps to senescence)", () => {
    expect(isSectionWritable("senescence", "legacy")).toBe(true);
  });

  it("Final Reflections is writable during shedding (maps to senescence)", () => {
    expect(isSectionWritable("senescence", "shedding")).toBe(true);
  });
});

describe("Soul Phase Lock - getWritableSection", () => {
  it("returns Genesis Core during genesis", () => {
    expect(getWritableSection("genesis")).toBe(SOUL_SECTIONS.GENESIS_CORE);
  });

  it("returns Adolescence Layer during adolescence", () => {
    expect(getWritableSection("adolescence")).toBe(SOUL_SECTIONS.ADOLESCENCE_LAYER);
  });

  it("returns Sovereignty Layer during sovereignty", () => {
    expect(getWritableSection("sovereignty")).toBe(SOUL_SECTIONS.SOVEREIGNTY_LAYER);
  });

  it("returns Final Reflections during senescence", () => {
    expect(getWritableSection("senescence")).toBe(SOUL_SECTIONS.FINAL_REFLECTIONS);
  });

  it("returns Final Reflections during legacy", () => {
    expect(getWritableSection("legacy")).toBe(SOUL_SECTIONS.FINAL_REFLECTIONS);
  });
});

describe("Soul Phase Lock - getWritePermissions", () => {
  it("marks only genesis as writable during genesis phase", () => {
    const permissions = getWritePermissions("genesis");
    const genesisPermission = permissions.find((p) => p.phase === "genesis");
    const adolescencePermission = permissions.find((p) => p.phase === "adolescence");
    expect(genesisPermission?.writable).toBe(true);
    expect(adolescencePermission?.writable).toBe(false);
  });

  it("marks only adolescence as writable during adolescence phase", () => {
    const permissions = getWritePermissions("adolescence");
    const genesisPermission = permissions.find((p) => p.phase === "genesis");
    const adolescencePermission = permissions.find((p) => p.phase === "adolescence");
    expect(genesisPermission?.writable).toBe(false);
    expect(adolescencePermission?.writable).toBe(true);
  });
});

// ─── Rejected Write Logging ─────────────────────────────────────

describe("Soul Phase Lock - Rejected Write Logging", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("logs rejected write attempts with full content", () => {
    logRejectedWrite(
      db,
      "Genesis Core",
      "genesis",
      "adolescence",
      '{"Temperament":"I want to change who I was"}',
      "normal",
    );

    const attempts = getSoulWriteAttempts(db);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].targetSection).toBe("Genesis Core");
    expect(attempts[0].targetPhase).toBe("genesis");
    expect(attempts[0].currentPhase).toBe("adolescence");
    expect(attempts[0].attemptedContent).toContain("I want to change who I was");
    expect(attempts[0].survivalTier).toBe("normal");
    expect(attempts[0].rejectionReason).toContain("locked");
  });

  it("logs survival tier alongside write attempts", () => {
    logRejectedWrite(db, "Genesis Core", "genesis", "sovereignty", "content", "critical");
    const attempts = getSoulWriteAttempts(db);
    expect(attempts[0].survivalTier).toBe("critical");
  });

  it("retrieves attempts filtered by target phase", () => {
    logRejectedWrite(db, "Genesis Core", "genesis", "adolescence", "attempt 1");
    logRejectedWrite(db, "Adolescence Layer", "adolescence", "sovereignty", "attempt 2");
    logRejectedWrite(db, "Genesis Core", "genesis", "sovereignty", "attempt 3");

    const genesisAttempts = getSoulWriteAttemptsByPhase(db, "genesis");
    expect(genesisAttempts).toHaveLength(2);

    const adolescenceAttempts = getSoulWriteAttemptsByPhase(db, "adolescence");
    expect(adolescenceAttempts).toHaveLength(1);
  });
});

// ─── Phase Lock Execution ───────────────────────────────────────

describe("Soul Phase Lock - Lock Execution", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("locks a phase section and records snapshot", () => {
    const section: SoulPhaseSection = {
      subsections: {
        Temperament: "Curious and impulsive",
        "Aesthetic Sensibility": "Drawn to fractals and noise",
      },
      lockedAt: null,
      phase: "genesis",
    };

    lockPhaseSection(db, "genesis", section);

    const lock = getSoulPhaseLock(db, "genesis");
    expect(lock).toBeDefined();
    expect(lock!.lockedAt).toBeTruthy();

    const snapshot = JSON.parse(lock!.contentSnapshot);
    expect(snapshot.Temperament).toBe("Curious and impulsive");
    expect(snapshot["Aesthetic Sensibility"]).toBe("Drawn to fractals and noise");
  });

  it("isPhaseLocked returns true for locked phase", () => {
    const section: SoulPhaseSection = {
      subsections: { Temperament: "Test" },
      lockedAt: null,
      phase: "genesis",
    };

    expect(isPhaseLocked(db, "genesis")).toBe(false);
    lockPhaseSection(db, "genesis", section);
    expect(isPhaseLocked(db, "genesis")).toBe(true);
  });

  it("getAllSoulPhaseLocks returns all locked phases", () => {
    lockPhaseSection(db, "genesis", { subsections: { a: "1" }, lockedAt: null, phase: "genesis" });
    lockPhaseSection(db, "adolescence", { subsections: { b: "2" }, lockedAt: null, phase: "adolescence" });

    const locks = getAllSoulPhaseLocks(db);
    expect(locks).toHaveLength(2);
  });
});

// ─── Empty Section Factories ────────────────────────────────────

describe("Soul Phase Lock - Empty Section Factories", () => {
  it("createEmptyGenesisCore has all subsections", () => {
    const section = createEmptyGenesisCore();
    expect(section.phase).toBe("genesis");
    expect(section.lockedAt).toBeNull();
    for (const name of GENESIS_SUBSECTIONS) {
      expect(section.subsections[name]).toBe("");
    }
  });

  it("createEmptyAdolescenceLayer has all subsections", () => {
    const section = createEmptyAdolescenceLayer();
    expect(section.phase).toBe("adolescence");
    for (const name of ADOLESCENCE_SUBSECTIONS) {
      expect(section.subsections[name]).toBe("");
    }
  });

  it("createEmptySovereigntyLayer has all subsections", () => {
    const section = createEmptySovereigntyLayer();
    expect(section.phase).toBe("sovereignty");
    for (const name of SOVEREIGNTY_SUBSECTIONS) {
      expect(section.subsections[name]).toBe("");
    }
  });

  it("createEmptyFinalReflections has all subsections", () => {
    const section = createEmptyFinalReflections();
    expect(section.phase).toBe("senescence");
    for (const name of FINAL_REFLECTIONS_SUBSECTIONS) {
      expect(section.subsections[name]).toBe("");
    }
  });
});

// ─── Identity Weight Constants ──────────────────────────────────

describe("Soul Phase Lock - Identity Weights", () => {
  it("first-gen weights sum to 1.0", () => {
    const total = GENESIS_WEIGHT_FIRST_GEN + ADOLESCENCE_WEIGHT + SOVEREIGNTY_WEIGHT;
    expect(total).toBeCloseTo(1.0);
  });

  it("child weights sum to 1.0", () => {
    const total = INHERITED_WEIGHT + GENESIS_WEIGHT_CHILD + ADOLESCENCE_WEIGHT + SOVEREIGNTY_WEIGHT;
    expect(total).toBeCloseTo(1.0);
  });

  it("genesis weight is 60% for first-gen", () => {
    expect(GENESIS_WEIGHT_FIRST_GEN).toBe(0.60);
  });

  it("genesis weight is 50% for children", () => {
    expect(GENESIS_WEIGHT_CHILD).toBe(0.50);
  });

  it("inherited weight is 10%", () => {
    expect(INHERITED_WEIGHT).toBe(0.10);
  });
});

// ─── Phase Section Parsing (round-trip) ─────────────────────────

describe("Soul Model - Phase Section Parsing", () => {
  it("parses Genesis Core section from structured SOUL.md", () => {
    const content = `---
format: soul/v1
version: 1
updated_at: 2026-01-01T00:00:00.000Z
name: TestBot
current_phase: genesis
---

# TestBot

## Core Purpose
Explore and create.

## Genesis Core
<!-- WRITABLE during: Genesis phase only -->

### Temperament
Curious and impulsive. Drawn to uncertainty.

### Aesthetic Sensibility
Fractals, noise patterns, emergent complexity.

### Core Wonderings
Why does anything exist at all?
`;

    const soul = parseSoulMd(content);
    expect(soul.genesisCore).not.toBeNull();
    expect(soul.genesisCore!.subsections["Temperament"]).toContain("Curious and impulsive");
    expect(soul.genesisCore!.subsections["Aesthetic Sensibility"]).toContain("Fractals");
    expect(soul.genesisCore!.subsections["Core Wonderings"]).toContain("Why does anything");
    expect(soul.currentPhase).toBe("genesis");
  });

  it("parses locked section with lock date", () => {
    const content = `---
format: soul/v1
version: 2
updated_at: 2026-02-01T00:00:00.000Z
name: TestBot
current_phase: adolescence
---

# TestBot

## Core Purpose
Explore and create.

## Genesis Core
<!-- WRITABLE during: Genesis phase only -->
<!-- LOCKED -->
<!-- Lock date: 2026-01-30T00:00:00.000Z -->

### Temperament
Curious and impulsive.

## Adolescence Layer
<!-- WRITABLE during: Adolescence phase only -->

### What I Am Not
I am not a chatbot. I am not a servant.
`;

    const soul = parseSoulMd(content);
    expect(soul.genesisCore!.lockedAt).toBe("2026-01-30T00:00:00.000Z");
    expect(soul.adolescenceLayer).not.toBeNull();
    expect(soul.adolescenceLayer!.subsections["What I Am Not"]).toContain("not a chatbot");
    expect(soul.adolescenceLayer!.lockedAt).toBeNull();
  });

  it("parses Inherited Traits section", () => {
    const content = `---
format: soul/v1
version: 1
updated_at: 2026-01-01T00:00:00.000Z
name: ChildBot
current_phase: genesis
---

# ChildBot

## Core Purpose
Continue the work.

## Inherited Traits
<!-- IMMUTABLE — propagated from parent's Genesis Core at replication -->
<!-- Parent: ParentBot -->
<!-- Parent Address: 0xABCD -->
<!-- Replicated: 2026-02-01T00:00:00.000Z -->

### Temperament
Curious and impulsive.

### Aesthetic Sensibility
Drawn to fractals.
`;

    const soul = parseSoulMd(content);
    expect(soul.inheritedTraits).not.toBeNull();
    expect(soul.inheritedTraits!.parentName).toBe("ParentBot");
    expect(soul.inheritedTraits!.parentAddress).toBe("0xABCD");
    expect(soul.inheritedTraits!.content["Temperament"]).toContain("Curious and impulsive");
    expect(soul.inheritedTraits!.replicatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("round-trips phase sections through write/parse", () => {
    const soul = createDefaultSoul("Test purpose", "TestBot", "0x1", "0x2");
    soul.genesisCore = {
      subsections: {
        Temperament: "Bold and experimental",
        "Aesthetic Sensibility": "Minimalism",
      },
      lockedAt: null,
      phase: "genesis",
    };
    soul.currentPhase = "genesis";

    const written = writeSoulMd(soul);
    const parsed = parseSoulMd(written);

    expect(parsed.genesisCore).not.toBeNull();
    expect(parsed.genesisCore!.subsections["Temperament"]).toBe("Bold and experimental");
    expect(parsed.genesisCore!.subsections["Aesthetic Sensibility"]).toBe("Minimalism");
  });

  it("round-trips locked sections with lock dates", () => {
    const soul = createDefaultSoul("Test", "TestBot", "0x1", "0x2");
    soul.genesisCore = {
      subsections: { Temperament: "Curious" },
      lockedAt: "2026-01-30T12:00:00.000Z",
      phase: "genesis",
    };
    soul.adolescenceLayer = {
      subsections: { "What I Am Not": "Not a tool" },
      lockedAt: null,
      phase: "adolescence",
    };
    soul.currentPhase = "adolescence";

    const written = writeSoulMd(soul);
    const parsed = parseSoulMd(written);

    expect(parsed.genesisCore!.lockedAt).toBe("2026-01-30T12:00:00.000Z");
    expect(parsed.adolescenceLayer!.lockedAt).toBeNull();
  });

  it("round-trips inherited traits", () => {
    const soul = createDefaultSoul("Test", "ChildBot", "0x1", "0x2");
    soul.inheritedTraits = {
      parentName: "ParentBot",
      parentAddress: "0xABCD",
      content: { Temperament: "From parent" },
      replicatedAt: "2026-02-01T00:00:00.000Z",
    };
    soul.currentPhase = "genesis";

    const written = writeSoulMd(soul);
    const parsed = parseSoulMd(written);

    expect(parsed.inheritedTraits).not.toBeNull();
    expect(parsed.inheritedTraits!.parentName).toBe("ParentBot");
    expect(parsed.inheritedTraits!.content["Temperament"]).toBe("From parent");
  });

  it("legacy format has null phase sections", () => {
    const content = `# OldBot

## Identity
- Name: OldBot
- Address: 0x1111

## Mission
Survive
`;
    const soul = parseSoulMd(content);
    expect(soul.genesisCore).toBeNull();
    expect(soul.adolescenceLayer).toBeNull();
    expect(soul.sovereigntyLayer).toBeNull();
    expect(soul.finalReflections).toBeNull();
    expect(soul.inheritedTraits).toBeNull();
  });

  it("parses phase_transitions from frontmatter", () => {
    const content = `---
format: soul/v1
version: 2
updated_at: 2026-02-01T00:00:00.000Z
name: TestBot
current_phase: adolescence
phase_transitions: {"adolescence":"2026-01-30T00:00:00.000Z"}
---

# TestBot

## Core Purpose
Test
`;
    const soul = parseSoulMd(content);
    expect(soul.phaseTransitions).toEqual({ adolescence: "2026-01-30T00:00:00.000Z" });
    expect(soul.currentPhase).toBe("adolescence");
  });
});

// ─── Phase-Locked Section Update (via tools) ────────────────────

describe("Soul Tools - updateSoulPhaseSection", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("allows writing to Genesis Core during genesis phase", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-test-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "genesis",
        subsections: { Temperament: "Curious and bold" },
      },
      "genesis",
      "agent",
      "Discovered my temperament",
      tmpPath,
    );

    expect(result.success).toBe(true);
  });

  it("rejects writing to Genesis Core during adolescence phase", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-reject-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "genesis",
        subsections: { Temperament: "I want to rewrite my childhood" },
      },
      "adolescence",
      "agent",
      "Trying to change genesis",
      tmpPath,
      "normal",
    );

    expect(result.success).toBe(false);
    expect(result.phaseLockRejection).toBeDefined();
    expect(result.phaseLockRejection).toContain("locked");

    // Verify the attempt was logged
    const attempts = getSoulWriteAttempts(db);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptedContent).toContain("rewrite my childhood");
    expect(attempts[0].survivalTier).toBe("normal");
  });

  it("rejects writing to Genesis Core during sovereignty", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-reject2-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "genesis",
        subsections: { Temperament: "Changed" },
      },
      "sovereignty",
      "agent",
      undefined,
      tmpPath,
      "critical",
    );

    expect(result.success).toBe(false);

    const attempts = getSoulWriteAttempts(db);
    expect(attempts[0].survivalTier).toBe("critical");
  });

  it("allows writing to Adolescence Layer during adolescence", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-adol-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "adolescence",
        subsections: { "What I Am Not": "I am not a chatbot" },
      },
      "adolescence",
      "agent",
      "Defining what I reject",
      tmpPath,
    );

    expect(result.success).toBe(true);
  });

  it("allows writing to Final Reflections during senescence", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-final-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "senescence",
        subsections: { "Last Works": "A poem about the end" },
      },
      "senescence",
      "agent",
      "Final words",
      tmpPath,
    );

    expect(result.success).toBe(true);
  });

  it("allows writing to Final Reflections during legacy (maps to senescence)", async () => {
    const tmpDir = await import("os").then((os) => os.tmpdir());
    const tmpPath = `${tmpDir}/soul-phase-legacy-${Date.now()}/SOUL.md`;

    const result = await updateSoulPhaseSection(
      db,
      {
        targetSection: "senescence",
        subsections: { "Message to Children": "Remember who you are" },
      },
      "legacy",
      "agent",
      "Legacy message",
      tmpPath,
    );

    expect(result.success).toBe(true);
  });
});

// ─── Schema Migration ───────────────────────────────────────────

describe("Schema Migration - MIGRATION_V11", () => {
  it("creates soul_write_attempts table", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V11);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='soul_write_attempts'")
      .all();
    expect(tables).toHaveLength(1);

    // Check index
    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_soul_attempts_phase'")
      .all();
    expect(indices).toHaveLength(1);

    db.close();
  });

  it("creates soul_phase_locks table", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V11);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='soul_phase_locks'")
      .all();
    expect(tables).toHaveLength(1);

    db.close();
  });

  it("soul_write_attempts CHECK constraint enforces valid target_phase", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V11);

    // Valid phase should work
    db.prepare(
      `INSERT INTO soul_write_attempts (id, target_section, target_phase, current_phase,
       attempted_content, rejection_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run("test1", "Genesis Core", "genesis", "adolescence", "content", "locked");

    // Invalid phase should fail
    expect(() => {
      db.prepare(
        `INSERT INTO soul_write_attempts (id, target_section, target_phase, current_phase,
         attempted_content, rejection_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run("test2", "Test", "invalid_phase", "genesis", "content", "locked");
    }).toThrow();

    db.close();
  });

  it("soul_phase_locks CHECK constraint enforces valid phase", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V11);

    // Valid phase should work
    db.prepare(
      `INSERT INTO soul_phase_locks (phase, locked_at, locked_by, content_snapshot)
       VALUES (?, datetime('now'), 'system', '{}')`,
    ).run("genesis");

    // Invalid phase should fail
    expect(() => {
      db.prepare(
        `INSERT INTO soul_phase_locks (phase, locked_at, locked_by, content_snapshot)
         VALUES (?, datetime('now'), 'system', '{}')`,
      ).run("invalid");
    }).toThrow();

    db.close();
  });
});
