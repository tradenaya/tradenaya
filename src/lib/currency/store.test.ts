import { afterEach, describe, expect, it } from "vitest";
import {
  formatCompactAmount,
  formatDisplayPrice,
  localizeUsdtText,
  setDisplayCurrency,
  setInrRate,
} from "./store";

afterEach(() => {
  setDisplayCurrency("USDT");
  setInrRate(null);
});

function inr(rate = 85) {
  setInrRate(rate);
  setDisplayCurrency("INR");
}

describe("localizeUsdtText", () => {
  it("leaves text untouched in USDT mode", () => {
    const text = "Daily PnL -12.50 USDT is within the loss limit of -30.00 USDT.";
    expect(localizeUsdtText(text)).toBe(text);
  });

  it("leaves text untouched in INR mode until the rate is known", () => {
    setDisplayCurrency("INR");
    expect(localizeUsdtText("needs ~10 USDT")).toBe("needs ~10 USDT");
  });

  it("converts tagged amounts and prices, keeping signs", () => {
    inr(85);
    expect(localizeUsdtText("Daily PnL -12.50 USDT is within the loss limit of -30.00 USDT.")).toBe(
      "Daily PnL -₹1,062.50 is within the loss limit of -₹2,550.00.",
    );
    expect(localizeUsdtText("Plan ready — BUY BTCUSDT @ 65000 USDT | SL 64000 USDT")).toBe(
      "Plan ready — BUY BTCUSDT @ ₹55,25,000.00 | SL ₹54,40,000.00",
    );
  });

  it("converts $-prefixed amounts", () => {
    inr(80);
    expect(localizeUsdtText("Leaving no headroom at $12.50 allocation.")).toBe("Leaving no headroom at ₹1,000.00 allocation.");
  });

  it("keeps precision for tiny prices", () => {
    inr(100);
    expect(localizeUsdtText("entry 0.000012 USDT")).toBe("entry ₹0.0012");
  });

  it("never touches symbols, percentages, RSI or quantities", () => {
    inr(85);
    const text = "LONG 1000PEPEUSDT (score 72, confidence 64%) RSI 81.2 · size 0.5 · BTCUSDT · USDT/INR";
    expect(localizeUsdtText(text)).toBe(text);
  });
});

describe("price formatting", () => {
  it("formats prices bare in USDT and with ₹ in INR", () => {
    expect(formatDisplayPrice(1.23456)).toBe("1.2346");
    inr(85);
    expect(formatDisplayPrice(100)).toBe("₹8,500");
    expect(formatDisplayPrice(null)).toBe("—");
  });

  it("formats compact volumes in the active currency", () => {
    expect(formatCompactAmount(2_500_000)).toBe("$2.5M");
    inr(80);
    expect(formatCompactAmount(2_500_000)).toBe("₹200.0M");
  });
});
