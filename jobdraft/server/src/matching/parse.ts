// Parsers for facts stated in posting text: minimum experience and salary (LPA).

const NUM = String.raw`(?<![\d.])(\d{1,2}(?:\.\d)?)`;

/**
 * Smallest "minimum years" stated in the posting, e.g. "5+ years", "3-6 yrs",
 * "minimum 4 years", "at least 7 years of experience". null when not stated.
 */
export function parseMinExperience(text: string): number | null {
  const t = text.replace(/\s+/g, " ");
  const found: number[] = [];
  const patterns = [
    new RegExp(String.raw`${NUM}\s*(?:\+|plus)?\s*(?:-|–|to)\s*${NUM}\s*\+?\s*(?:years?|yrs?)`, "gi"),
    new RegExp(String.raw`(?:minimum|min\.?|at least|atleast)\s*(?:of\s*)?${NUM}\s*\+?\s*(?:years?|yrs?)`, "gi"),
    // "7+ years" — but not a company's age ("25+ years of excellence").
    new RegExp(String.raw`${NUM}\s*(?:\+|plus)\s*(?:years?|yrs?)\b(?!\s*(?:of\s+)?(?:excellence|legacy|history|trust|service|existence|in business|of operations))`, "gi"),
    new RegExp(String.raw`${NUM}\s*(?:years?|yrs?)\s*(?:of\s*)?(?:relevant\s*|professional\s*|work\s*|industry\s*|hands[- ]on\s*)?(?:experience|exp)`, "gi"),
    new RegExp(String.raw`(?:experience|exp)\s*[:\-]\s*${NUM}\s*(?:\+)?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*(?:years?|yrs?)`, "gi"),
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n <= 40) found.push(n);
    }
  }
  return found.length ? Math.min(...found) : null;
}

export interface SalaryRange {
  minLpa: number | null;
  maxLpa: number | null;
}

/**
 * Salary stated in text, normalised to lakhs per annum. Handles "8-12 LPA",
 * "₹6,00,000 - ₹9,00,000 per annum", "Rs. 50,000 per month", "10 lakhs".
 */
export function parseSalaryLpa(text: string): SalaryRange | null {
  const t = text.replace(/\s+/g, " ");
  const lpa = t.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:lpa|lakhs?(?:\s*per\s*annum|\s*p\.?a\.?)?|lacs?|l\b)/i);
  if (lpa) return order(Number(lpa[1]), Number(lpa[2]));
  const single = t.match(/(?:upto|up to|max(?:imum)?)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:lpa|lakhs? per annum|lakhs?|lacs?)\b/i);
  if (single) {
    const v = Number(single[1]);
    return /up ?to|max/i.test(single[0]) ? { minLpa: null, maxLpa: v } : { minLpa: v, maxLpa: v };
  }
  const rupees = t.match(/(?:₹|rs\.?|inr)\s*([\d,]{4,})(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr)?\s*([\d,]{4,}))?\s*(per month|\/\s*month|pm|monthly|per annum|p\.?a\.?|\/\s*year|per year|annually)?/i);
  if (rupees) {
    const a = Number(rupees[1].replace(/,/g, ""));
    const b = rupees[2] ? Number(rupees[2].replace(/,/g, "")) : a;
    const monthly = rupees[3] ? /month|pm/i.test(rupees[3]) : Math.max(a, b) < 300000;
    const factor = monthly ? 12 / 100000 : 1 / 100000;
    return order(round(a * factor), round(b * factor));
  }
  return null;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function order(a: number, b: number): SalaryRange {
  return { minLpa: Math.min(a, b), maxLpa: Math.max(a, b) };
}

/** Annual INR amount → LPA. */
export function inrToLpa(amount: number | null | undefined): number | null {
  if (!amount || !Number.isFinite(amount) || amount <= 0) return null;
  return round(amount / 100000);
}

/** Does the posting explicitly ask candidates to state expected CTC/salary? */
export function asksExpectedCtc(text: string): boolean {
  return /\b(expected|current\s*(?:and|&|\/)\s*expected)\s*(ctc|salary|compensation|package)\b|\bsalary expectations?\b|\bexpected ctc\b|\bmention (?:your )?(?:expected )?(?:ctc|salary)\b/i.test(text);
}
