// "Product Manager" and "Project Manager" are also titles in pharma, veterinary,
// construction and manufacturing. When the title itself says nothing about
// software, the description decides.
import { normalize } from "./text.js";

/** Title words that already say "software / IT". */
const SOFTWARE_TITLE_RE = /\b(software|it|saas|digital|tech|technology|technical|platform|app|apps|web|mobile|data|cloud|ai|ml|erp|crm|fintech|edtech|healthtech|api|cyber|security|devops|qa|ux|ui|ecommerce|e commerce|online|internet|sap|salesforce)\b/;

const NON_SOFTWARE_DESC = [
  /\bconstruction\b/, /\bcivil\b/, /\bsite execution\b/, /\bboq\b|\bbill of quantities\b/, /\bautocad\b/, /\bstructural\b/, /\bhvac\b|\bmep\b/,
  /\bcontractors?\b/, /\breal estate\b/, /\bpharma(ceuticals?)?\b/, /\bdrugs?\b/, /\bformulations?\b/, /\bveterinary\b/, /\blivestock\b/,
  /\bruminant\b/, /\bpoultry\b/, /\banimal health\b/, /\bfarmers?\b/, /\bclinical trials?\b/, /\bmanufacturing\b/, /\bproduction line\b/,
  /\bplant operations\b/, /\bfactory\b/, /\bfmcg\b/, /\bdistributors?\b/, /\bretail stores?\b/, /\btextiles?\b/, /\bgarments?\b/, /\bhospitality\b/,
  /\bmining\b/, /\boil and gas\b|\boil gas\b/, /\bepc\b/, /\bsolar\b/, /\bmedical representatives?\b/, /\bdoctors?\b/,
];

const SOFTWARE_DESC = [
  /\bsoftware\b/, /\bsaas\b/, /\bagile\b/, /\bscrum\b/, /\bjira\b/, /\bsprints?\b/, /\bapis?\b/, /\bcloud\b/, /\bweb\b/, /\bmobile apps?\b/,
  /\bplatform\b/, /\bsql\b/, /\bdata\b/, /\bit services\b/, /\bdigital\b/, /\bdevops\b/, /\baws\b|\bazure\b|\bgcp\b/, /\buser stories\b/,
  /\bbacklog\b/, /\bux\b/, /\bui\b/, /\bdevelopers?\b/, /\bengineering teams?\b/, /\btech stack\b/,
];

const count = (text: string, patterns: RegExp[]) => patterns.filter((re) => re.test(text)).length;

/**
 * A reason when a posting with a generic title is clearly from a non-software
 * domain: at least 2 domain words and at most 1 software word in the text.
 */
export function industryProblem(job: { title: string; description: string }): string | null {
  if (SOFTWARE_TITLE_RE.test(normalize(job.title))) return null;
  const text = normalize(`${job.title} ${job.description}`);
  const domain = count(text, NON_SOFTWARE_DESC);
  const software = count(text, SOFTWARE_DESC);
  return domain >= 2 && software <= 1 ? "industry: non-software domain" : null;
}
