import { io, Socket } from "socket.io-client";

export interface TickerData {
  s: string;
  e: string;
  E: number;
  o: string;
  h: string;
  l: string;
  c: string;
  bv: string;
  qv: string;
  P: string;
  b: string;
  a: string;
  T: number;
  p: number;
  i: number;
  r: number;
  oi: string;
  oiv: string;
  bs: string;
  as: string;
}

class FuturesTickerSocket {
  private socket: Socket | null = null;
  private desiredSymbol: string | null = null;
  private currentSymbol: string | null = null;
  private onTickerCallback: ((data: TickerData) => void) | null = null;

  connect(symbol: string, onTicker: (data: TickerData) => void) {
    this.desiredSymbol = symbol;
    this.onTickerCallback = onTicker;

    if (!this.socket) {
      this.socket = io("wss://ws.coinswitch.co/exchange_2", {
        path: "/pro/realtime-rates-socket/futures/exchange_2",
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
      });

      this.socket.on("connect", () => {
        this.currentSymbol = null;
        if (this.desiredSymbol) this.subscribe(this.desiredSymbol);
      });

      this.socket.on("disconnect", () => {
        this.currentSymbol = null;
      });

      this.socket.on("connect_error", (err) => {
        console.log("❌ Ticker WS error", err.message);
      });

      this.socket.on("FETCH_TICKER_INFO_CS_PRO", (payload: Record<string, TickerData>) => {
        if (!this.desiredSymbol) return;
        const data = payload[this.desiredSymbol];
        if (data) this.onTickerCallback?.(data);
      });
    } else if (this.socket.connected) {
      this.subscribe(symbol);
    }

    return this.socket;
  }

  private subscribe(symbol: string) {
    if (!this.socket?.connected) return;
    if (this.currentSymbol === symbol) return;

    this.currentSymbol = symbol;
    this.socket.emit("FETCH_TICKER_INFO_CS_PRO", {
      event: "subscribe",
      pair: symbol,
    });
  }


  disconnect() {
    this.onTickerCallback = null;
  }
}

export const futuresTickerSocket = new FuturesTickerSocket();