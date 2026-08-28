import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { type TradePreview, formatPreviewValue } from "./trade-preview";

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface TradePreviewPanelProps {
  preview: TradePreview;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function TradePreviewPanel({ preview }: TradePreviewPanelProps) {
  const {
    status,
    message,
    capitalRiskNote,
    walletAvailable,
    allocatedCapital,
    positionNotional,
    maxRiskPct,
    maxRiskUsdt,
    slDistancePct,
    estimatedLoss,
    riskCompatible,
    tpDistancePct,
    estimatedProfit,
    riskRewardRatio,
  } = preview;

  const statusIcon = useMemo(() => {
    if (status === "safe") return <CheckCircle2 size={14} className="text-emerald-400" />;
    if (status === "warning") return <AlertTriangle size={14} className="text-amber-400" />;
    return <XCircle size={14} className="text-red-400" />;
  }, [status]);

  const statusBorder = {
    safe: "border-emerald-500/20",
    warning: "border-amber-500/20",
    error: "border-red-500/20",
  }[status];

  const statusBg = {
    safe: "bg-emerald-500/5",
    warning: "bg-amber-500/5",
    error: "bg-red-500/5",
  }[status];

  return (
    <div className="space-y-3">
      {/* Status banner */}
      <div className={`flex items-start gap-2 rounded-lg border ${statusBorder} ${statusBg} px-3 py-2.5`}>
        <span className="mt-0.5 shrink-0">{statusIcon}</span>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground">{message || "Configure your settings to see a preview."}</p>
          {capitalRiskNote && (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{capitalRiskNote}</p>
          )}
        </div>
      </div>

      {!riskCompatible && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-400">
          <span className="font-semibold">To resolve this conflict, you can:</span>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-muted-foreground">
            <li>Reduce your capital allocation so the position size shrinks</li>
            <li>Increase Max Risk per Trade so the SL loss fits within your limit</li>
            <li>The bot's SL will adapt at runtime — a wider SL means less risk per unit</li>
          </ul>
        </div>
      )}

      {/* Two-column grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Capital allocation */}
        <PreviewSection title="Capital Allocation">
          <PreviewRow label="Wallet available" value={walletAvailable != null ? `${formatPreviewValue(walletAvailable)} USDT` : "—"} />
          <PreviewRow label="Allocation" value={formatAllocation(preview)} />
          <PreviewRow label="Margin used" value={`${formatPreviewValue(allocatedCapital)} USDT`} accent />
          <PreviewRow label="Leverage" value={`${preview.margin > 0 ? preview.positionNotional / preview.allocatedCapital || 0 : 0}x`} />
          <PreviewRow label="Position value" value={`~${formatPreviewValue(positionNotional)} USDT`} accent />
        </PreviewSection>

        {/* Risk */}
        <PreviewSection title="Risk">
          <PreviewRow label="Max risk" value={`${maxRiskPct}%`} />
          <PreviewRow label="Max loss allowed" value={`${formatPreviewValue(maxRiskUsdt)} USDT`} />
          <PreviewRow label="Est. SL distance" value={`${formatPreviewValue(slDistancePct)}%`} />
          <PreviewRow
            label="Est. loss at SL"
            value={`${formatPreviewValue(estimatedLoss)} USDT`}
            danger={!riskCompatible}
          />
          <PreviewRow
            label="Risk status"
            value={riskCompatible ? "✅ Within limit" : "❌ Exceeds limit"}
            danger={!riskCompatible}
          />
        </PreviewSection>

        {/* Reward */}
        <PreviewSection title="Reward">
          <PreviewRow label="Est. TP distance" value={`${formatPreviewValue(tpDistancePct)}%`} />
          <PreviewRow label="Est. profit at TP" value={`${formatPreviewValue(estimatedProfit)} USDT`} positive />
          <PreviewRow label="Risk / Reward" value={riskRewardRatio > 0 ? `1 : ${riskRewardRatio.toFixed(1)}` : "—"} />
        </PreviewSection>

        {/* Summary */}
        <PreviewSection title="Summary">
          <PreviewRow label="Capital mode" value={preview.margin > 0 ? (preview.allocatedCapital === (preview.walletAvailable ?? 0) ? "Fixed (100%)" : "Fixed") : "—"} />
          <PreviewRow label="Actual margin" value={`${formatPreviewValue(allocatedCapital)} USDT`} />
          <PreviewRow label="Position size" value={`${formatPreviewValue(preview.riskBasedSize > 0 && preview.riskBasedSize <= preview.capitalCappedSize ? preview.riskBasedSize : preview.capitalCappedSize, 6)}`} />
          <PreviewRow
            label="Binding constraint"
            value={preview.bindingConstraint === "risk" ? "Risk limit" : "None"}
          />
        </PreviewSection>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  accent,
  danger,
  positive,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
  positive?: boolean;
}) {
  const valueClass = danger
    ? "text-red-400 font-medium"
    : positive
      ? "text-emerald-400 font-medium"
      : accent
        ? "font-semibold text-foreground"
        : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatAllocation(p: TradePreview): string {
  if (p.walletAvailable == null || p.walletAvailable <= 0) return "—";
  if (p.allocatedCapital <= 0) return "—";
  const pct = (p.allocatedCapital / p.walletAvailable) * 100;
  return `${formatPreviewValue(p.allocatedCapital)} USDT (${pct.toFixed(0)}%)`;
}
