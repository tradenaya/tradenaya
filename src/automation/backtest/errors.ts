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
