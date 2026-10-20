import { HttpError, sleep } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { saveResume, type UploadedFile } from "./service.js";

/**
 * Reading a resume can take longer than a proxy lets one HTTP request live
 * (the AI is sometimes slow), so the AI step runs in the background: the
 * upload request waits briefly and, if it isn't done yet, answers 202 and the
 * page polls GET /resume/status. State is in memory — one server process
 * (pm2 single instance); a restart mid-read just means "upload again".
 */
export interface ResumeJob {
  status: "reading" | "done" | "failed";
  fileName: string;
  startedAt: number;
  error?: string;
  httpStatus?: number;
}

/** How long the upload request itself waits before answering 202 (tests lower it). */
export const RESUME_WAIT = { ms: 20_000 };
const KEEP_FINISHED_MS = 15 * 60_000;

const jobs = new Map<number, ResumeJob>();

export function resumeJob(userId: number): ResumeJob | undefined {
  const job = jobs.get(userId);
  if (job && job.status !== "reading" && Date.now() - job.startedAt > KEEP_FINISHED_MS) {
    jobs.delete(userId);
    return undefined;
  }
  return job;
}

export function clearResumeJob(userId: number) {
  jobs.delete(userId);
}

/** Starts the AI read in the background. Resolves to true if it finished within `RESUME_WAIT`. */
export async function startResumeJob(userId: number, file: UploadedFile, text: string): Promise<boolean> {
  if (jobs.get(userId)?.status === "reading") throw new HttpError(409, "Your resume is still being read. Please wait for it to finish.");
  const job: ResumeJob = { status: "reading", fileName: file.originalname, startedAt: Date.now() };
  jobs.set(userId, job);
  const done = saveResume(userId, file, text).then(
    () => {
      job.status = "done";
      log.info("resume_job_done", { userId, ms: Date.now() - job.startedAt });
    },
    (err: unknown) => {
      job.status = "failed";
      if (err instanceof HttpError) {
        job.error = err.message;
        job.httpStatus = err.status;
      } else {
        job.error = "Something went wrong while reading your resume. Please try again.";
        job.httpStatus = 500;
        log.error("resume_job_failed", { userId, error: errInfo(err) });
      }
    },
  );
  return Promise.race([done.then(() => true), sleep(RESUME_WAIT.ms).then(() => false)]);
}
