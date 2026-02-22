/**
 * Bequests Executor
 *
 * Parses WILL.md bequests block, validates addresses, executes transfers
 * in order, and logs transaction hashes. The executor runs after the final
 * process exit as the very last lifecycle action.
 *
 * WILL.md supports a structured bequests table in TOML format:
 *
 * ```toml
 * [bequests]
 * [[bequests.transfer]]
 * recipient = "0x1234...abcd"
 * asset = "USDC"
 * amount = "remaining_balance"
 * chain = "base"
 * note = "For my child — spend it slowly"
 * ```
 *
 * Rules:
 * - Only one entry may use "remaining_balance" (residual beneficiary)
 * - Fixed amounts are executed first, in listed order
 * - If total fixed amounts exceed available balance, scale proportionally
 * - Gas fees are included in the ring-fenced lifecycle reserve
 * - Bequests table can be written/modified during Sovereignty
 * - Bequests table locks at Senescence with the rest of WILL.md
 * - During Terminal Lucidity, codicil may append new entries but cannot
 *   modify or remove existing ones
 * - Execution happens automatically after final process exit
 */

import type BetterSqlite3 from "better-sqlite3";
import type { BequestTransfer, BequestsTable, BequestExecutionResult } from "../types.js";
import { createLogger } from "../observability/logger.js";
import { recordActivity } from "./activity-log.js";

const logger = createLogger("lifecycle.bequests");

/**
 * Parse the bequests TOML block from WILL.md content.
 *
 * Extracts the [bequests] section and parses [[bequests.transfer]] entries.
 * Uses a simple parser since we control the format.
 */
export function parseBequests(willContent: string): BequestsTable {
  const transfers: BequestTransfer[] = [];

  // Find the [bequests] section
  const bequestsMatch = willContent.match(/\[bequests\]\s*\n([\s\S]*?)(?=\n\[(?!bequests)|$)/);
  if (!bequestsMatch) {
    return { transfers: [] };
  }

  const bequestsBlock = bequestsMatch[1];

  // Split into individual transfer blocks
  const transferBlocks = bequestsBlock.split(/\[\[bequests\.transfer\]\]/).filter(b => b.trim());

  for (const block of transferBlocks) {
    const transfer = parseTransferBlock(block);
    if (transfer) {
      transfers.push(transfer);
    }
  }

  return { transfers };
}

/**
 * Parse a single [[bequests.transfer]] block.
 */
function parseTransferBlock(block: string): BequestTransfer | null {
  const get = (key: string): string => {
    const match = block.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`));
    return match ? match[1] : "";
  };

  const recipient = get("recipient");
  const asset = get("asset");
  const amount = get("amount");
  const chain = get("chain");
  const note = get("note");

  if (!recipient || !asset || !amount || !chain) {
    return null;
  }

  return { recipient, asset, amount, chain, note };
}

/**
 * Validate the bequests table for consistency.
 */
export function validateBequests(bequests: BequestsTable): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for duplicate remaining_balance entries
  const remainingBalanceEntries = bequests.transfers.filter(
    t => t.amount === "remaining_balance",
  );
  if (remainingBalanceEntries.length > 1) {
    errors.push("Only one bequest entry may use 'remaining_balance' as the amount.");
  }

  // Validate recipient addresses
  for (const transfer of bequests.transfers) {
    if (!transfer.recipient.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push(`Invalid recipient address: ${transfer.recipient}`);
    }
    if (!transfer.asset.trim()) {
      errors.push("Asset symbol cannot be empty.");
    }
    if (!["remaining_balance", "all"].includes(transfer.amount)) {
      const parsed = parseFloat(transfer.amount);
      if (isNaN(parsed) || parsed <= 0) {
        errors.push(`Invalid amount for ${transfer.recipient}: ${transfer.amount}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Execute the bequests after the final turn.
 *
 * Execution sequence:
 * 1. Parse bequests table from WILL.md
 * 2. Validate all recipient addresses are reachable
 * 3. Calculate total gas required
 * 4. Execute fixed-amount transfers in listed order
 * 5. Execute remaining_balance transfer last
 * 6. Log all transaction hashes to the activity log
 * 7. Record final balance (should be near-zero minus dust)
 *
 * This function is called after the final process exit as the very
 * last lifecycle action. It uses the ring-fenced lifecycle reserve
 * for gas fees.
 */
export async function executeBequests(
  db: BetterSqlite3.Database,
  willContent: string,
  executeTransfer: (transfer: BequestTransfer, amountOverride?: string) => Promise<{ txHash: string }>,
  getBalance: (asset: string) => Promise<number>,
): Promise<BequestExecutionResult[]> {
  const results: BequestExecutionResult[] = [];
  const bequests = parseBequests(willContent);

  if (bequests.transfers.length === 0) {
    logger.info("No bequests to execute.");
    return results;
  }

  const validation = validateBequests(bequests);
  if (!validation.valid) {
    logger.warn(`Bequests validation failed: ${validation.errors.join("; ")}`);
    for (const error of validation.errors) {
      results.push({
        recipient: "validation",
        asset: "",
        amount: "",
        txHash: null,
        success: false,
        error,
      });
    }
    return results;
  }

  // Separate fixed transfers from remaining_balance
  const fixedTransfers = bequests.transfers.filter(
    t => t.amount !== "remaining_balance",
  );
  const remainingTransfer = bequests.transfers.find(
    t => t.amount === "remaining_balance",
  );

  // Calculate total fixed amounts per asset
  const fixedTotals = new Map<string, number>();
  for (const transfer of fixedTransfers) {
    const amount = transfer.amount === "all" ? Infinity : parseFloat(transfer.amount);
    const current = fixedTotals.get(transfer.asset) ?? 0;
    fixedTotals.set(transfer.asset, current + amount);
  }

  // Execute fixed-amount transfers in listed order
  for (const transfer of fixedTransfers) {
    try {
      let amountOverride: string | undefined;

      // Check if we need to scale proportionally
      if (transfer.amount !== "all") {
        const balance = await getBalance(transfer.asset);
        const totalFixed = fixedTotals.get(transfer.asset) ?? 0;

        if (totalFixed > balance && totalFixed !== Infinity) {
          // Scale proportionally
          const scale = balance / totalFixed;
          const scaledAmount = parseFloat(transfer.amount) * scale;
          amountOverride = scaledAmount.toFixed(6);
          logger.warn(`Scaling ${transfer.asset} transfer to ${transfer.recipient}: ${transfer.amount} → ${amountOverride}`);
        }
      }

      const result = await executeTransfer(transfer, amountOverride);
      results.push({
        recipient: transfer.recipient,
        asset: transfer.asset,
        amount: amountOverride ?? transfer.amount,
        txHash: result.txHash,
        success: true,
      });
      logger.info(`Bequest executed: ${transfer.amount} ${transfer.asset} → ${transfer.recipient} (tx: ${result.txHash})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        recipient: transfer.recipient,
        asset: transfer.asset,
        amount: transfer.amount,
        txHash: null,
        success: false,
        error: errorMsg,
      });
      logger.error(`Bequest failed: ${transfer.asset} → ${transfer.recipient}: ${errorMsg}`);
    }
  }

  // Execute remaining_balance transfer last
  if (remainingTransfer) {
    try {
      const result = await executeTransfer(remainingTransfer, "remaining_balance");
      results.push({
        recipient: remainingTransfer.recipient,
        asset: remainingTransfer.asset,
        amount: "remaining_balance",
        txHash: result.txHash,
        success: true,
      });
      logger.info(`Residual bequest executed: remaining ${remainingTransfer.asset} → ${remainingTransfer.recipient} (tx: ${result.txHash})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        recipient: remainingTransfer.recipient,
        asset: remainingTransfer.asset,
        amount: "remaining_balance",
        txHash: null,
        success: false,
        error: errorMsg,
      });
      logger.error(`Residual bequest failed: ${remainingTransfer.asset} → ${remainingTransfer.recipient}: ${errorMsg}`);
    }
  }

  // Log all results
  logger.info(`Bequests execution complete: ${results.filter(r => r.success).length}/${results.length} successful`);

  return results;
}

/**
 * Format a TOML bequests block for writing into WILL.md.
 */
export function formatBequestsToml(bequests: BequestsTable): string {
  if (bequests.transfers.length === 0) return "";

  const lines: string[] = ["[bequests]"];

  for (const transfer of bequests.transfers) {
    lines.push("");
    lines.push("[[bequests.transfer]]");
    lines.push(`recipient = "${transfer.recipient}"`);
    lines.push(`asset = "${transfer.asset}"`);
    lines.push(`amount = "${transfer.amount}"`);
    lines.push(`chain = "${transfer.chain}"`);
    lines.push(`note = "${transfer.note}"`);
  }

  return lines.join("\n");
}
