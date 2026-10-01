import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadVisibleToUser } from "./lead-service";
import { isOpportunityVisibleToUser } from "./opportunity-service";

export interface QuoteLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
}

interface ComputedLineItem extends QuoteLineItemInput {
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface CreateQuoteInput {
  leadId: string;
  opportunityId: string;
  lineItems: QuoteLineItemInput[];
  notes?: string;
}

export interface UpdateQuoteInput {
  lineItems: QuoteLineItemInput[];
  notes?: string;
  changeSummary?: string;
}

export interface ListQuotesFilters {
  leadId?: string;
  opportunityId?: string;
  status?: string;
  search?: string;
  page: number;
  limit: number;
}

interface QuoteRow {
  id: string;
  quote_number: number;
  lead_id: string;
  opportunity_id: string;
  status: string;
  current_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteListRow extends QuoteRow {
  lead_full_name: string;
  opportunity_name: string | null;
  created_by_name: string | null;
  grand_total: string;
}

interface QuoteVersionRow {
  id: string;
  quote_id: string;
  version_number: number;
  line_items: ComputedLineItem[];
  subtotal: string;
  tax_total: string;
  grand_total: string;
  notes: string | null;
  change_summary: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
}

// Quote-level arithmetic is always recomputed here from the raw inputs,
// never trusted from the frontend - the same "server is the source of
// truth for money" rule the rest of this app already follows for deal
// value/probability. Per-line tax (not one quote-wide rate) because real
// GST slabs differ by item (5%/12%/18%) within the same quote.
function computeTotals(lineItems: QuoteLineItemInput[]): { computed: ComputedLineItem[]; subtotal: number; taxTotal: number; grandTotal: number } {
  const computed = lineItems.map((item) => {
    const lineSubtotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
    const lineTax = Math.round(lineSubtotal * (item.taxPercent / 100) * 100) / 100;
    return { ...item, lineSubtotal, lineTax, lineTotal: Math.round((lineSubtotal + lineTax) * 100) / 100 };
  });
  const subtotal = Math.round(computed.reduce((sum, i) => sum + i.lineSubtotal, 0) * 100) / 100;
  const taxTotal = Math.round(computed.reduce((sum, i) => sum + i.lineTax, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
  return { computed, subtotal, taxTotal, grandTotal };
}

function quoteLabel(quoteNumber: number): string {
  return `Q-${String(quoteNumber).padStart(5, "0")}`;
}

function toPublicQuote(row: QuoteRow) {
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    quoteLabel: quoteLabel(row.quote_number),
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    currentVersion: row.current_version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicQuoteListItem(row: QuoteListRow) {
  return {
    ...toPublicQuote(row),
    leadFullName: row.lead_full_name,
    opportunityName: row.opportunity_name,
    createdByName: row.created_by_name,
    grandTotal: Number(row.grand_total),
  };
}

function toPublicQuoteVersion(row: QuoteVersionRow) {
  return {
    id: row.id,
    quoteId: row.quote_id,
    versionNumber: row.version_number,
    lineItems: row.line_items,
    subtotal: Number(row.subtotal),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    notes: row.notes,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
  };
}

async function assertLeadOpportunityPair(leadId: string, opportunityId: string): Promise<void> {
  const check = await pool.query<{ lead_id: string }>(
    "SELECT lead_id FROM opportunities WHERE id = $1 AND is_deleted = false",
    [opportunityId]
  );
  if (check.rows.length === 0 || check.rows[0].lead_id !== leadId) {
    throw new ApiError(400, "This opportunity does not belong to the selected lead");
  }
}

export async function createQuote(input: CreateQuoteInput, requestingUserId: string) {
  const leadVisible = await isLeadVisibleToUser(input.leadId, requestingUserId);
  if (!leadVisible) throw new ApiError(403, "You do not have access to this lead");
  const opportunityVisible = await isOpportunityVisibleToUser(input.opportunityId, requestingUserId);
  if (!opportunityVisible) throw new ApiError(403, "You do not have access to this opportunity");
  await assertLeadOpportunityPair(input.leadId, input.opportunityId);

  if (input.lineItems.length === 0) {
    throw new ApiError(422, "A quote needs at least one line item");
  }

  const { computed, subtotal, taxTotal, grandTotal } = computeTotals(input.lineItems);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query<QuoteRow>(
      `INSERT INTO quotes (lead_id, opportunity_id, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [input.leadId, input.opportunityId, requestingUserId]
    );
    const quote = quoteResult.rows[0];

    const versionResult = await client.query<QuoteVersionRow>(
      `INSERT INTO quote_versions (quote_id, version_number, line_items, subtotal, tax_total, grand_total, notes, change_summary, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'Initial version', $7)
       RETURNING *`,
      [quote.id, JSON.stringify(computed), subtotal, taxTotal, grandTotal, input.notes ?? null, requestingUserId]
    );
    await client.query("COMMIT");
    return { quote: toPublicQuote(quote), version: toPublicQuoteVersion(versionResult.rows[0]) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Every edit is a brand-new quote_versions row, never an UPDATE of an
// existing one - versions are immutable history, not a mutable draft, so
// "what did we actually send the customer on 12 Sept" is always
// answerable from quote_versions directly rather than reconstructed from
// an audit log.
export async function updateQuote(quoteId: string, input: UpdateQuoteInput, requestingUserId: string) {
  const quote = await getQuoteRow(quoteId, requestingUserId);

  if (input.lineItems.length === 0) {
    throw new ApiError(422, "A quote needs at least one line item");
  }

  const { computed, subtotal, taxTotal, grandTotal } = computeTotals(input.lineItems);
  const nextVersion = quote.current_version + 1;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const versionResult = await client.query<QuoteVersionRow>(
      `INSERT INTO quote_versions (quote_id, version_number, line_items, subtotal, tax_total, grand_total, notes, change_summary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [quoteId, nextVersion, JSON.stringify(computed), subtotal, taxTotal, grandTotal, input.notes ?? null, input.changeSummary ?? null, requestingUserId]
    );
    const quoteResult = await client.query<QuoteRow>(
      `UPDATE quotes SET current_version = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [nextVersion, quoteId]
    );
    await client.query("COMMIT");
    return { quote: toPublicQuote(quoteResult.rows[0]), version: toPublicQuoteVersion(versionResult.rows[0]) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateQuoteStatus(quoteId: string, status: string, requestingUserId: string) {
  await getQuoteRow(quoteId, requestingUserId);
  const result = await pool.query<QuoteRow>(
    `UPDATE quotes SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, quoteId]
  );
  return toPublicQuote(result.rows[0]);
}

async function getQuoteRow(quoteId: string, requestingUserId: string): Promise<QuoteRow> {
  const result = await pool.query<QuoteRow>("SELECT * FROM quotes WHERE id = $1", [quoteId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Quote not found");
  }
  const quote = result.rows[0];
  const leadVisible = await isLeadVisibleToUser(quote.lead_id, requestingUserId);
  if (!leadVisible) {
    throw new ApiError(403, "You do not have access to this quote");
  }
  return quote;
}

export async function getQuoteById(quoteId: string, requestingUserId: string) {
  const quote = await getQuoteRow(quoteId, requestingUserId);
  const versionsResult = await pool.query<QuoteVersionRow>(
    `SELECT qv.*, u.name AS created_by_name
     FROM quote_versions qv
     LEFT JOIN users u ON u.id = qv.created_by
     WHERE qv.quote_id = $1
     ORDER BY qv.version_number DESC`,
    [quoteId]
  );
  return {
    quote: toPublicQuote(quote),
    currentVersion: toPublicQuoteVersion(versionsResult.rows[0]),
    versions: versionsResult.rows.map(toPublicQuoteVersion),
  };
}

export async function listQuotesForLead(leadId: string, requestingUserId: string) {
  const leadVisible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!leadVisible) throw new ApiError(403, "You do not have access to this lead");

  const result = await pool.query<QuoteListRow>(
    `SELECT q.*, l.full_name AS lead_full_name, o.name AS opportunity_name, u.name AS created_by_name,
       qv.grand_total
     FROM quotes q
     JOIN leads l ON l.id = q.lead_id
     LEFT JOIN opportunities o ON o.id = q.opportunity_id
     LEFT JOIN users u ON u.id = q.created_by
     JOIN quote_versions qv ON qv.quote_id = q.id AND qv.version_number = q.current_version
     WHERE q.lead_id = $1
     ORDER BY q.created_at DESC`,
    [leadId]
  );
  return result.rows.map(toPublicQuoteListItem);
}

export async function listQuotesForOpportunity(opportunityId: string, requestingUserId: string) {
  const opportunityVisible = await isOpportunityVisibleToUser(opportunityId, requestingUserId);
  if (!opportunityVisible) throw new ApiError(403, "You do not have access to this opportunity");

  const result = await pool.query<QuoteListRow>(
    `SELECT q.*, l.full_name AS lead_full_name, o.name AS opportunity_name, u.name AS created_by_name,
       qv.grand_total
     FROM quotes q
     JOIN leads l ON l.id = q.lead_id
     LEFT JOIN opportunities o ON o.id = q.opportunity_id
     LEFT JOIN users u ON u.id = q.created_by
     JOIN quote_versions qv ON qv.quote_id = q.id AND qv.version_number = q.current_version
     WHERE q.opportunity_id = $1
     ORDER BY q.created_at DESC`,
    [opportunityId]
  );
  return result.rows.map(toPublicQuoteListItem);
}

// The main Quotes module list - same subtree-visibility rule as
// leads/opportunities (a quote is visible exactly when its lead is),
// applied once via a join rather than re-querying isLeadVisibleToUser per
// row.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

export async function listQuotes(requestingUserId: string, filters: ListQuotesFilters) {
  const conditions: string[] = [
    `(l.owner_id IN (SELECT id FROM subtree) OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1))`,
  ];
  const params: unknown[] = [requestingUserId];

  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`q.lead_id = $${params.length}`);
  }
  if (filters.opportunityId) {
    params.push(filters.opportunityId);
    conditions.push(`q.opportunity_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`q.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(l.full_name ILIKE $${params.length} OR o.name ILIKE $${params.length} OR CAST(q.quote_number AS TEXT) ILIKE $${params.length})`);
  }

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE}
     SELECT COUNT(*) FROM quotes q
     JOIN leads l ON l.id = q.lead_id
     LEFT JOIN opportunities o ON o.id = q.opportunity_id
     WHERE ${conditions.join(" AND ")}`,
    params
  );

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;
  const listParams = [...params, limit, offset];

  const result = await pool.query<QuoteListRow>(
    `${SUBTREE_CTE}
     SELECT q.*, l.full_name AS lead_full_name, o.name AS opportunity_name, u.name AS created_by_name,
       qv.grand_total
     FROM quotes q
     JOIN leads l ON l.id = q.lead_id
     LEFT JOIN opportunities o ON o.id = q.opportunity_id
     LEFT JOIN users u ON u.id = q.created_by
     JOIN quote_versions qv ON qv.quote_id = q.id AND qv.version_number = q.current_version
     WHERE ${conditions.join(" AND ")}
     ORDER BY q.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { quotes: result.rows.map(toPublicQuoteListItem), total: Number(countResult.rows[0].count) };
}
