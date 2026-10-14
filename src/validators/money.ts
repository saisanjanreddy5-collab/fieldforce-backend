import { z } from "zod";

// Every money-ish field across customers/sales orders/invoices/payments is
// stored as DECIMAL(12,2) (see model.ts) - a real production incident
// confirmed what that means in practice: entering a value too large for
// that column (precision 12, scale 2 caps the absolute value just under
// 10^10) doesn't get caught here first, it reaches Postgres and crashes
// with a raw "numeric field overflow" / "must round to an absolute value
// less than 10^10" error - an unhandled 500, not a clean validation
// message. Capped one cent inside that boundary (not at it) so the
// column's own limit is never the thing actually enforcing this.
const DECIMAL_12_2_MAX = 9_999_999_999.99;

export function decimal12_2() {
  return z.coerce.number().max(DECIMAL_12_2_MAX, `Must be less than ${DECIMAL_12_2_MAX.toLocaleString("en-IN")}`);
}
