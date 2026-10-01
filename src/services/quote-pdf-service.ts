import PDFDocument from "pdfkit";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadVisibleToUser } from "./lead-service";

interface QuotePdfRow {
  quote_number: number;
  status: string;
  version_number: number;
  line_items: { description: string; quantity: number; unitPrice: number; taxPercent: number; lineTotal: number }[];
  subtotal: string;
  tax_total: string;
  grand_total: string;
  notes: string | null;
  created_at: string;
  lead_id: string;
  lead_full_name: string;
  lead_phone: string | null;
  lead_email: string | null;
  lead_company_name: string | null;
  opportunity_name: string | null;
  created_by_name: string | null;
}

// currencyDisplay: "code" ("INR 5,00,000.00") instead of the ₹ symbol -
// pdfkit's built-in Helvetica is a WinAnsi Standard-14 font with no ₹
// glyph (U+20B9), so the symbol silently renders as a garbled superscript
// character. Embedding a Unicode font would fix it but pulls in a font
// file that has to be portable across wherever this actually deploys, not
// just this dev machine - the currency code is correct, unambiguous, and
// needs nothing extra.
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", currencyDisplay: "code", maximumFractionDigits: 2 });

async function getQuoteForPdf(quoteId: string, requestingUserId: string): Promise<QuotePdfRow> {
  const result = await pool.query<QuotePdfRow>(
    `SELECT q.quote_number, q.status, q.created_at, q.lead_id,
       qv.version_number, qv.line_items, qv.subtotal, qv.tax_total, qv.grand_total, qv.notes,
       l.full_name AS lead_full_name, l.phone AS lead_phone, l.email AS lead_email, l.company_name AS lead_company_name,
       o.name AS opportunity_name, u.name AS created_by_name
     FROM quotes q
     JOIN quote_versions qv ON qv.quote_id = q.id AND qv.version_number = q.current_version
     JOIN leads l ON l.id = q.lead_id
     LEFT JOIN opportunities o ON o.id = q.opportunity_id
     LEFT JOIN users u ON u.id = q.created_by
     WHERE q.id = $1`,
    [quoteId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Quote not found");
  }
  const row = result.rows[0];
  const leadVisible = await isLeadVisibleToUser(row.lead_id, requestingUserId);
  if (!leadVisible) {
    throw new ApiError(403, "You do not have access to this quote");
  }
  return row;
}

// A real PDF, generated from exactly the same current-version data the
// Quotes module itself displays - never a separately-maintained template
// that could drift from what's actually on screen. No company
// name/logo/letterhead here: FieldForce has no stored "our company"
// branding setting anywhere yet, so one isn't invented for this document;
// it identifies itself plainly as a FieldForce CRM export instead.
export async function buildQuotePdf(quoteId: string, requestingUserId: string): Promise<{ stream: PDFKit.PDFDocument; filename: string }> {
  const row = await getQuoteForPdf(quoteId, requestingUserId);
  const quoteLabel = `Q-${String(row.quote_number).padStart(5, "0")}`;

  const doc = new PDFDocument({ size: "A4", margin: 50 });

  const primary = "#1354e0";
  const textPrimary = "#1a1a1a";
  const textMuted = "#6b7280";
  const borderColor = "#e5e7eb";

  doc.fillColor(primary).fontSize(22).font("Helvetica-Bold").text(quoteLabel, { continued: false });
  doc
    .fillColor(textMuted)
    .fontSize(10)
    .font("Helvetica")
    .text(`Version ${row.version_number} · ${row.status.toUpperCase()} · ${new Date(row.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`);

  doc.moveDown(1.2);

  // Bill-to / meta two-column block
  const topY = doc.y;
  doc.fillColor(textMuted).fontSize(9).font("Helvetica-Bold").text("QUOTED TO", 50, topY);
  doc.fillColor(textPrimary).fontSize(11).font("Helvetica-Bold").text(row.lead_full_name, 50, topY + 14);
  let leadDetailY = topY + 30;
  if (row.lead_company_name) {
    doc.fillColor(textMuted).fontSize(10).font("Helvetica").text(row.lead_company_name, 50, leadDetailY);
    leadDetailY += 14;
  }
  if (row.lead_phone) {
    doc.fillColor(textMuted).fontSize(10).text(row.lead_phone, 50, leadDetailY);
    leadDetailY += 14;
  }
  if (row.lead_email) {
    doc.fillColor(textMuted).fontSize(10).text(row.lead_email, 50, leadDetailY);
    leadDetailY += 14;
  }

  doc.fillColor(textMuted).fontSize(9).font("Helvetica-Bold").text("OPPORTUNITY", 320, topY);
  doc
    .fillColor(textPrimary)
    .fontSize(10)
    .font("Helvetica")
    .text(row.opportunity_name ?? "-", 320, topY + 14);
  doc.fillColor(textMuted).fontSize(9).font("Helvetica-Bold").text("PREPARED BY", 320, topY + 36);
  doc
    .fillColor(textPrimary)
    .fontSize(10)
    .font("Helvetica")
    .text(row.created_by_name ?? "-", 320, topY + 50);

  doc.y = Math.max(leadDetailY, topY + 70) + 16;

  // Line items table
  const tableTop = doc.y;
  const colX = { description: 50, qty: 300, unitPrice: 350, tax: 430, total: 480 };
  const colW = { total: 70 };

  doc.rect(50, tableTop, 495, 20).fill("#f8f9fb");
  doc
    .fillColor(textMuted)
    .fontSize(8.5)
    .font("Helvetica-Bold")
    .text("DESCRIPTION", colX.description + 6, tableTop + 6)
    .text("QTY", colX.qty, tableTop + 6, { width: 40, align: "right" })
    .text("UNIT PRICE", colX.unitPrice, tableTop + 6, { width: 70, align: "right" })
    .text("TAX %", colX.tax, tableTop + 6, { width: 40, align: "right" })
    .text("TOTAL", colX.total, tableTop + 6, { width: colW.total, align: "right" });

  let rowY = tableTop + 24;
  for (const item of row.line_items) {
    const rowHeight = 20;
    doc
      .fillColor(textPrimary)
      .fontSize(9.5)
      .font("Helvetica")
      .text(item.description, colX.description + 6, rowY, { width: 240 })
      .text(String(item.quantity), colX.qty, rowY, { width: 40, align: "right" })
      .text(INR.format(item.unitPrice), colX.unitPrice, rowY, { width: 70, align: "right" })
      .text(`${item.taxPercent}%`, colX.tax, rowY, { width: 40, align: "right" })
      .font("Helvetica-Bold")
      .text(INR.format(item.lineTotal), colX.total, rowY, { width: colW.total, align: "right" });
    doc
      .moveTo(50, rowY + rowHeight - 4)
      .lineTo(545, rowY + rowHeight - 4)
      .strokeColor(borderColor)
      .lineWidth(0.5)
      .stroke();
    rowY += rowHeight;
  }

  rowY += 10;
  // Wide enough for "INR 99,99,99,999.00" in bold at the Grand total size -
  // the previous, narrower value column wrapped a plain 7-figure total
  // onto two lines (the same "a number must never wrap" bug fixed earlier
  // in the Leads list UI), which read as broken on a document a customer
  // actually sees.
  const summaryX = 310;
  const summaryLabelW = 90;
  const summaryValueW = 145;
  doc
    .fillColor(textMuted)
    .fontSize(10)
    .font("Helvetica")
    .text("Subtotal", summaryX, rowY, { width: summaryLabelW })
    .fillColor(textPrimary)
    .text(INR.format(Number(row.subtotal)), summaryX + summaryLabelW, rowY, { width: summaryValueW, align: "right" });
  rowY += 16;
  doc
    .fillColor(textMuted)
    .text("Tax", summaryX, rowY, { width: summaryLabelW })
    .fillColor(textPrimary)
    .text(INR.format(Number(row.tax_total)), summaryX + summaryLabelW, rowY, { width: summaryValueW, align: "right" });
  rowY += 18;
  doc.moveTo(summaryX, rowY).lineTo(545, rowY).strokeColor(borderColor).lineWidth(0.5).stroke();
  rowY += 8;
  doc
    .fillColor(textPrimary)
    .fontSize(13)
    .font("Helvetica-Bold")
    .text("Grand total", summaryX, rowY, { width: summaryLabelW })
    .fillColor(primary)
    .text(INR.format(Number(row.grand_total)), summaryX + summaryLabelW, rowY, { width: summaryValueW, align: "right" });

  if (row.notes) {
    rowY += 36;
    doc.fillColor(textMuted).fontSize(8.5).font("Helvetica-Bold").text("NOTES", 50, rowY);
    doc
      .fillColor(textPrimary)
      .fontSize(9.5)
      .font("Helvetica")
      .text(row.notes, 50, rowY + 12, { width: 495 });
  }

  doc
    .fontSize(8)
    .fillColor(textMuted)
    .text("Generated by FieldForce CRM", 50, 780, { width: 495, align: "center" });

  // Not ended here - the caller pipes this to the HTTP response first, then
  // ends it, so the stream always has a consumer attached before it starts
  // flushing (the standard pdfkit-with-Express ordering).
  return { stream: doc, filename: `${quoteLabel}.pdf` };
}
