import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

export const TEMPLATE_CHANNELS = ["email", "whatsapp"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

interface MessageTemplateRow {
  id: string;
  key: string;
  name: string;
  channel: TemplateChannel;
  trigger_note: string | null;
  subject: string | null;
  body: string;
  status: "active" | "draft";
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function toPublicTemplate(row: MessageTemplateRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    channel: row.channel,
    triggerNote: row.trigger_note,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export async function listMessageTemplates(channel?: TemplateChannel) {
  const result = channel
    ? await pool.query<MessageTemplateRow>(
        "SELECT * FROM message_templates WHERE channel = $1 ORDER BY sort_order ASC",
        [channel]
      )
    : await pool.query<MessageTemplateRow>("SELECT * FROM message_templates ORDER BY sort_order ASC");
  return result.rows.map(toPublicTemplate);
}

export interface CreateMessageTemplateInput {
  key: string;
  name: string;
  channel: TemplateChannel;
  triggerNote?: string;
  subject?: string;
  body: string;
  status?: "active" | "draft";
}

export async function createMessageTemplate(input: CreateMessageTemplateInput) {
  const existing = await pool.query("SELECT 1 FROM message_templates WHERE key = $1", [input.key]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new ApiError(409, `A template with key '${input.key}' already exists`);
  }
  const sortOrderResult = await pool.query<{ max: number | null }>(
    "SELECT MAX(sort_order) AS max FROM message_templates"
  );
  const nextSortOrder = (sortOrderResult.rows[0]?.max ?? 0) + 1;

  const result = await pool.query<MessageTemplateRow>(
    `INSERT INTO message_templates (key, name, channel, trigger_note, subject, body, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'active'),$8)
     RETURNING *`,
    [input.key, input.name, input.channel, input.triggerNote ?? null, input.subject ?? null, input.body, input.status ?? null, nextSortOrder]
  );
  return toPublicTemplate(result.rows[0]);
}

export interface UpdateMessageTemplateInput {
  name?: string;
  triggerNote?: string | null;
  subject?: string | null;
  body?: string;
  status?: "active" | "draft";
}

export async function updateMessageTemplate(key: string, updates: UpdateMessageTemplateInput) {
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    trigger_note: updates.triggerNote,
    subject: updates.subject,
    body: updates.body,
    status: updates.status,
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    const existing = await pool.query<MessageTemplateRow>("SELECT * FROM message_templates WHERE key = $1", [key]);
    if (existing.rows.length === 0) throw new ApiError(404, `Template '${key}' not found`);
    return toPublicTemplate(existing.rows[0]);
  }

  setClauses.push("updated_at = now()");
  params.push(key);

  const result = await pool.query<MessageTemplateRow>(
    `UPDATE message_templates SET ${setClauses.join(", ")} WHERE key = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, `Template '${key}' not found`);
  }
  return toPublicTemplate(result.rows[0]);
}
