import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isCustomerInScope } from "./customer-service";

interface CustomerAddressRow {
  id: string;
  customer_id: string;
  type: "billing" | "shipping";
  label: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  created_at: string;
  updated_at: string;
}

function toPublicAddress(row: CustomerAddressRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    type: row.type,
    label: row.label,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
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

export async function listAddresses(customerId: string, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<CustomerAddressRow>(
    "SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY type ASC, created_at ASC",
    [customerId]
  );
  return result.rows.map(toPublicAddress);
}

export interface AddressInput {
  type: "billing" | "shipping";
  label?: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export async function createAddress(customerId: string, input: AddressInput, requestingUserId: string) {
  await assertInScope(customerId, requestingUserId);
  const result = await pool.query<CustomerAddressRow>(
    `INSERT INTO customer_addresses (customer_id, type, label, address_line1, address_line2, city, state, pincode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      customerId,
      input.type,
      input.label ?? null,
      input.addressLine1,
      input.addressLine2 ?? null,
      input.city ?? null,
      input.state ?? null,
      input.pincode ?? null,
      requestingUserId,
    ]
  );
  return toPublicAddress(result.rows[0]);
}

async function getAddressOrThrow(addressId: string): Promise<CustomerAddressRow> {
  const result = await pool.query<CustomerAddressRow>("SELECT * FROM customer_addresses WHERE id = $1", [addressId]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Address not found");
  }
  return result.rows[0];
}

export async function updateAddress(addressId: string, input: Partial<AddressInput>, requestingUserId: string) {
  const existing = await getAddressOrThrow(addressId);
  await assertInScope(existing.customer_id, requestingUserId);

  const fieldMap: Record<string, unknown> = {
    type: input.type,
    label: input.label,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    city: input.city,
    state: input.state,
    pincode: input.pincode,
  };
  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return toPublicAddress(existing);

  setClauses.push("updated_at = now()");
  params.push(addressId);
  const result = await pool.query<CustomerAddressRow>(
    `UPDATE customer_addresses SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPublicAddress(result.rows[0]);
}

export async function deleteAddress(addressId: string, requestingUserId: string): Promise<void> {
  const existing = await getAddressOrThrow(addressId);
  await assertInScope(existing.customer_id, requestingUserId);
  await pool.query("DELETE FROM customer_addresses WHERE id = $1", [addressId]);
}
