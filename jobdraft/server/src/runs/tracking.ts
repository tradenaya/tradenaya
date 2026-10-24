// Tracks applications from Gmail headers only (gmail.metadata): sent, removed,
// replied, bounced. Only threads the app stored are read; the mailbox is never searched.
import { config } from "../config/env.js";
import { execute, query } from "../db/pool.js";
import { gmail, type ThreadMessage } from "../gmail/index.js";
import { clock, DAY } from "../lib/clock.js";
import { GmailAuthError, sleep } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { loadProfile, refreshTokenOf } from "./profile.js";
import { refreshRunStatus } from "./status.js";

export const TRACKING_WINDOW_DAYS = 45;

export interface TrackedItem {
  id: number;
  run_id: number;
  user_id: number;
  gmail_thread_id: string;
  gmail_draft_id: string | null;
  rfc_message_id: string | null;
  send_state: string;
  sent_at: Date | null;
  reply_state: string;
  outcome: string;
}

interface FollowUpRow {
  id: number;
  sequence: number;
  state: string;
  gmail_draft_id: string | null;
  rfc_message_id: string | null;
}

const BOUNCE_FROM = /(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT = /(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|failure|subsystem)|returned mail|delivery failure|failure notice)/i;

export function addressOf(header: string | undefined): string {
  const h = header ?? "";
  return (/<([^>]+)>/.exec(h)?.[1] ?? h).trim().toLowerCase();
}

export function isBounce(m: ThreadMessage): boolean {
  return BOUNCE_FROM.test(m.headers.from ?? "") || BOUNCE_SUBJECT.test(m.headers.subject ?? "");
}

const isSent = (m: ThreadMessage) => m.labelIds.includes("SENT") && !m.labelIds.includes("DRAFT");
const isDraft = (m: ThreadMessage) => m.labelIds.includes("DRAFT");

export interface ThreadReading {
  sent: ThreadMessage[];
  hasDraft: boolean;
  reply: ThreadMessage | null;
  bounce: ThreadMessage | null;
}

/** Pure interpretation of a thread's headers. */
export function readThread(messages: ThreadMessage[], userAddress: string): ThreadReading {
  const me = userAddress.toLowerCase();
  const sorted = [...messages].sort((a, b) => a.internalDate - b.internalDate);
  const sent = sorted.filter(isSent);
  const firstSentAt = sent[0]?.internalDate ?? Infinity;
  const incoming = sorted.filter((m) => !isSent(m) && !isDraft(m) && m.internalDate > firstSentAt && addressOf(m.headers.from) !== me);
  return {
    sent,
    hasDraft: sorted.some(isDraft),
    bounce: incoming.find(isBounce) ?? null,
    reply: incoming.find((m) => !isBounce(m)) ?? null,
  };
}

/** Stops every pending follow-up of an item (reply, bounce, stop button) and deletes unsent app-made drafts. */
export async function stopPendingFollowUps(itemId: number, token: string | null, newState: "not_needed" | "cancelled", reason: string): Promise<void> {
  const pending = await query<FollowUpRow>("SELECT id, sequence, state, gmail_draft_id, rfc_message_id FROM followups WHERE run_item_id = ? AND state IN ('scheduled','draft_created')", [itemId]);
  for (const f of pending) {
    const res = await execute("UPDATE followups SET state = ?, skip_reason = ? WHERE id = ? AND state IN ('scheduled','draft_created')", [newState, reason, f.id]);
    if (res.affectedRows === 1 && f.gmail_draft_id && token) await gmail().deleteDraft(token, f.gmail_draft_id).catch(() => undefined);
  }
}

/**
 * Brings one application up to date from its Gmail thread. Returns the reading
 * (null if the thread is gone). Throws GmailAuthError for expired access.
 */
export async function trackItem(item: TrackedItem, token: string, userAddress: string): Promise<ThreadReading | null> {
  const now = clock.now();
  const messages = await gmail().getThread(token, item.gmail_thread_id);
  if (!messages) {
    // Draft deleted and nothing was sent.
    if (item.send_state !== "sent" && item.send_state !== "sending") {
      await execute("UPDATE run_items SET send_state = 'removed', last_checked_at = ? WHERE id = ? AND send_state <> 'sent'", [now, item.id]);
    }
    return null;
  }
  const t = readThread(messages, userAddress);

  // Sent? (the queue, or the user pressing Send in Gmail)
  const first = t.sent[0];
  if (first && item.send_state !== "sent") {
    // Found sent in Gmail without the queue having sent it: the user sent the draft by hand.
    await execute("UPDATE run_items SET send_state = 'sent', sent_by = COALESCE(sent_by, 'user'), sent_at = ?, gmail_message_id = ? WHERE id = ? AND send_state <> 'sent'", [new Date(first.internalDate), first.id, item.id]);
    item.send_state = "sent";
    item.sent_at = new Date(first.internalDate);
  } else if (!first && !t.hasDraft && item.send_state !== "sending") {
    await execute("UPDATE run_items SET send_state = 'removed' WHERE id = ? AND send_state NOT IN ('sent','sending')", [item.id]);
  }

  // Follow-up drafts the user sent by hand: the 2nd and 3rd sent messages are follow-ups 1 and 2.
  if (t.sent.length > 1) {
    const fus = await query<FollowUpRow>("SELECT id, sequence, state, gmail_draft_id, rfc_message_id FROM followups WHERE run_item_id = ? ORDER BY sequence", [item.id]);
    for (const f of fus) {
      const byId = t.sent.find((m) => f.rfc_message_id && m.headers["message-id"] === f.rfc_message_id);
      const msg = byId ?? t.sent[f.sequence];
      if (msg && ["draft_created", "scheduled", "failed", "expired", "cancelled"].includes(f.state)) {
        await execute("UPDATE followups SET state = 'sent', sent_at = ?, gmail_message_id = ? WHERE id = ? AND state <> 'sent'", [new Date(msg.internalDate), msg.id, f.id]);
      }
    }
  }

  // Replied or bounced → close the application and stop follow-ups.
  if (item.outcome === "open" && (t.bounce || t.reply)) {
    const bounced = !!t.bounce;
    const at = new Date((t.bounce ?? t.reply)!.internalDate);
    await execute("UPDATE run_items SET reply_state = ?, replied_at = ?, outcome = ? WHERE id = ? AND outcome = 'open'", [bounced ? "bounced" : "replied", at, bounced ? "bounced" : "replied", item.id]);
    item.outcome = bounced ? "bounced" : "replied";
    await stopPendingFollowUps(item.id, token, "not_needed", bounced ? "bounced" : "replied");
  }
  await execute("UPDATE run_items SET last_checked_at = ? WHERE id = ?", [now, item.id]);
  return t;
}

export async function itemsToTrack(userId: number, now = clock.now()): Promise<TrackedItem[]> {
  return query<TrackedItem>(
    `SELECT id, run_id, user_id, gmail_thread_id, gmail_draft_id, rfc_message_id, send_state, sent_at, reply_state, outcome
     FROM run_items
     WHERE user_id = ? AND type <> 'link_only' AND gmail_thread_id IS NOT NULL AND outcome = 'open'
       AND send_state NOT IN ('removed','sending') AND created_at >= ?
     ORDER BY id`,
    [userId, new Date(now.getTime() - TRACKING_WINDOW_DAYS * DAY)],
  );
}

/** Tracks all open applications of one user. Read-only, so it runs even with automation OFF. */
export async function trackUser(userId: number): Promise<{ checked: number }> {
  const profile = await loadProfile(userId);
  const token = profile && profile.gmailStatus === "connected" && profile.gmailAddress ? refreshTokenOf(profile) : null;
  if (!profile || !token) return { checked: 0 };
  const items = await itemsToTrack(userId);
  const runs = new Set<number>();
  let checked = 0;
  for (const item of items) {
    try {
      await trackItem(item, token, profile.gmailAddress!);
      checked++;
      runs.add(Number(item.run_id));
    } catch (err) {
      if (err instanceof GmailAuthError) {
        await execute("UPDATE gmail_connections SET status = 'error', last_error = ? WHERE user_id = ?", ["Gmail access expired — please reconnect", userId]);
        break;
      }
      log.warn("tracking_item_failed", { userId, itemId: item.id, error: errInfo(err) });
    }
    if (!config().mockExternal) await sleep(150); // stay well inside Gmail's per-user quota
  }
  for (const runId of runs) await refreshRunStatus(runId);
  return { checked };
}

/** Every user with Gmail connected (2-hourly cron). */
export async function trackAllUsers(): Promise<void> {
  const users = await query<{ user_id: number }>("SELECT user_id FROM gmail_connections WHERE status = 'connected' AND refresh_token_enc IS NOT NULL");
  for (const u of users) {
    try {
      await trackUser(u.user_id);
    } catch (err) {
      log.warn("tracking_user_failed", { userId: u.user_id, error: errInfo(err) });
    }
  }
}
