"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

type PriceEntry = { price: number; bestBid: number; bestAsk: number };

const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "POL", "DOT", "SHIB"];

export function useLivePrices() {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});

  useEffect(() => {
    const socket = io("https://ws.coinswitch.co/coinswitchx", {
      path: "/pro/realtime-rates-socket/spot",
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      COINS.forEach((coin) => {
        const pair = `${coin},INR`;
        socket.emit("FETCH_ORDER_BOOK_CS_PRO", { event: "subscribe", pair });
        socket.emit("FETCH_TRADES_CS_PRO", { event: "subscribe", pair });
      });
    });

    socket.on("FETCH_ORDER_BOOK_CS_PRO", (data) => {
      if (!data?.s) return;
      const coin = data.s.split(",")[0];
      const bestBid = parseFloat(data.bids?.[0]?.[0] ?? "0");
      const bestAsk = parseFloat(data.asks?.[0]?.[0] ?? "0");
      if (!bestBid || !bestAsk) return;

      setPrices((prev) => ({
        ...prev,
        [coin]: { price: prev[coin]?.price ?? (bestBid + bestAsk) / 2, bestBid, bestAsk },
      }));
    });

    socket.on("FETCH_TRADES_CS_PRO", (data) => {
      if (!data?.s) return;
      const coin = data.s.split(",")[0];
      setPrices((prev) => ({
        ...prev,
        [coin]: { ...(prev[coin] ?? { bestBid: 0, bestAsk: 0 }), price: parseFloat(data.p) },
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return prices;
}