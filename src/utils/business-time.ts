// The business runs on India time. Every database connection uses it as its
// session time zone (config/db.ts), so "today", "this month" and plain-date
// filters in SQL all mean the India calendar day - the server itself is UTC.
export const BUSINESS_TIMEZONE = "Asia/Kolkata";
