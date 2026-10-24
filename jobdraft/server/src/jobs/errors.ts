import type { SourceName } from "./types.js";

/** A job source answered with an HTTP error (shown in the run funnel). */
export class SourceHttpError extends Error {
  constructor(
    public source: SourceName,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

/** The provider's plan quota is used up (e.g. RapidAPI 429). */
export function isQuotaStatus(status: number): boolean {
  return status === 429;
}
