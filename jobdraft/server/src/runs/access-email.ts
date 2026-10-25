// "You can log in now" email, sent from the ADMIN's own connected Gmail (the
// access JobDraft already has) — no paid email service. If the admin hasn't
// connected Gmail, nothing is sent and the admin page says so.
import { config } from "../config/env.js";
import { gmail } from "../gmail/index.js";
import { buildMimeMessage, generateMessageId, toBase64Url } from "../gmail/mime.js";
import { errInfo, log } from "../lib/logger.js";
import { gmailUsable, loadProfile, refreshTokenOf } from "./profile.js";

export type AccessEmailResult = { sent: true; from: string } | { sent: false; reason: string };

export function accessEmailBody(name: string): { subject: string; body: string } {
  const login = `${config().clientUrl.replace(/\/$/, "")}/login`;
  return {
    subject: "Your JobDraft account is ready",
    body: `Hi ${name},\n\nYour JobDraft account has been approved. You can log in now and finish your setup:\n${login}\n\nUse the email and password you registered with.\n\nThanks,\nJobDraft`,
  };
}

export async function sendAccessEmail(adminId: number, to: { email: string; name: string }): Promise<AccessEmailResult> {
  const admin = await loadProfile(adminId);
  const token = admin ? refreshTokenOf(admin) : null;
  if (!admin || !token || !admin.gmailAddress || !gmailUsable(admin)) return { sent: false, reason: "Connect your Gmail (Setup) to send this email automatically." };
  try {
    const { subject, body } = accessEmailBody(to.name);
    const raw = buildMimeMessage({ from: admin.gmailAddress, to: to.email, replyTo: admin.gmailAddress, subject, body, messageId: generateMessageId(admin.gmailAddress) });
    const draft = await gmail().createDraft(token, toBase64Url(raw));
    await gmail().sendDraft(token, draft.draftId);
    log.info("access_email_sent", { adminId });
    return { sent: true, from: admin.gmailAddress };
  } catch (err) {
    log.warn("access_email_failed", { adminId, error: errInfo(err) });
    return { sent: false, reason: "Gmail couldn't send it. Please let them know yourself." };
  }
}
