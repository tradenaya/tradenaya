import { PositionStore } from "@/automation/position/PositionStore";
import { ExecutionStore } from "@/automation/executor/store";

export async function ensureTables() {
  const positionStore = new PositionStore();
  const executionStore = new ExecutionStore();
  await positionStore.ensureTable();
  await positionStore.ensureEventsTable();
  await positionStore.ensureCloseTable();
  await executionStore.ensureTable();
  await executionStore.ensureNotificationTable();
}
