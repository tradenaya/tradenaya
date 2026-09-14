export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: string;
}

/** Normalized 24h ticker for a symbol, produced by the market-data layer. */
export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  high24h: number | null;
  low24h: number | null;
  openPrice: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  changePct24h: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  exchangeTimestamp: number | null;
  receivedAt: number;
  source: "websocket" | "rest";
}

export interface MarketSnapshot {
  symbol: string;
  exchange: string;
  timestamp: number;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  candles: Record<string, MarketCandle[]>;
  /** 24h high when the data source provides it. */
  high24h?: number;
  /** 24h low when the data source provides it. */
  low24h?: number;
  /** 24h quote volume when the data source provides it. */
  volume24h?: number;
  /** Timestamp reported by the exchange, when available. */
  exchangeTimestamp?: number;
  /** Server receive timestamp for this snapshot. */
  receivedAt?: number;
  /** Which source produced this snapshot: "websocket" | "rest" | "cache". */
  dataSource?: "websocket" | "rest" | "cache";
  /** FRESH | STALE | UNAVAILABLE */
  isFresh?: "FRESH" | "STALE" | "UNAVAILABLE";
}

export interface IndicatorBundle {
  /** Latest EMA(20) value. Kept for backward compatibility. */
  ema?: number | number[];
  /** Latest SMA(50) value. Kept for backward compatibility. */
  sma?: number | number[];
  ema20?: number;
  ema50?: number;
  ema200?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema12?: number;
  ema26?: number;
  rsi?: number;
  macd?: { macd?: number; signal?: number; histogram?: number };
  adx?: number;
  atr?: number;
  /** ATR as a percentage of the latest close. */
  atrPct?: number;
  vwap?: number;
  bollinger?: { upper?: number; middle?: number; lower?: number };
  supertrend?: { direction?: number; value?: number };
  volume?: { current?: number; average?: number; ratio?: number };
  /** 14-period rate of change (%). */
  roc14?: number;
  /** 50-period rate of change (%). */
  roc50?: number;
  /** Richer technical indicators from the external TA library. */
  ta?: {
    stochRsiK?: number;
    stochRsiD?: number;
    cci?: number;
    mfi?: number;
    obv?: number;
    obvSlope?: number;
    williamsR?: number;
    psar?: number;
    pdi?: number;
    mdi?: number;
    keltnerUpper?: number;
    keltnerMiddle?: number;
    keltnerLower?: number;
    ichimokuConversion?: number;
    ichimokuBase?: number;
    ichimokuSpanA?: number;
    ichimokuSpanB?: number;
    patterns?: string[];
  };
}
