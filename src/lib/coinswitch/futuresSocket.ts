import { io, Socket } from "socket.io-client";

export interface Candle {
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  q: string;
  s: string;   // symbol, e.g. "DOGEUSDT"
  i: string;   // interval in minutes, e.g. "5"
  x: boolean;  // true when this candle is closed/final
  t: number;   // candle start time (ms)
  T: number;   // candle close time (ms)
  ts: number;  // time of most recent trade in this candle (ms)
}

class FuturesSocket {
  private socket: Socket | null = null;

  // pair the server currently thinks we're subscribed to
  private currentPair: string | null = null;

  // pair the *active* chart wants (updated on every connect() call)
  private desiredPair: string | null = null;

  // callback for the *active* chart only — always kept up to date,
  // this is what avoids the stale-closure bug across remounts/interval switches
  private onCandleCallback: ((candle: Candle) => void) | null = null;

  connect(
    symbol: string,
    interval: string,
    onCandle: (candle: Candle) => void
  ) {
    const pair = `${symbol}_${interval}`;

    // Always point at the latest caller's callback and desired pair,
    // even if the underlying socket already exists.
    this.desiredPair = pair;
    this.onCandleCallback = onCandle;

    if (!this.socket) {
      console.log("🚀 Starting Futures WebSocket connection");

      this.socket = io("wss://ws.coinswitch.co/exchange_2", {
        path: "/pro/realtime-rates-socket/futures/exchange_2",
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
      });

      this.socket.on("connect", () => {
        console.log("✅ Futures WebSocket Connected", this.socket?.id);
        // fresh connection means the server has forgotten any
        // previous subscription, so force a resubscribe
        this.currentPair = null;
        if (this.desiredPair) this.subscribe(this.desiredPair);
      });

      this.socket.on("connect_error", (error) => {
        console.log("❌ WebSocket Error", error.message);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("⚠️ WebSocket Disconnected", reason);
        this.currentPair = null;
      });

      // ONE permanent listener for the lifetime of the socket.
      // Always forwards to whichever callback is currently registered.
      this.socket.on("FETCH_CANDLESTICK_CS_PRO", (data: Candle) => {
        this.onCandleCallback?.(data);
      });
    } else if (this.socket.connected) {
      this.subscribe(pair);
    }
    // if the socket exists but isn't connected yet, the "connect"
    // handler above will subscribe once it comes back online.

    return this.socket;
  }

  private subscribe(pair: string) {
    if (!this.socket?.connected) {
      console.log("⏳ Socket not connected yet");
      return;
    }

    if (this.currentPair === pair) {
      return;
    }

    this.currentPair = pair;

    this.socket.emit("FETCH_CANDLESTICK_CS_PRO", {
      event: "subscribe",
      pair,
    });

    console.log("📡 Kline subscription sent", pair);
  }

  // Call this when a chart unmounts (or before switching symbol/interval)
  // so stale/removed candlestick series stop being fed updates.
  // The socket itself stays alive and gets reused by the next chart.
  disconnect() {
    this.onCandleCallback = null;
  }
}

export const futuresSocket = new FuturesSocket();