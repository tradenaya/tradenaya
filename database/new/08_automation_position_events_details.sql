-- NEW column: automation_position_events.details
-- JSON facts behind an event, e.g. a stop-loss move: old / new level, market price
-- at the time, the rule that moved it, the exchange order placed (and its status)
-- and whether the old stop order was cancelled. Shown as proof in the
-- "Stop-loss & target · history and proof" panel.
-- The app adds this automatically (PositionStore.ensureEventsTable) when the column is missing.
ALTER TABLE automation_position_events ADD COLUMN details TEXT NULL;

-- automation_positions.trailing_activated (existing column) is now set to 1 when a
-- Trend Breakout trade reaches +1.5R and its trailing stop is switched on.
