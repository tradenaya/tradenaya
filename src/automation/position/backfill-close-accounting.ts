import { db } from "@/lib/db";

/**
 * One-off backfill for the accounting columns added to automation_closed_trades
 * (gross_profit / commission / funding_fee). It recomputes gross profit from the
 * stored entry/exit prices and rounds, estimates a round-trip commission, and
 * leaves funding at 0 (live funding figures aren't recoverable historically here).
 *
 * Only rows that still have zero/NULL accounting are touched, so it never
 * overwrites rows already reconciled by the live close path.
 *
 * Run with your project's TS runner, e.g.: npx tsx src/automation/position/backfill-close-accounting.ts
 */
const RATE = 0.0005;

async function main(): Promise<void> {
  const [rows] = (await db.query(
    `SELECT id, side, entry_price, exit_price, position_size,
            gross_profit, commission, funding_fee
       FROM automation_closed_trades
      WHERE (gross_profit IS NULL OR gross_profit = 0)
         OR (commission IS NULL OR commission = 0);`,
  )) as [Array<Record<string, any>>, unknown];

  let updated = 0;
  for (const row of rows) {
    const entry = Number(row.entry_price);
    const exit = Number(row.exit_price);
    const qty = Number(row.position_size);
    if (!entry || !exit || !qty) continue;

    const gross = row.side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
    const commission = (entry * qty + exit * qty) * RATE;

    await db.query(
      `UPDATE automation_closed_trades
          SET gross_profit = ?, commission = ?, funding_fee = 0
        WHERE id = ?;`,
      [round(gross), round(commission), Number(row.id)],
    );
    updated += 1;
  }
  console.log(`Backfilled ${updated} closed-trade row(s).`);
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

main().catch((err) => {
  console.error("backfill failed", err);
  process.exitCode = 1;
});
