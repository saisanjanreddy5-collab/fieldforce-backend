import { z } from "zod";

const uuid = z.string().uuid();

// Blank is fine (phone is optional on a lead), but a non-blank value must be
// a real 10-digit mobile number - this is what was missing: nothing here
// ever actually checked the shape, letting garbage into a field Smartflo
// then tries to dial.
const tenDigitPhone = z
  .union([z.literal(""), z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number")])
  .optional();

const consentInputSchema = z.object({
  captured: z.boolean().optional(),
  method: z.string().optional(),
  purposes: z.string().optional(),
  evidenceRef: z.string().optional(),
  notes: z.string().optional(),
});

export const createLeadSchema = z.object({
  // Customer tab
  fullName: z.string().min(1, "Full name is required"),
  contactName: z.string().optional(),
  profession: z.string().optional(),
  startDate: z.string().optional(),
  qualifiedPerson: z.string().optional(),
  financialStatus: z.string().optional(),
  status: z.string().optional(),
  prospectStatus: z.string().optional(),
  category: z.string().optional(),
  ownerId: uuid.optional(),
  salesTeamId: uuid.optional(),
  leadScore: z.coerce.number().min(0).max(100).optional(),

  // Contact tab
  phone: tenDigitPhone,
  altPhone: tenDigitPhone,
  email: z.string().email().optional(),
  website: z.string().optional(),
  preferredLanguage: z.string().optional(),
  // Trimmed - matches the real-world incident that found this: a stray
  // trailing space typed into this field (invisible in the UI) made it
  // compare unequal to a field employee's own exactly-stored pincode in
  // employee_pincodes (that side already trims - see auth-validator.ts/
  // user-validator.ts), silently breaking Send to Field Sales's matching
  // and triggering the fallback-to-random-employee path with no warning.
  pincode: z.string().trim().optional(),
  zoneId: uuid.optional(),
  stateId: uuid.optional(),
  districtId: uuid.optional(),
  areaId: uuid.optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  territory: z.string().optional(),

  // Inquiry tab
  companyName: z.string().optional(),
  source: z.string().optional(),
  inquiryCategory: z.string().optional(),
  inquirySource: z.string().optional(),
  captureChannel: z.string().optional(),
  utmTags: z.string().optional(),
  campaignId: uuid.optional(),
  expectedValue: z.coerce.number().optional(),
  receivedAt: z.string().optional(),
  internalNotes: z.string().optional(),
  rmRemark: z.string().optional(),
  lgRemark: z.string().optional(),

  // Store tab
  hasStoreLocation: z.boolean().optional(),
  storeName: z.string().optional(),
  storeAddress: z.string().optional(),
  storePincode: z.string().optional(),
  storeCity: z.string().optional(),
  storeState: z.string().optional(),
  carpetArea: z.coerce.number().min(0).optional(),
  frontage: z.coerce.number().min(0).optional(),
  ownership: z.string().optional(),
  investmentCapacity: z.coerce.number().optional(),
  existingBusiness: z.string().optional(),
  expectedOpening: z.string().optional(),
  gstNumber: z.string().optional(),
  // Blank is fine, but a non-blank value must be a real PAN: 5 letters, 4
  // digits, 1 letter (e.g. ABCDE1234F) - the standard format every Indian
  // PAN follows, case-insensitive on entry but always stored uppercase.
  panNumber: z
    .union([z.literal(""), z.string().regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, "Enter a valid PAN (e.g. ABCDE1234F)")])
    .transform((v) => (v ? v.toUpperCase() : v))
    .optional(),
  drugLicenceNumber: z.string().optional(),
  fssaiNumber: z.string().optional(),

  // FOFO onboarding handoff
  entityType: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  // Free text by design ("Baner - 6.2 km" mixes a store name with a
  // distance) - not worth splitting into separate fields, but a negative
  // number anywhere in it is never legitimate.
  nearestCocoStore: z.string().refine((v) => !/-\d/.test(v), "Can't contain a negative number").optional(),
  signageStatus: z.string().optional(),
  securityDeposit: z.coerce.number().optional(),
  openingStock: z.coerce.number().optional(),
  // Same reasoning as nearestCocoStore above - "Slab B — 22%" mixes a tier
  // label with a rate, stays free text, just can't go negative.
  marginSlab: z.string().refine((v) => !/-\d/.test(v), "Can't contain a negative number").optional(),
  creditLimitRequested: z.coerce.number().optional(),
  creditCategory: z.string().optional(),
  paymentTerms: z.coerce.number().min(0).int().optional(),
  targetGoLive: z.string().optional(),

  // Consent tab - written to the separate consents table
  consent: consentInputSchema.optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

// Deliberately separate from createLeadSchema, not a subset of it - that
// one uses z.string().email() etc. for a human typing one lead directly,
// where rejecting a bad value immediately is the right UX. Bulk-imported
// spreadsheet data is messier and the whole point of importing 500 rows is
// that one bad email shouldn't block the other 499 - so this is lenient on
// purpose, and only ever safeParse'd per-row inside bulkImportLeads, never
// parsed as a whole array through validateBody (which fails the entire
// request on the first invalid element, defeating per-row reporting).
export const bulkImportRowSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  email: z.string().optional(),
  companyName: z.string().optional(),
  category: z.string().optional(),
  territory: z.string().optional(),
  // Needed for the Call Center -> Field Sales pincode-matching engine
  // (lead-call-center-service.ts) to have anything to match a marketing
  // lead against - without it the row still imports, it just can't ever be
  // sent to a field employee automatically. Not yet required at the schema
  // level; the mandatory-on-import UX is a frontend-side decision (the
  // import template/column-mapping step). Trimmed for the same reason as
  // createLeadSchema's own pincode field above.
  pincode: z.string().trim().optional(),
  source: z.string().optional(),
  expectedValue: z.coerce.number().optional(),
  website: z.string().optional(),
  internalNotes: z.string().optional(),
  // Who this row starts out assigned to (by email, resolved server-side in
  // bulkImportLeads) - purely a starting owner, never an access gate: every
  // Call Center Executive can see and work this lead regardless of who it's
  // assigned to (TIER_TEAMMATE_CLAUSE in lead-service.ts). A blank cell, or
  // an email that doesn't match an active Call Center Executive, falls back
  // to the normal round-robin assignment - never rejects the row.
  assignedToEmail: z.string().trim().optional(),
});

// The only schema actually passed to validateBody for this route - just
// structural (an array of plain row-objects, capped), so one malformed row
// can't 400 the whole request before bulkImportLeads gets a chance to
// report it individually.
export const bulkImportLeadsSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "No rows to import")
    .max(5000, "Too many rows - max 5,000 per import"),
});

export const shareLeadSchema = z.object({
  userId: uuid,
});

// Query-string booleans arrive as the literal strings "true"/"false" (or
// are absent) - z.coerce.boolean() would treat "false" as truthy since any
// non-empty string coerces to true, so this maps the two real string
// values explicitly instead.
const queryBoolean = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const listLeadsQuerySchema = z.object({
  status: z.string().optional(),
  ownerId: uuid.optional(),
  zoneId: uuid.optional(),
  stateId: uuid.optional(),
  districtId: uuid.optional(),
  areaId: uuid.optional(),
  search: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  overdueOnly: queryBoolean,
  highScoreOnly: queryBoolean,
  unassignedOnly: queryBoolean,
  // When the lead actually came into the CRM (created_at), not any later
  // activity - a plain calendar date, inclusive on both ends (createdTo's
  // whole day counts, not just midnight).
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Same filters as the Leads page itself, minus pagination - Export always
// returns every matching row, not one page.
export const listLeadsExportQuerySchema = listLeadsQuerySchema.omit({ page: true, limit: true });
