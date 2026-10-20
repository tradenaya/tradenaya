// Realistic fake postings for MOCK_EXTERNAL=true. Every company and domain is
// fictional. The set deliberately includes postings the pipeline must reject
// (agency, scam, too senior, low salary, internship, noreply, no email, and the
// test resume's past employers — Acme Retail Tech and Blue Ocean Systems — by
// name, through a portal, and by web domain) so a mock run exercises every
// filter and safety check.
import { sha1 } from "../lib/crypto.js";
import { cityOf, isRemoteLocation } from "../matching/locations.js";
import type { Job, SearchPair } from "./types.js";

const COMPANIES = [
  "Nimbus Analytics Pvt Ltd", "Saffron Ledger Technologies", "Kestrel Labs", "Tealpath Software", "Monsoon Commerce Pvt Ltd",
  "Banyan Health Tech", "Copperleaf Systems", "Lotus Grid Energy", "Peacock Payments", "Brightwater Edtech",
  "Quillmark Media", "Orchid Robotics", "Harbourline Logistics", "Juniper Fintech", "Cardamom Foods Online",
  "Pinewood Insurance Tech", "Riverstone Data", "Silverfern Mobility", "Coral Cloud Works", "Tamarind Travel Tech",
  "Neem Agritech", "Kingfisher Wealth Labs", "Sandalwood Retail Tech", "Marigold Studios", "Jasmine Mobility",
];

const slug = (s: string) => s.toLowerCase().replace(/\b(pvt|ltd|private|limited)\b/g, "").replace(/[^a-z0-9]+/g, "");

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1));
}

export function mockJobsFor(pair: SearchPair, runDate: string): Job[] {
  const remote = isRemoteLocation(pair.location);
  const city = remote ? "Remote" : titleCase(cityOf(pair.location));
  const location = remote ? "Remote, India" : `${city}, India`;
  const role = titleCase(pair.role.trim());
  const seed = parseInt(sha1(`${pair.role}|${pair.location}|${runDate}`).slice(0, 8), 16);
  const pick = (i: number) => COMPANIES[(seed + i * 7) % COMPANIES.length]!;
  const base = Date.parse(`${runDate}T03:00:00Z`);

  const posts: Array<Omit<Job, "key" | "source" | "postedAt" | "location" | "isRemote"> & { remoteOverride?: boolean }> = [
    {
      title: role,
      company: pick(0),
      description:
        `${pick(0)} is hiring a ${role} for our ${city} team. You will build and ship features end to end, work closely with product and design, and own quality.\n` +
        `Requirements: 2-5 years of relevant experience, strong fundamentals and clear communication.\n` +
        `How to apply: interested candidates can send their CV to careers@${slug(pick(0))}.in with the subject "${role}".`,
      url: `https://jobs.${slug(pick(0))}.in/openings/${seed % 9000}`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: `${role} - Platform Team`,
      company: pick(1),
      description:
        `Join ${pick(1)} as a ${role} - Platform Team member. Hybrid role in ${city}.\n` +
        `Experience: 1 to 6 years. Salary: 10-24 LPA.\n` +
        `Please email your resume along with your current and expected CTC and notice period to hr@${slug(pick(1))}.com.`,
      url: `https://${slug(pick(1))}.com/careers/${seed % 7000}`,
      salaryMinLpa: 10,
      salaryMaxLpa: 24,
    },
    {
      title: role,
      company: pick(2),
      description:
        `We're a 60-person product company in ${city}. As our ${role} you'll shape a product used by thousands of small businesses.\n` +
        `Apply: share your resume at talent@${slug(pick(2))}.io — we reply to every application within a week.`,
      url: `https://${slug(pick(2))}.io/jobs/${seed % 5000}`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: `Principal ${role}`,
      company: pick(3),
      description: `${pick(3)} seeks a Principal ${role} with 12+ years of experience leading large teams. Send CVs to leadership@${slug(pick(3))}.in.`,
      url: `https://${slug(pick(3))}.in/principal`,
      salaryMinLpa: 45,
      salaryMaxLpa: 70,
    },
    {
      title: role,
      company: "TalentBridge Staffing Services",
      description: `Urgent opening for ${role} with our client, a leading MNC in ${city}. Send resume to jobs@talentbridgestaffing.in.`,
      url: "https://talentbridgestaffing.in/jobs/1",
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: "Global Jobs Hub",
      description:
        `Work from anywhere as a ${role}! Earn ₹1,50,000 per month. A one-time registration fee of Rs 1,500 is required to confirm your slot. ` +
        `WhatsApp only: +91 90000 00000. Send resume to globaljobshub.hiring@gmail.com.`,
      url: "https://forms.example-jobs-hub.net/apply",
      salaryMinLpa: null,
      salaryMaxLpa: null,
      remoteOverride: true,
    },
    {
      title: role,
      company: pick(4),
      description: `${pick(4)} is growing its ${city} office and needs a ${role}. 2+ years of experience. Apply through our careers page; we do not accept emailed CVs.`,
      url: `https://careers.${slug(pick(4))}.com/apply/${seed % 3000}`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: pick(5),
      description: `${role} opening at ${pick(5)}, ${city}. Applications sent to noreply@${slug(pick(5))}.com are routed to our applicant tracking system.`,
      url: `https://${slug(pick(5))}.com/jobs/${seed % 2000}`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: pick(6),
      description: `${role} at ${pick(6)}. Salary ₹15,000 per month. Send CV to jobs@${slug(pick(6))}.in.`,
      url: `https://${slug(pick(6))}.in/jobs`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: "Acme Retail Tech Pvt Ltd",
      description: `Acme Retail Tech is hiring a ${role} in ${city}. Send your CV to careers@acmeretailtech.in.`,
      url: "https://acmeretailtech.in/careers/42",
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: "Workline Careers",
      description: `Our client Blue Ocean Systems is hiring a ${role} for their ${city} office. Interested candidates can send their CV to apply@worklinecareers.in.`,
      url: "https://worklinecareers.in/jobs/blue-ocean",
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: role,
      company: "Retail Careers Hub",
      description: `Hiring a ${role} for an established retail technology team in ${city}. Send your resume to jobs@acmeretailtech.com.`,
      url: "https://acmeretailtech.com/openings/9",
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
    {
      title: `${role} Intern`,
      company: pick(7),
      description: `6-month internship as ${role} Intern. Stipend provided. Email internships@${slug(pick(7))}.com.`,
      url: `https://${slug(pick(7))}.com/interns`,
      salaryMinLpa: null,
      salaryMaxLpa: null,
    },
  ];

  return posts.map((p, i) => {
    const { remoteOverride, ...rest } = p;
    const isRemote = remote || !!remoteOverride;
    return {
      ...rest,
      key: `mock:${sha1(`${pair.role}|${pair.location}|${runDate}|${i}`).slice(0, 24)}`,
      source: "mock" as const,
      location: remoteOverride && !remote ? `${location} (Remote)` : location,
      isRemote,
      postedAt: new Date(base - i * 3600_000).toISOString(),
    };
  });
}
