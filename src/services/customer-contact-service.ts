import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";

interface CustomerContactRow {
  id: string;
  customer_id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

function toPublicContact(row: CustomerContactRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertInScope(customerId: string, requestingUserId: string): Promise<void> {
  const inScope = await isCustomerInScope(customerId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this customer");
  }
}

export async function listContacts(customerId: string, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<CustomerContactRow>(
    "SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, created_at ASC",
    [customerId]
  );
  return result.rows.map(toPublicContact);
}

export interface ContactInput {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export async function createContact(customerId: string, input: ContactInput, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);

  // Only one primary contact per customer - demote any existing one rather
  // than ending up with two, same "exactly one" rule a UI radio-button
  // would enforce, just applied here so the API itself can't be used to
  // violate it either.
  if (input.isPrimary) {
    await pool.query("UPDATE customer_contacts SET is_primary = false WHERE customer_id = $1", [customerId]);
  }

  const result = await pool.query<CustomerContactRow>(
    `INSERT INTO customer_contacts (customer_id, name, role, phone, email, is_primary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [customerId, input.name, input.role ?? null, input.phone ?? null, input.email ?? null, input.isPrimary ?? false, requestingUserId]
  );
  return toPublicContact(result.rows[0]);
}

async function getContactOrThrow(contactId: string): Promise<CustomerContactRow> {
  const result = await pool.query<CustomerContactRow>("SELECT * FROM customer_contacts WHERE id = $1", [contactId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Contact not found");
  }
  return result.rows[0];
}

export async function updateContact(contactId: string, input: Partial<ContactInput>, requestingUserId: string) {
  const existing = await getContactOrThrow(contactId);
  await assertInScope(existing.customer_id, requestingUserId);

  if (input.isPrimary) {
    await pool.query("UPDATE customer_contacts SET is_primary = false WHERE customer_id = $1 AND id <> $2", [
      existing.customer_id,
      contactId,
    ]);
  }

  const fieldMap: Record<string, unknown> = {
    name: input.name,
    role: input.role,
    phone: input.phone,
    email: input.email,
    is_primary: input.isPrimary,
  };
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return toPublicContact(existing);

  setClauses.push("updated_at = now()");
  params.push(contactId);
  const result = await pool.query<CustomerContactRow>(
    `UPDATE customer_contacts SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicContact(result.rows[0]);
}

export async function deleteContact(contactId: string, requestingUserId: string): Promise<void> {
  const existing = await getContactOrThrow(contactId);
  await assertInScope(existing.customer_id, requestingUserId);
  await pool.query("DELETE FROM customer_contacts WHERE id = $1", [contactId]);
}
