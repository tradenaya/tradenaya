// Common job titles for the Target roles autocomplete (bundled, no API). Users
// can still add any title of their own.
export const JOB_ROLES = [
  // Software engineering
  "Software Engineer", "Software Developer", "Senior Software Engineer", "Associate Software Engineer", "Full Stack Developer",
  "Frontend Developer", "Backend Developer", "React Developer", "Angular Developer", "Vue.js Developer", "Node.js Developer",
  "Java Developer", "Python Developer", ".NET Developer", "PHP Developer", "Golang Developer", "Ruby on Rails Developer",
  "JavaScript Developer", "TypeScript Developer", "Web Developer", "MERN Stack Developer", "MEAN Stack Developer",
  "Mobile App Developer", "Android Developer", "iOS Developer", "Flutter Developer", "React Native Developer",
  "Application Developer", "Software Development Engineer", "Embedded Software Engineer", "Game Developer",
  "Salesforce Developer", "SAP Consultant", "WordPress Developer", "Shopify Developer", "Blockchain Developer",
  // Data & AI
  "Data Analyst", "Data Scientist", "Data Engineer", "Machine Learning Engineer", "AI Engineer", "Business Intelligence Analyst",
  "Power BI Developer", "Tableau Developer", "SQL Developer", "Database Administrator", "Big Data Engineer", "MLOps Engineer",
  // Quality, cloud, infrastructure, security
  "QA Engineer", "Software Tester", "Automation Test Engineer", "Manual Tester", "SDET", "Performance Test Engineer",
  "DevOps Engineer", "Site Reliability Engineer", "Cloud Engineer", "AWS Engineer", "Azure Engineer", "Platform Engineer",
  "Systems Engineer", "Network Engineer", "System Administrator", "Linux Administrator", "Cyber Security Analyst",
  "Security Engineer", "IT Support Engineer", "Technical Support Engineer", "Desktop Support Engineer",
  // Product, project, delivery, analysis
  "Product Manager", "Associate Product Manager", "Assistant Product Manager", "Senior Product Manager", "Technical Product Manager",
  "Product Owner", "Product Analyst", "Project Manager", "Associate Project Manager", "IT Project Manager", "Technical Project Manager",
  "Project Coordinator", "Program Manager", "Technical Program Manager", "Delivery Manager", "Scrum Master", "Agile Coach",
  "Business Analyst", "Business Systems Analyst", "Functional Consultant", "Implementation Consultant", "Implementation Engineer",
  "Solutions Architect", "Software Architect", "Technical Architect", "Engineering Manager", "Team Lead", "Tech Lead",
  // Customer, sales, marketing in tech
  "Customer Success Manager", "Customer Success Associate", "Technical Account Manager", "Account Manager", "Pre-Sales Consultant",
  "Solutions Engineer", "Sales Engineer", "Business Development Executive", "Inside Sales Executive", "Digital Marketing Executive",
  "SEO Specialist", "Content Writer", "Technical Writer", "Growth Marketing Manager", "Marketing Manager",
  // Design
  "UI/UX Designer", "UI Designer", "UX Designer", "Product Designer", "Graphic Designer", "UX Researcher",
  // Operations, HR, finance
  "Operations Executive", "Operations Manager", "HR Executive", "HR Generalist", "Talent Acquisition Specialist", "Recruiter",
  "Financial Analyst", "Accountant", "Customer Support Executive",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();

/** Edit distance (with adjacent swaps), stopping early once it exceeds `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** Typos allowed for a word of this length. */
const allowed = (n: number) => (n <= 3 ? 0 : n <= 6 ? 1 : 2);

/**
 * How well a title matches what was typed (lower is better), or null.
 * Exact > starts with > every word starts a word > contains > close spelling.
 */
export function roleScore(query: string, title: string): number | null {
  const q = norm(query);
  const t = norm(title);
  if (!q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const qWords = q.split(" ");
  const tWords = t.split(" ");
  if (qWords.every((w) => tWords.some((tw) => tw.startsWith(w)))) return 2;
  if (t.includes(q)) return 3;
  // Spelling mistakes: every typed word is close to (the start of) some word in the title.
  let typos = 0;
  for (const w of qWords) {
    let best = Infinity;
    for (const tw of tWords) best = Math.min(best, distance(w, tw, allowed(w.length)), distance(w, tw.slice(0, w.length), allowed(w.length)));
    if (best > allowed(w.length)) return null;
    typos += best;
  }
  return 4 + typos;
}

/** Best matching titles for the box, not already chosen (case-insensitive). */
export function searchRoles(query: string, exclude: string[] = [], limit = 6): string[] {
  const taken = new Set(exclude.map(norm));
  return JOB_ROLES.filter((r) => !taken.has(norm(r)))
    .map((r) => ({ r, s: roleScore(query, r) }))
    .filter((x): x is { r: string; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.r.length - b.r.length)
    .slice(0, limit)
    .map((x) => x.r);
}

/** Is this exactly one of the known titles (ignoring case and punctuation)? */
export const isKnownRole = (title: string) => JOB_ROLES.some((r) => norm(r) === norm(title));
