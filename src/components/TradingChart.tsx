"use client";

import {
  createChart,
  ColorType,
  CandlestickSeries,
  UTCTimestamp,
  CandlestickData,
  IChartApi,
  ISeriesApi,
} from "lightweight-charts";

import { useEffect, useRef, useState } from "react";

import { futuresSocket, Candle } from "@/lib/coinswitch/futuresSocket";

// Available candle intervals, in minutes, as supported by the KLines API
const INTERVALS = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "1440" },
];

export default function TradingChart({ symbol }: { symbol: string }) {
  const chartContainer = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [interval, setInterval] = useState("5");

  useEffect(() => {
    if (!chartContainer.current) return;

    const chart = createChart(chartContainer.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#09090b" },
        textColor: "#ffffff",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      rightPriceScale: { minimumWidth: 90 },
      width: chartContainer.current.clientWidth,
      height: 450,
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    chartRef.current = chart;

    const candlestick = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
      // Give the *series* the "LIVE" title so the built-in, genuinely-live
      // last-value price line carries the label — instead of a separate
      // static manual price line that never updates.
    //   title: "LIVE",
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#22c55e",
      priceLineWidth: 2,
      priceLineStyle: 2, // 0 = solid, 1 = dotted, 2 = dashed
    });

    seriesRef.current = candlestick;

    async function loadCandles() {
      try {
        const res = await fetch(
          `/api/coinswitch/futures/kline?symbol=${symbol}&interval=${interval}`,
          { cache: "no-store" }
        );
        const json = await res.json();

        if (!json.success) return;

        const candles: CandlestickData<UTCTimestamp>[] = json.data
          .map((candle: any) => ({
            time: (Number(candle.start_time) / 1000) as UTCTimestamp,
            open: Number(candle.o),
            high: Number(candle.h),
            low: Number(candle.l),
            close: Number(candle.c),
          }))
          .filter(
            (c: any) =>
              Number.isFinite(c.open) &&
              Number.isFinite(c.high) &&
              Number.isFinite(c.low) &&
              Number.isFinite(c.close)
          )
          .sort(
            (a: CandlestickData<UTCTimestamp>, b: CandlestickData<UTCTimestamp>) =>
              Number(a.time) - Number(b.time)
          );

        candlestick.setData(candles);
        chart.timeScale().fitContent();
        // No manual createPriceLine here anymore — the series' own
        // built-in price line (title: "LIVE" above) already shows this,
        // and it will actually move on every WebSocket update.
      } catch (error) {
        console.log("CHART ERROR", error);
      }
    }

    loadCandles();

    futuresSocket.connect(symbol, interval, (candle: Candle) => {
      // Guard against stray pushes from a previous subscription
      // (e.g. right after switching interval/symbol) leaking through.
      if (candle.s !== symbol || candle.i !== interval) return;

      const liveCandle = {
        time: (candle.t / 1000) as UTCTimestamp,
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
      };

      if (!Number.isFinite(liveCandle.close)) return;

      candlestick.update(liveCandle);
      chart.timeScale().scrollToRealTime();
    });

    return () => {
      // stop feeding updates to this (about-to-be-destroyed) series
      futuresSocket.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, interval]);

  return (
    <div className="w-full">
      <div className="flex gap-2 mb-2">
        {INTERVALS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setInterval(opt.value)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              interval === opt.value
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        ref={chartContainer}
        className="w-full h-[450px] rounded-xl overflow-hidden"
      />
    </div>
  );
}