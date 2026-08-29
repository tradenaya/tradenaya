import { PositionStore } from "@/automation/position/PositionStore";
import { ExecutionStore } from "@/automation/executor/store";
import { ensureTelegramSentTable } from "@/lib/telegram-dispatch";

export async function ensureTables() {
  const positionStore = new PositionStore();
  const executionStore = new ExecutionStore();
  await positionStore.ensureTable();
  await positionStore.ensureEventsTable();
  await positionStore.ensureCloseTable();
  await executionStore.ensureTable();
  await executionStore.ensureNotificationTable();
  await ensureTelegramSentTable().catch((e) => console.error("Telegram dedupe table init failed (non-fatal)", e));
}
