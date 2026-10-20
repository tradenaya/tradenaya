import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "../../src/gmail/types.js";
import { addressOf, isBounce, readThread } from "../../src/runs/tracking.js";

const me = "priya@gmail.com";
const msg = (id: string, t: number, labels: string[], from: string, subject = "Application"): ThreadMessage => ({
  id,
  internalDate: t,
  labelIds: labels,
  headers: { from, subject, "message-id": `<${id}@x>` },
});

describe("reply and bounce detection from metadata headers", () => {
  it("reads a plain sent thread", () => {
    const t = readThread([msg("a", 1, ["SENT"], `Priya <${me}>`)], me);
    expect(t.sent.map((m) => m.id)).toEqual(["a"]);
    expect(t.reply).toBeNull();
    expect(t.bounce).toBeNull();
  });

  it("detects a reply from someone else after our email", () => {
    const t = readThread([msg("a", 1, ["SENT"], me), msg("b", 2, ["INBOX"], "HR Team <hr@nimbus.in>", "Re: Application")], me);
    expect(t.reply?.id).toBe("b");
    expect(t.bounce).toBeNull();
  });

  it("detects bounces by sender or subject", () => {
    expect(isBounce(msg("x", 1, ["INBOX"], "Mail Delivery Subsystem <mailer-daemon@googlemail.com>"))).toBe(true);
    expect(isBounce(msg("x", 1, ["INBOX"], "postmaster@nimbus.in"))).toBe(true);
    expect(isBounce(msg("x", 1, ["INBOX"], "someone@x.in", "Undeliverable: Application"))).toBe(true);
    expect(isBounce(msg("x", 1, ["INBOX"], "someone@x.in", "Returned mail: see transcript"))).toBe(true);
    expect(isBounce(msg("x", 1, ["INBOX"], "hr@x.in", "Re: Application"))).toBe(false);
    const t = readThread([msg("a", 1, ["SENT"], me), msg("b", 2, ["INBOX"], "mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)")], me);
    expect(t.bounce?.id).toBe("b");
    expect(t.reply).toBeNull();
  });

  it("ignores our own messages, drafts, and anything before we sent", () => {
    const t = readThread(
      [msg("d", 1, ["DRAFT"], me), msg("old", 0, ["INBOX"], "hr@x.in"), msg("fu", 5, ["SENT"], me)],
      me,
    );
    expect(t.hasDraft).toBe(true);
    expect(t.reply).toBeNull();
    expect(t.sent.map((m) => m.id)).toEqual(["fu"]);
  });

  it("parses addresses", () => {
    expect(addressOf("Priya Sharma <Priya@Gmail.com>")).toBe("priya@gmail.com");
    expect(addressOf("hr@x.in")).toBe("hr@x.in");
  });
});
