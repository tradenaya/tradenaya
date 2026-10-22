import dns from "node:dns";
import net from "node:net";

let applied = false;

/**
 * Make every outbound connection from this server use IPv4.
 *
 * The production VPS has broken IPv6: connections to hosts that also publish
 * IPv6 addresses (CoinSwitch's API is behind Cloudflare, which does) hang until
 * they time out. Node tries IPv6 first / races it ("happy eyeballs"), so a
 * share of CoinSwitch calls failed at random: position and open-order reads,
 * the coin list, cancels — which raised false "no stop-loss / take-profit"
 * alerts and skipped analysis cycles. JobDraft hit the same problem on the same
 * server and this exact setting fixed it there.
 *
 *  - ipv4first: DNS lookups return IPv4 addresses before IPv6 ones;
 *  - autoSelectFamily off: Node connects to that first (IPv4) address instead
 *    of racing IPv6 against it. Applies to fetch() too.
 *
 * Harmless where IPv6 works. Call once, as early as possible in the server process.
 */
export function preferIpv4(): void {
  if (applied) return;
  applied = true;
  dns.setDefaultResultOrder("ipv4first");
  if (typeof net.setDefaultAutoSelectFamily === "function") net.setDefaultAutoSelectFamily(false);
}
