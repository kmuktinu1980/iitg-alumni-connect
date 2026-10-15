export const STUDENT_EMAIL_DOMAIN = "iitg.ac.in";

/**
 * What alumni can advise on, grouped the way IIT Guwahati is organized: its
 * departments, schools and research centres, the careers its graduates go
 * into, higher studies, and the startup and club ecosystem on campus
 * (Technical Board clubs, EDC, Technology Incubation Centre).
 * Comments name the IITG unit each area maps to.
 */
export const ADVICE_GROUPS = [
  {
    title: "Technical domains",
    hint: "Mapped to IITG departments, schools and research centres",
    areas: [
      "Software & systems engineering", // CSE
      "AI, machine learning & data science", // Mehta Family School of DS&AI, DSAI B.Tech
      "Cybersecurity & networks", // CSE
      "VLSI & semiconductor design", // EEE
      "Embedded systems & IoT", // EEE, Electronics Club
      "Communications & signal processing", // EEE (ECE)
      "Power systems & electric vehicles", // EEE, School of Energy
      "Robotics, drones & autonomous systems", // ME, Robotics & Aeromodelling Clubs, cyber-physical systems & drone research
      "Automotive & mechanical design", // ME, Automobile Club (SAE)
      "Manufacturing & advanced materials", // ME, Chemistry
      "Nanotechnology & flexible electronics", // Centre for Nanotechnology
      "Structures, geotechnics & infrastructure", // Civil
      "Water, floods & disaster management", // Civil, Sustainable Water Research, Disaster Management & Research
      "Climate, environment & sustainability", // School of Interdisciplinary Studies & Sustainability, Prakriti Club
      "Energy & renewables", // School of Energy Science & Engineering, Energy B.Tech
      "Oil, gas & process industries", // Chemical Engineering, CST
      "Polymers & sustainable materials", // Chemical, Sustainable Polymers research
      "Biotech & bioprocess engineering", // Biosciences & Bioengineering
      "Medical devices & health technology", // Jyoti & Bhupat Mehta School of Health Sciences & Technology
      "Quantum, photonics & applied physics", // Physics, Engineering Physics
      "Mathematical modelling & scientific computing", // Mathematics, MnC
      "Product, UX & interaction design", // Design
      "Language technology & NLP", // Centre for Linguistic Science & Technology
      "Agritech & rural technology", // School of Agro & Rural Technology
      "Defence & national security technology", // Manekshaw Centre for National Security Studies
      "Space science & astronomy", // Physics, Equinox Club
    ],
  },
  {
    title: "Careers & industries",
    hint: "Where IITG graduates go after campus",
    areas: [
      "Software & Big Tech roles",
      "Core engineering & PSU jobs",
      "Semiconductor & hardware industry",
      "Quant, trading & fintech", // MnC, Finance & Economics Club
      "Consulting & business analytics", // Consulting & Analytics Club
      "Product management",
      "Investment banking & finance",
      "Civil services & public policy",
      "Working abroad",
    ],
  },
  {
    title: "Higher studies & research",
    hint: "",
    areas: [
      "MS & PhD applications abroad",
      "MBA & management programs", // School of Business
      "GATE, M.Tech & PSU recruitment",
      "Research careers & publishing",
    ],
  },
  {
    title: "Startups & campus",
    hint: "EDC, Technology Incubation Centre, Technical Board clubs",
    areas: [
      "Founding a startup", // EDC, Technology Incubation Centre, Research Park
      "Fundraising & early-stage investing",
      "Internship & placement prep",
      "Competitive programming & hackathons", // Coding Club
      "Club projects & competitions (SAE, Inter-IIT)", // Technical Board
      "Switching fields or branch",
    ],
  },
] as const;

export const ADVICE_AREAS = ADVICE_GROUPS.flatMap((g) => g.areas) as unknown as readonly [string, ...string[]];

export const BRANCHES = [
  "CSE", "ECE", "EEE", "ME", "CE", "CL (Chemical)", "CST", "BSBE", "EP", "MnC", "DSAI", "Energy", "Design", "Other",
] as const;

export const DEGREES = ["B.Tech", "B.Des", "Dual degree", "M.Tech", "M.Sc", "MA", "MBA", "PhD", "Other"] as const;

export const YEARS = ["1st year", "2nd year", "3rd year", "4th year", "5th year"] as const;

export const DURATIONS = [30, 45, 60] as const;

export const MAX_UPCOMING_BOOKINGS = 3;
/** Students book at least this far ahead. Must match public.min_notice() in the database. */
export const MIN_NOTICE_HOURS = 48;
export const minNoticeCutoff = () => new Date(Date.now() + MIN_NOTICE_HOURS * 3600 * 1000);
export const MATCHES_PER_DAY = 20;

export function isStudentEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith("@" + STUDENT_EMAIL_DOMAIN);
}
