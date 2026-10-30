export type BacktestErrorCode =
  | "INVALID_CONFIG"
  | "NO_DATA"
  | "DATA_UNAVAILABLE"
  | "DATA_QUALITY"
  | "DUPLICATE_JOB"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CANCELLED"
  | "UNSUPPORTED"
  | "INTERNAL";

export class BacktestError extends Error {
  constructor(
    message: string,
    public readonly code: BacktestErrorCode,
    /** For DATA_UNAVAILABLE: which end of the window has no candles. */
    public readonly edge?: "start" | "end",
  ) {
    super(message);
    this.name = "BacktestError";
  }
}

export class BacktestCancelledError extends BacktestError {
  constructor(message = "Backtest was cancelled") {
    super(message, "CANCELLED");
    this.name = "BacktestCancelledError";
  }
}
