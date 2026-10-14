export const STUDENT_EMAIL_DOMAIN = "iitg.ac.in";

export const ADVICE_AREAS = [
  "Career guidance",
  "Higher studies (MS / PhD)",
  "Research",
  "Startups & founding",
  "Internships & placements",
  "Interview prep",
  "Product management",
  "Software engineering",
  "Core engineering",
  "Data science & ML",
  "Hardware & semiconductors",
  "Consulting & finance",
  "Design",
  "Public policy & civil services",
] as const;

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
