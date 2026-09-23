import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

export const DOCUMENT_TYPES = ["pan_card", "gst_certificate", "shop_photos", "rent_agreement", "cancelled_cheque", "consent_form"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  pan_card: "PAN card",
  gst_certificate: "GST certificate",
  shop_photos: "Shop photos",
  rent_agreement: "Rent agreement",
  cancelled_cheque: "Cancelled cheque",
  consent_form: "Consent form",
};

interface DocumentRow {
  id: string;
  lead_id: string;
  doc_type: DocumentType;
  status: "not_uploaded" | "in_review" | "verified" | "missing";
  file_path: string | null;
  original_filename: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toPublicDocument(row: DocumentRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    docType: row.doc_type,
    label: DOCUMENT_TYPE_LABELS[row.doc_type],
    status: row.status,
    originalFilename: row.original_filename,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    notes: row.notes,
    hasFile: row.file_path !== null,
  };
}

// Real, on-disk storage - the only file persistence anywhere in FieldForce
// today. Not cloud storage (nothing is configured to point at), but files
// genuinely survive and can be downloaded, unlike the DocumentsTab mock this
// replaces (component state only, lost on refresh).
const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "lead-documents");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export const documentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new ApiError(422, "Only JPG, PNG, WEBP or PDF files are accepted"));
      return;
    }
    cb(null, true);
  },
});

// One row per real document type per lead - created lazily on first view,
// same idempotent-lazy-create spirit as scheduled-transfer-service's
// applyDueTransfers.
export async function ensureDocumentRows(leadId: string): Promise<void> {
  for (const docType of DOCUMENT_TYPES) {
    await pool.query(
      `INSERT INTO lead_documents (lead_id, doc_type) VALUES ($1, $2)
       ON CONFLICT (lead_id, doc_type) DO NOTHING`,
      [leadId, docType]
    );
  }
}

export async function listDocuments(leadId: string) {
  await ensureDocumentRows(leadId);
  const result = await pool.query<DocumentRow>(
    "SELECT * FROM lead_documents WHERE lead_id = $1 ORDER BY created_at ASC",
    [leadId]
  );
  return result.rows.map(toPublicDocument);
}

async function getDocumentRow(documentId: string): Promise<DocumentRow> {
  const result = await pool.query<DocumentRow>("SELECT * FROM lead_documents WHERE id = $1", [documentId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Document not found");
  }
  return result.rows[0];
}

export async function getDocumentLeadId(documentId: string): Promise<string> {
  return (await getDocumentRow(documentId)).lead_id;
}

export async function saveUploadedFile(
  leadId: string,
  docType: string,
  file: Express.Multer.File,
  uploadedByUserId: string
) {
  if (!DOCUMENT_TYPES.includes(docType as DocumentType)) {
    fs.unlink(file.path, () => undefined);
    throw new ApiError(422, "Unknown document type");
  }

  const existing = await pool.query<{ file_path: string | null }>(
    "SELECT file_path FROM lead_documents WHERE lead_id = $1 AND doc_type = $2",
    [leadId, docType]
  );
  // Replacing a previous upload - remove the old file so they don't pile up.
  const previousPath = existing.rows[0]?.file_path;
  if (previousPath) {
    fs.unlink(previousPath, () => undefined);
  }

  const result = await pool.query<DocumentRow>(
    `INSERT INTO lead_documents (lead_id, doc_type, status, file_path, original_filename, uploaded_by, uploaded_at)
     VALUES ($1, $2, 'in_review', $3, $4, $5, now())
     ON CONFLICT (lead_id, doc_type) DO UPDATE SET
       status = 'in_review', file_path = $3, original_filename = $4, uploaded_by = $5, uploaded_at = now(), updated_at = now()
     RETURNING *`,
    [leadId, docType, file.path, file.originalname, uploadedByUserId]
  );
  return toPublicDocument(result.rows[0]);
}

export async function updateDocumentStatus(documentId: string, status: "verified" | "missing" | "in_review", notes?: string) {
  const result = await pool.query<DocumentRow>(
    `UPDATE lead_documents SET status = $1, notes = COALESCE($2, notes), updated_at = now() WHERE id = $3 RETURNING *`,
    [status, notes ?? null, documentId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Document not found");
  }
  return toPublicDocument(result.rows[0]);
}

export async function getDocumentFile(documentId: string): Promise<{ filePath: string; originalFilename: string }> {
  const row = await getDocumentRow(documentId);
  if (!row.file_path || !row.original_filename) {
    throw new ApiError(404, "No file has been uploaded for this document yet");
  }
  return { filePath: row.file_path, originalFilename: row.original_filename };
}

export async function deleteDocumentFile(documentId: string) {
  const row = await getDocumentRow(documentId);
  if (row.file_path) {
    fs.unlink(row.file_path, () => undefined);
  }
  const result = await pool.query<DocumentRow>(
    `UPDATE lead_documents SET status = 'not_uploaded', file_path = NULL, original_filename = NULL, uploaded_by = NULL, uploaded_at = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [documentId]
  );
  return toPublicDocument(result.rows[0]);
}
