"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getCurrencyState } from "@/lib/currency/store";

export interface ConvertStatusData {
  inrAvailable: number;
  usdtSpot: number;
  futuresUsdt: { total: number; available: number } | null;
  inrRate: number | null;
  rateSource: string | null;
  minInr: number | null;
  spotAccess: boolean;
  errors?: { spot?: string; futures?: string };
}

export interface ConvertResultData {
  amountInr: number;
  inrSpent: number;
  usdtReceived: number;
  rate: number;
  fee: number | null;
  orderId?: string;
  status?: string;
  note?: string;
}

export function formatInr(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: decimals })}`;
}

export function formatUsdt(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: decimals })} USDT`;
}

async function requestConvertStatus(): Promise<ConvertStatusData> {
  const res = await fetch("/api/coinswitch/convert/status", { cache: "no-store" });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Failed to load your CoinSwitch balance");
  return json.data as ConvertStatusData;
}

/** Latest displayed INR rate, refreshed each time the dialog opens. */
const inrRateCache: { rate: number | null } = { rate: null };

const inrRateLabels: Record<string, string> = {
  depth: "live order book",
  coinswitch: "CoinSwitch spot",
  cross: "BTC cross rate",
  coingecko: "CoinGecko (public feed)",
};

export function ConvertInrToUsdtDialog({
  open,
  onOpenChange,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (data?: ConvertResultData) => void;
}) {
  const [status, setStatus] = useState<ConvertStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [amount, setAmount] = useState("");
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConvertResultData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResult(null);
    setError("");

    (async () => {
      setStatusLoading(true);
      setStatusError("");
      try {
        const data = await requestConvertStatus();
        if (!cancelled) {
          setStatus(data);
          if (data.inrRate != null && data.inrRate > 0) inrRateCache.rate = data.inrRate;
        }
      } catch (err: unknown) {
        if (!cancelled) setStatusError(err instanceof Error ? err.message : "Failed to load your CoinSwitch balance");
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const rate = status?.inrRate ?? getCurrencyState().inrRate;
  const estimateUsdt = amountValid && rate != null && rate > 0 ? amountNum / rate : null;
  const overBalance =
    status != null && amountValid && amountNum > status.inrAvailable + 0.0001;
  const canConvert =
    amountValid &&
    amountNum >= (status?.minInr ?? 0) &&
    !overBalance &&
    status?.spotAccess !== false &&
    !converting;

  const maxInr = Math.max(0, status?.inrAvailable ?? 0);

  async function doConvert() {
    if (!amountValid) {
      setError("Enter how much INR you want to convert.");
      return;
    }
    setConverting(true);
    setError("");
    try {
      const res = await fetch("/api/coinswitch/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInr: amountNum }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Conversion failed — please try again.");
      setResult(json.data as ConvertResultData);
      onConverted?.(json.data as ConvertResultData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Conversion failed — please try again.");
    } finally {
      setConverting(false);
    }
  }

  const close = () => {
    if (!converting) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-amber-400" />
            Convert INR to USDT
          </DialogTitle>
          <DialogDescription>
            Buy USDT at the current market price using the INR sitting in your CoinSwitch wallet.
            Your bots trade in USDT — converting INR fills your trading balance.
          </DialogDescription>
        </DialogHeader>

        {statusLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ) : statusError ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400">{statusError}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">INR in your wallet</div>
                <div className="font-semibold tabular-nums text-amber-300">{formatInr(maxInr)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">USDT in Futures wallet</div>
                <div className="font-semibold tabular-nums text-emerald-400">
                  {status?.futuresUsdt ? formatUsdt(status.futuresUsdt.available, 2) : "—"}
                </div>
              </div>
            </div>

            {status?.spotAccess === false && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Your CoinSwitch API key does not include Spot (INR) trading permission. Enable
                  Spot trading under CoinSwitch PRO → API Trading → Permissions, or reconnect with a
                  key that has spot access.
                </span>
              </p>
            )}

            {result ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Conversion complete
                  </div>
                  <div className="mt-2 text-lg font-bold text-foreground">
                    {formatInr(result.inrSpent)} → {formatUsdt(result.usdtReceived, 4)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Rate {formatInr(result.rate, 2)} per USDT
                    {result.fee != null && result.fee > 0 ? ` · fee ${formatUsdt(result.fee, 4)}` : ""}
                  </div>
                </div>

                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  {result.note ??
                    "USDT is in your CoinSwitch exchange wallet. Move it to your Futures wallet in CoinSwitch PRO → Wallet → Transfer so your bots can trade with it."}
                </p>

                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setResult(null);
                      setAmount("");
                      void requestConvertStatus()
                        .then(setStatus)
                        .catch(() => undefined);
                    }}
                  >
                    Convert more
                  </Button>
                  <Button onClick={close}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Amount in INR (₹)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 500"
                        className="pl-7"
                        disabled={converting || status?.spotAccess === false}
                      />
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      className="shrink-0"
                      disabled={converting || maxInr <= 0 || status?.spotAccess === false}
                      onClick={() => setAmount(String(maxInr))}
                    >
                      Max
                    </Button>
                  </div>
                  {overBalance && (
                    <p className="mt-1.5 text-xs text-red-400">
                      That's more than the {formatInr(maxInr)} you have — max is {formatInr(maxInr)}.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">You'll get approximately</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {estimateUsdt != null ? (
                      formatUsdt(estimateUsdt, 4)
                    ) : (
                      <span className="text-xs text-muted-foreground">live price…</span>
                    )}
                  </span>
                </div>

                {rate != null && (
                  <p className="text-xs text-muted-foreground">
                    At market rate {formatInr(rate, 2)} per USDT. Converted USDT lands in your
                    CoinSwitch exchange wallet.
                  </p>
                )}

                {status?.minInr != null && maxInr > 0 && maxInr < status.minInr && (
                  <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    <span>
                      CoinSwitch's minimum conversion is {formatInr(status.minInr)}, but your wallet
                      has {formatInr(maxInr)}. Add INR from the CoinSwitch app and refresh.
                    </span>
                  </p>
                )}

                {error && <p className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400">{error}</p>}

                <DialogFooter>
                  <Button variant="ghost" onClick={close} disabled={converting}>
                    Cancel
                  </Button>
                  <Button
                    onClick={doConvert}
                    disabled={!canConvert}
                    className={cn(
                      converting
                        ? "opacity-70"
                        : canConvert
                          ? "bg-amber-500 text-black hover:bg-amber-400"
                          : "",
                    )}
                  >
                    {converting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {converting ? "Converting…" : "Convert INR to USDT"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Self-contained trigger button that opens the conversion dialog. */
export function ConvertInrToUsdtButton({
  children,
  variant,
  size,
  className,
  label = "Convert INR to USDT",
  onConverted,
}: {
  children?: React.ReactNode;
  variant?: "outline" | "default" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg";
  className?: string;
  label?: string;
  onConverted?: (data?: ConvertResultData) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant ?? "outline"} size={size ?? "sm"} className={className} onClick={() => setOpen(true)}>
        {children ?? (
          <>
            <ArrowLeftRight className="h-4 w-4" /> {label}
          </>
        )}
      </Button>
      <ConvertInrToUsdtDialog open={open} onOpenChange={setOpen} onConverted={onConverted} />
    </>
  );
}

/**
 * Small, subtle hint that INR is sitting idle: one muted line with an inline
 * "Convert to USDT" hyperlink. Self-fetches conversion status once on mount and
 * after each convert, and hides itself when there is no INR to convert.
 */
export function ConvertInrToUsdtBanner({
  onConverted,
  className,
}: {
  onConverted?: (data?: ConvertResultData) => void;
  className?: string;
}) {
  const [status, setStatus] = useState<ConvertStatusData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setError("");
      const data = await requestConvertStatus();
      setStatus(data);
      if (data.inrRate != null && data.inrRate > 0) inrRateCache.rate = data.inrRate;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load balance");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const inr = status?.inrAvailable ?? 0;
  if (error || status == null || inr <= 0) return null;

  const rate = inrRateCache.rate ?? status?.inrRate ?? null;
  const inrUsdt = rate != null && rate > 0 ? inr / rate : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>
        You have <span className="font-medium text-foreground">{formatInr(inr)}</span>
        {inrUsdt != null && (
          <span className="text-muted-foreground"> (≈ {formatUsdt(inrUsdt)})</span>
        )}{" "}
        in INR — it sits idle because bots trade in USDT.
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline font-medium text-amber-400 underline underline-offset-2 transition-colors hover:text-amber-300"
      >
        Convert to USDT
      </button>
      <ConvertInrToUsdtDialog
        open={open}
        onOpenChange={setOpen}
        onConverted={(data) => {
          void refresh();
          onConverted?.(data);
        }}
      />
    </div>
  );
}