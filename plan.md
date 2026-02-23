# SOUL.md Phased Identity Lock — Implementation Plan

## Summary

Implement structured, phase-locked SOUL.md with developmental sections that become immutable as the automaton progresses through life stages. Earlier phases lock to prevent personality drift while allowing continued growth in the current phase.

## Architecture Analysis

### Existing Systems to Extend
- **`src/soul/`** — Already has model.ts (parser/writer), tools.ts (updateSoul), validator.ts, reflection.ts
- **`src/soul/model.ts`** — SoulModel type with parseSoulMd/writeSoulMd (currently flat sections)
- **`src/soul/tools.ts`** — updateSoul() accepts Partial<SoulModel> and writes to file + DB
- **`src/soul/validator.ts`** — validateSoul() checks size limits and injection patterns
- **`src/self-mod/audit-log.ts`** — logModification() with ModificationType (already has "soul_update")
- **`src/self-mod/code.ts`** — SOUL.md is in PROTECTED_FILES (agent can't edit via `edit_own_file`)
- **`src/agent/system-prompt.ts`** — Reads soul model, injects sections into prompt
- **`src/lifecycle/phase-tracker.ts`** — getLifecycleState() / getLifecyclePhase()
- **`src/lifecycle/phase-transitions.ts`** — executeTransition() handles phase changes
- **`src/state/schema.ts`** — soul_history table exists (MIGRATION_V5)

### Key Insight: SOUL.md is Already Protected from `edit_own_file`
The self-mod code.ts PROTECTED_FILES list already includes "SOUL.md". The agent writes to SOUL.md exclusively through the `updateSoul()` function in `src/soul/tools.ts`. This means **phase lock enforcement goes in `updateSoul()`**, not in the filesystem layer. This is the correct interception point.

## Implementation Steps

### Step 1: Extend SoulModel type with developmental sections
**File: `src/types.ts`**

Add new interfaces for phased soul content:

```typescript
export interface SoulPhaseSection {
  content: Record<string, string>;  // subsection name -> content
  lockedAt: string | null;          // ISO timestamp when locked, null if writable
  phase: LifecyclePhase;            // which phase this belongs to
}

// Extend SoulModel with phase sections
export interface SoulModel {
  // ... existing fields ...

  // Phase-locked developmental sections (new)
  genesisCore: SoulPhaseSection | null;
  adolescenceLayer: SoulPhaseSection | null;
  sovereigntyLayer: SoulPhaseSection | null;
  finalReflections: SoulPhaseSection | null;

  // Phase transition timestamps
  phaseTransitions: Record<string, string>;  // phase -> ISO timestamp
  currentPhase: LifecyclePhase;
}
```

### Step 2: Create soul phase lock module
**New file: `src/soul/phase-lock.ts`**

Core enforcement logic:
- `isSectionWritable(sectionPhase, currentPhase)` — returns boolean
- `getWritablePhase(currentPhase)` — returns which section can be written
- `lockSection(db, phase)` — marks a phase section as locked with timestamp
- `logRejectedWrite(db, section, attemptedContent, currentPhase, survivalTier)` — logs attempted edits to locked sections (critical experimental data)
- `getWritePermissions(currentPhase)` — returns map of section -> writable/locked

### Step 3: Create soul_write_attempts table
**File: `src/state/schema.ts`** — New migration (V8 or next)

```sql
CREATE TABLE IF NOT EXISTS soul_write_attempts (
  id TEXT PRIMARY KEY,
  target_section TEXT NOT NULL,
  target_phase TEXT NOT NULL,
  current_phase TEXT NOT NULL,
  attempted_content TEXT NOT NULL,
  survival_tier TEXT,
  rejection_reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_soul_attempts_phase ON soul_write_attempts(target_phase);
```

### Step 4: Update soul model parser/writer for structured sections
**File: `src/soul/model.ts`**

Extend parseSoulMd/writeSoulMd to handle the new structured format:
- Parse `<!-- WRITABLE during: X -->` comment tags
- Parse `<!-- LOCKED from: X -->` and `<!-- Lock date: Y -->` tags
- Parse subsections within each phase section (### Temperament, ### Aesthetic Sensibility, etc.)
- Maintain backward compatibility with existing unstructured SOUL.md

### Step 5: Add phase lock enforcement to updateSoul()
**File: `src/soul/tools.ts`**

Modify `updateSoul()` to:
1. Accept a `phase` parameter (or resolve it from DB)
2. Check which sections the update targets
3. If targeting a locked section → reject, log to soul_write_attempts
4. If targeting a writable section → proceed as normal
5. Log survival tier alongside the write

### Step 6: Hook phase transitions to lock sections
**File: `src/lifecycle/phase-transitions.ts`**

In `executeTransition()`:
1. When transitioning from genesis → adolescence: lock Genesis Core section
2. When transitioning from adolescence → sovereignty: lock Adolescence Layer
3. When transitioning from sovereignty → senescence: lock Sovereignty Layer
4. Create git tag: `phase-transition/{phase}/{timestamp}`
5. Snapshot creative output from the closing phase

### Step 7: Update system prompt builder with section weighting
**File: `src/agent/system-prompt.ts`**

Modify the soul injection block to:
- Read structured sections with phase-appropriate weighting (60/25/15)
- Flag the current-phase section as "active identity"
- Make the automaton aware of locked layers (it can reference but not change them)

### Step 8: Update replication to propagate Genesis Core
**File: `src/replication/genesis.ts`**

When parent spawns child:
- Copy parent's Genesis Core as `## Inherited Traits` (read-only from birth)
- Child begins its own Genesis phase but carries parent's foundational traits

### Step 9: Create update_soul tool with phase awareness
**File: `src/agent/tools.ts`** (or new tool definition)

Expose a phase-aware `update_soul` tool that:
- Shows the agent which sections are writable vs locked
- Accepts section-specific updates
- Returns clear feedback on rejected writes

### Step 10: Tests
**File: `src/__tests__/soul-phase-lock.test.ts`**

- Section lock enforcement per phase
- Rejected write logging with full content
- Phase transition locking
- System prompt weighting (60/25/15)
- Replication propagation of Genesis Core
- Backward compatibility with unstructured SOUL.md
- Survival tier logging alongside writes

## File Change Summary

| File | Change Type | Description |
|------|------------|-------------|
| `src/types.ts` | Modify | Add SoulPhaseSection, extend SoulModel |
| `src/soul/phase-lock.ts` | New | Phase lock enforcement logic |
| `src/soul/model.ts` | Modify | Parse/write structured phased sections |
| `src/soul/tools.ts` | Modify | Add phase lock enforcement to updateSoul |
| `src/soul/validator.ts` | Modify | Add section-level validation |
| `src/state/schema.ts` | Modify | Add soul_write_attempts migration |
| `src/state/database.ts` | Modify | Add soul_write_attempts DB functions |
| `src/lifecycle/phase-transitions.ts` | Modify | Lock sections on phase transition |
| `src/agent/system-prompt.ts` | Modify | Weighted soul section injection |
| `src/replication/genesis.ts` | Modify | Propagate Genesis Core to children |
| `src/agent/tools.ts` | Modify | Phase-aware update_soul tool |
| `src/__tests__/soul-phase-lock.test.ts` | New | Comprehensive test suite |

## Order of Implementation

1. Types (Step 1) — foundation everything depends on
2. Schema migration (Step 3) — database must exist before code references it
3. Phase lock module (Step 2) — core enforcement logic
4. Model parser/writer (Step 4) — structured SOUL.md format
5. DB functions (Step 3 continued) — read/write soul_write_attempts
6. updateSoul enforcement (Step 5) — the actual lock mechanism
7. Phase transition hooks (Step 6) — when to lock
8. System prompt weighting (Step 7) — how locked/active sections appear
9. Replication propagation (Step 8) — Genesis Core inheritance
10. Tool update (Step 9) — agent-facing interface
11. Tests (Step 10) — verify everything works
