import { AiInvalidOutputError, AiKeyMissingError, AiKeyRejectedError, AiUnavailableError, parseResumeText } from "../ai/index.js";
import { geminiKeyOf, markGeminiKeyInvalid } from "../ai/user-key.js";
import type { ResumeData } from "../ai/schemas.js";
import { execute, queryOne } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { loadProfile, replaceResumeExclusions, resumeCompanies } from "../runs/profile.js";
import { storage } from "../storage/index.js";
import { computeExperienceYears } from "./experience.js";
import { extractPdfText, looksLikePdf, MAX_RESUME_BYTES, MIN_TEXT_CHARS, sanitizeFileName } from "./pdf.js";

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Validate → extract → parse → upload new → save → refresh "companies to skip"
 * → delete old. The old resume (row, file and skip list) stays untouched unless
 * every step succeeds.
 */
export async function replaceResume(userId: number, file: UploadedFile): Promise<void> {
  await saveResume(userId, file, await readResumeFile(userId, file));
}

/** The quick part, done while the user waits: size, type and text extraction. */
export async function readResumeFile(userId: number, file: UploadedFile): Promise<string> {
  if (file.size > MAX_RESUME_BYTES) throw new HttpError(400, "The file is larger than 5 MB.");
  if (!looksLikePdf(file.buffer, file.mimetype, file.originalname)) throw new HttpError(400, "Please upload a PDF file.");

  let text: string;
  try {
    text = await extractPdfText(file.buffer);
  } catch (err) {
    log.warn("pdf_extract_failed", { userId, error: errInfo(err) });
    throw new HttpError(400, "We couldn't read this PDF. Please upload a different, text-based PDF.");
  }
  if (text.replace(/\s+/g, "").length < MIN_TEXT_CHARS) {
    throw new HttpError(400, "This looks like a scanned/image PDF. Please upload a text-based PDF.");
  }
  return text;
}

/** The slow part (the AI read), which may run in the background: parse → upload → save. */
export async function saveResume(userId: number, file: UploadedFile, text: string): Promise<void> {
  const store = storage(); // throws "not configured" before spending an AI call
  let data: ResumeData;
  try {
    const profile = await loadProfile(userId);
    data = await parseResumeText(text, profile ? geminiKeyOf(profile) : null);
  } catch (err) {
    if (err instanceof AiKeyMissingError) throw new HttpError(400, err.message, "gemini_key");
    if (err instanceof AiKeyRejectedError) {
      await markGeminiKeyInvalid(userId);
      throw new HttpError(400, err.message, "gemini_key");
    }
    if (err instanceof AiInvalidOutputError) throw new HttpError(422, "We couldn't read the details from this resume. Please try again or upload a cleaner PDF.");
    if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
    throw err;
  }
  const experienceYears = computeExperienceYears(data.roles);

  const previous = await queryOne<{ resume_public_id: string | null }>("SELECT resume_public_id FROM profiles WHERE user_id = ?", [userId]);
  const uploaded = await store.upload(userId, file.buffer).catch((err) => {
    log.error("resume_upload_failed", { userId, error: errInfo(err) });
    throw new HttpError(502, "Uploading the resume failed. Your previous resume is unchanged.");
  });

  try {
    await execute(
      `INSERT INTO profiles (user_id, resume_public_id, resume_url, resume_file_name, resume_text, resume_data, resume_uploaded_at, total_experience_years)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(3), ?)
       ON DUPLICATE KEY UPDATE resume_public_id = VALUES(resume_public_id), resume_url = VALUES(resume_url),
         resume_file_name = VALUES(resume_file_name), resume_text = VALUES(resume_text), resume_data = VALUES(resume_data),
         resume_uploaded_at = VALUES(resume_uploaded_at), total_experience_years = VALUES(total_experience_years)`,
      [userId, uploaded.publicId, uploaded.url, sanitizeFileName(file.originalname), text, JSON.stringify(data), experienceYears],
    );
  } catch (err) {
    // Keep the old resume: remove the file we just uploaded.
    await store.remove(uploaded.publicId).catch(() => undefined);
    throw err;
  }

  // Every employer on the resume (incl. internships and the current one) is never contacted.
  await replaceResumeExclusions(userId, resumeCompanies(data));

  if (previous?.resume_public_id && previous.resume_public_id !== uploaded.publicId) {
    await store.remove(previous.resume_public_id).catch((err) => log.warn("old_resume_delete_failed", { userId, error: errInfo(err) }));
  }
  log.info("resume_replaced", { userId, experienceYears, roles: data.roles.length, skills: data.skills.length });
}
