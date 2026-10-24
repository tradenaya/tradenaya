import { describe, it, expect } from "vitest";
import dns from "node:dns";
import net from "node:net";
import { preferIpv4 } from "./ipv4";

describe("preferIpv4 — the VPS's IPv6 is broken, so CoinSwitch calls must use IPv4", () => {
  it("makes DNS return IPv4 first and turns off IPv6 racing", () => {
    preferIpv4();
    expect(dns.getDefaultResultOrder()).toBe("ipv4first");
    expect(net.getDefaultAutoSelectFamily()).toBe(false);
  });
});
