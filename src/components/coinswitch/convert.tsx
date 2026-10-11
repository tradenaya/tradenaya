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
import { ErrorState } from "@/components/ui/error-state";
import { fetchData } from "@/lib/api-client";

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

export type ConvertDirection = "INR_TO_USDT" | "USDT_TO_INR";

export interface ConvertResultData {
  direction?: ConvertDirection;
  /** INR → USDT */
  amountInr?: number;
  inrSpent?: number;
  usdtReceived?: number;
  /** USDT → INR */
  amountUsdt?: number;
  usdtSold?: number;
  inrReceived?: number;
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
  return fetchData<ConvertStatusData>("/api/coinswitch/convert/status");
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
  initialDirection = "INR_TO_USDT",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (data?: ConvertResultData) => void;
  initialDirection?: ConvertDirection;
}) {
  const [direction, setDirection] = useState<ConvertDirection>(initialDirection);
  const [status, setStatus] = useState<ConvertStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [amount, setAmount] = useState("");
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConvertResultData | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    setDirection(initialDirection);
    setAmount("");

    (async () => {
      setStatusLoading(true);
      setStatusError(null);
      try {
        const data = await requestConvertStatus();
        if (!cancelled) {
          setStatus(data);
          if (data.inrRate != null && data.inrRate > 0) inrRateCache.rate = data.inrRate;
        }
      } catch (err: unknown) {
        if (!cancelled) setStatusError(err);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDirection]);

  const selling = direction === "USDT_TO_INR";
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const maxInr = Math.max(0, status?.inrAvailable ?? 0);
  const maxUsdt = Math.max(0, status?.usdtSpot ?? 0);
  const balance = selling ? maxUsdt : maxInr;
  const fmtBalance = (v: number) => (selling ? formatUsdt(v, 6) : formatInr(v));
  const overBalance = status != null && amountValid && amountNum > balance + (selling ? 0.000001 : 0.0001);
  // The minimum is in INR; for a sell compare the INR value at the live rate when known.
  const rate = status?.inrRate ?? null;
  const amountInInr = selling ? (rate != null ? amountNum * rate : null) : amountNum;
  const belowMin = amountValid && status?.minInr != null && amountInInr != null && amountInInr < status.minInr;
  const canConvert = amountValid && !belowMin && !overBalance && status?.spotAccess !== false && !converting;

  function switchDirection(next: ConvertDirection) {
    if (converting || next === direction) return;
    setDirection(next);
    setAmount("");
    setError(null);
  }

  async function doConvert() {
    if (!amountValid) {
      setError(`Enter how much ${selling ? "USDT" : "INR"} you want to convert.`);
      return;
    }
    setConverting(true);
    setError(null);
    try {
      const data = await fetchData<ConvertResultData>("/api/coinswitch/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selling ? { direction, amountUsdt: amountNum } : { direction, amountInr: amountNum }),
      });
      setResult(data);
      onConverted?.(data);
    } catch (err: unknown) {
      setError(err);
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
            {selling ? "Convert USDT to INR" : "Convert INR to USDT"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selling ? "Sell USDT from your CoinSwitch spot wallet for INR." : "Convert INR from your CoinSwitch wallet to USDT."}
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div role="radiogroup" aria-label="Conversion direction" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {([
              ["INR_TO_USDT", "INR → USDT"],
              ["USDT_TO_INR", "USDT → INR"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                disabled={converting}
                onClick={() => switchDirection(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  direction === value ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {statusLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ) : statusError != null ? (
          <ErrorState error={statusError} title="Couldn't load your CoinSwitch INR balance" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">{selling ? "USDT in your spot wallet" : "INR in your wallet"}</span>
              <span className="font-semibold tabular-nums text-amber-300">{fmtBalance(balance)}</span>
            </div>

            {selling && !result && status?.futuresUsdt != null && status.futuresUsdt.available > 0 && (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                <span>
                  {formatUsdt(status.futuresUsdt.available)} is in your Futures wallet. To sell it, first move it to your
                  spot wallet in CoinSwitch PRO → Wallet → Transfer.
                </span>
              </p>
            )}

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
                    {result.direction === "USDT_TO_INR"
                      ? `${formatUsdt(result.usdtSold ?? 0, 4)} → ${formatInr(result.inrReceived ?? 0)}`
                      : `${formatInr(result.inrSpent ?? 0)} → ${formatUsdt(result.usdtReceived ?? 0, 4)}`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Rate {formatInr(result.rate, 2)} per USDT
                    {result.fee != null && result.fee > 0 ? ` · exchange fee ${result.fee}` : ""}
                  </div>
                </div>

                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  {result.note ??
                    (result.direction === "USDT_TO_INR"
                      ? "INR is credited to your CoinSwitch wallet."
                      : "USDT is in your CoinSwitch exchange wallet. Move it to your Futures wallet in CoinSwitch PRO → Wallet → Transfer so your bots can trade with it.")}
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
                    {selling ? "Amount in USDT" : "Amount in INR (₹)"}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {selling ? "$" : "₹"}
                      </span>
                      <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder={selling ? "e.g. 10" : "e.g. 500"}
                        className="pl-7"
                        disabled={converting || status?.spotAccess === false}
                      />
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      className="shrink-0"
                      disabled={converting || balance <= 0 || status?.spotAccess === false}
                      onClick={() => setAmount(String(balance))}
                    >
                      Max
                    </Button>
                  </div>
                  {overBalance && (
                    <p className="mt-1.5 text-xs text-red-400">
                      That's more than the {fmtBalance(balance)} you have — max is {fmtBalance(balance)}.
                    </p>
                  )}
                  {!overBalance && belowMin && status?.minInr != null && (
                    <p className="mt-1.5 text-xs text-red-400">
                      CoinSwitch&apos;s minimum conversion is {formatInr(status.minInr)}
                      {selling && rate != null ? ` (≈ ${formatUsdt(status.minInr / rate, 2)})` : ""}.
                    </p>
                  )}
                  {selling && amountValid && rate != null && !overBalance && !belowMin && (
                    <p className="mt-1.5 text-xs text-muted-foreground">≈ {formatInr(amountNum * rate)} at the current rate</p>
                  )}
                </div>

                {!selling && status?.minInr != null && maxInr > 0 && maxInr < status.minInr && (
                  <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
                    <span>
                      CoinSwitch's minimum conversion is {formatInr(status.minInr)}, but your wallet
                      has {formatInr(maxInr)}. Add INR from the CoinSwitch app and refresh.
                    </span>
                  </p>
                )}

                {error != null && <ErrorState error={error} title="Conversion failed" />}

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
                    {converting ? "Converting…" : "Convert"}
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
 * Wallet-card entry point for INR -> USDT conversion: one muted line with an
 * inline "Convert INR to USDT" hyperlink that opens the conversion dialog. The
 * link is always shown so the option never disappears; when INR is sitting
 * idle the line also says how much. Self-fetches conversion status once on
 * mount and after each convert.
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
  const [openSell, setOpenSell] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    try {
      setError(null);
      const data = await requestConvertStatus();
      setStatus(data);
      if (data.inrRate != null && data.inrRate > 0) inrRateCache.rate = data.inrRate;
    } catch (err: unknown) {
      setError(err);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const inr = error == null && status != null ? status.inrAvailable ?? 0 : 0;
  const rate = inrRateCache.rate ?? status?.inrRate ?? null;
  const inrUsdt = rate != null && rate > 0 ? inr / rate : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {inr > 0 ? (
        <span>
          You have <span className="font-medium text-foreground">{formatInr(inr)}</span>
          {inrUsdt != null && (
            <span className="text-muted-foreground"> (≈ {formatUsdt(inrUsdt)})</span>
          )}{" "}
          in INR — it sits idle because bots trade in USDT.
        </span>
      ) : (
        <span>Bots trade in USDT — add funds by converting INR.</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 font-medium text-amber-400 underline underline-offset-2 transition-colors hover:text-amber-300"
      >
        <ArrowLeftRight className="h-3 w-3" /> Convert INR to USDT
      </button>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={() => setOpenSell(true)}
        className="inline-flex items-center gap-1 font-medium text-amber-400 underline underline-offset-2 transition-colors hover:text-amber-300"
      >
        USDT to INR
      </button>
      <ConvertInrToUsdtDialog
        open={openSell}
        onOpenChange={setOpenSell}
        initialDirection="USDT_TO_INR"
        onConverted={(data) => {
          void refresh();
          onConverted?.(data);
        }}
      />
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