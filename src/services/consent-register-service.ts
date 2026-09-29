import { pool } from "../config/db";

// consents.purposes is real but free-text (see createLead's consent block
// and qr-campaign-service's hardcoded QR capture string) - there is no fixed
// enum anywhere in FieldForce today. This keyword classification is a real,
// deterministic grouping of that real text into a fixed taxonomy for
// reporting purposes; it is not itself stored anywhere, so re-running it
// against the same data always gives the same answer. "Transactional
// communication" is the fallback bucket for anything that doesn't match a
// more specific keyword (which is also where the QR capture flow's fixed
// "Contact regarding this enquiry (DPDP)" text lands).
const PURPOSE_BUCKETS: { key: string; label: string; match: (text: string) => boolean }[] = [
  { key: "marketing", label: "Marketing - email & WhatsApp", match: (t) => /market/.test(t) },
  { key: "call_recording", label: "Call recording", match: (t) => /call|record/.test(t) },
  { key: "onboarding_sharing", label: "Data sharing with onboarding app", match: (t) => /onboard/.test(t) },
  { key: "profiling", label: "Profiling for lead scoring", match: (t) => /profil|scor/.test(t) },
  { key: "transactional", label: "Transactional communication", match: () => true },
];

function classifyPurpose(purposes: string | null): { key: string; label: string } {
  const text = (purposes ?? "").toLowerCase();
  const bucket = PURPOSE_BUCKETS.find((b) => b.key !== "transactional" && b.match(text)) ?? PURPOSE_BUCKETS[PURPOSE_BUCKETS.length - 1];
  return { key: bucket.key, label: bucket.label };
}

interface ConsentRow {
  purposes: string | null;
  captured: boolean;
}

export async function getConsentRegister() {
  const result = await pool.query<ConsentRow>("SELECT purposes, captured FROM consents");

  const counts = new Map<string, { label: string; granted: number; pending: number }>();
  for (const b of PURPOSE_BUCKETS) counts.set(b.key, { label: b.label, granted: 0, pending: 0 });

  for (const row of result.rows) {
    const bucket = classifyPurpose(row.purposes);
    const entry = counts.get(bucket.key)!;
    if (row.captured) entry.granted += 1;
    else entry.pending += 1;
  }

  return PURPOSE_BUCKETS.map((b) => {
    const entry = counts.get(b.key)!;
    const total = entry.granted + entry.pending;
    const status = total === 0 ? "no_data" : entry.pending === 0 ? "granted" : entry.granted === 0 ? "pending" : "mixed";
    return { key: b.key, label: b.label, granted: entry.granted, pending: entry.pending, total, status };
  });
}

interface ConsentRecordRow {
  id: string;
  lead_id: string;
  lead_full_name: string;
  lead_number: number | null;
  purposes: string | null;
  method: string | null;
  captured: boolean;
  status: string;
  captured_at: string | null;
  created_at: string;
}

export async function listConsentRecords() {
  const result = await pool.query<ConsentRecordRow>(
    `SELECT c.id, c.lead_id, l.full_name AS lead_full_name, l.lead_number AS lead_number,
       c.purposes, c.method, c.captured, c.status, c.captured_at, c.created_at
     FROM consents c
     JOIN leads l ON l.id = c.lead_id
     ORDER BY c.created_at DESC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    leadName: row.lead_full_name,
    leadNumber: row.lead_number,
    purposeBucket: classifyPurpose(row.purposes).label,
    purposesRaw: row.purposes,
    method: row.method,
    captured: row.captured,
    status: row.status,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  }));
}
