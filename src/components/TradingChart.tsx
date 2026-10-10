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
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { fetchData } from "@/lib/api-client";

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
  const [candleState, setCandleState] = useState<"loading" | "ready" | "error">("loading");
  const [candleError, setCandleError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!chartContainer.current) return;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setCandleState("loading");
      setCandleError(null);
    });

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
      height: Math.min(450, Math.max(280, chartContainer.current.clientWidth * 0.62)),
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
        const data = await fetchData<Record<string, unknown>[]>(`/api/coinswitch/futures/kline?symbol=${symbol}&interval=${interval}`);
        if (disposed) return;

        const candles: CandlestickData<UTCTimestamp>[] = (Array.isArray(data) ? data : [])
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
        setCandleState("ready");
      } catch (error) {
        if (disposed) return;
        setCandleError(error);
        setCandleState("error");
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
      disposed = true;
      // stop feeding updates to this (about-to-be-destroyed) series
      futuresSocket.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, interval, reloadKey]);

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2 mb-2">
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

      <div className="relative">
        <div
          ref={chartContainer}
          className="w-full h-[280px] sm:h-[360px] lg:h-[450px] rounded-xl overflow-hidden"
        />
        {candleState === "loading" && (
          <div className="absolute inset-0 flex items-end gap-1.5 rounded-xl bg-[#09090b] p-6" aria-busy="true" aria-label="Loading chart">
            {[38, 55, 47, 62, 58, 70, 52, 66, 74, 61, 80, 69, 76, 64, 72].map((h, i) => (
              <Skeleton key={i} className="flex-1 bg-zinc-800" style={{ height: `${h}%` }} />
            ))}
          </div>
        )}
        {candleState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#09090b]/95 p-4">
            <ErrorState
              error={candleError}
              title={`Couldn't load ${symbol} candles`}
              onRetry={() => setReloadKey((k) => k + 1)}
              className="w-full max-w-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
}