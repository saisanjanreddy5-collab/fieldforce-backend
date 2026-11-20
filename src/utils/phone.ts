// Phone numbers are stored as typed - nothing enforces one format at entry
// time - so every comparison and outbound send normalizes here.

// The last 10 digits after stripping everything but digits, so
// "9876543210", "+91 98765 43210" and "091-9876543210" all compare equal.
// leads.phone_key (model.ts) is this same expression as a generated column.
export function last10Digits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

// For imported spreadsheet cells ("+91 98765 43210", "098765-43210", ...):
// returns the clean 10-digit form only for an unambiguous form of ONE Indian
// mobile number - 10 digits, or a 0 / 91 / 091 prefix + 10 digits. Anything
// else (two numbers in one cell, an extra-digit typo) is returned exactly as
// typed - trimming it to "the last 10 digits" would silently turn it into a
// stranger's number.
export function cleanImportedMobile(value: string | undefined): string | undefined {
  if (!value) return value;
  const digits = value.replace(/\D/g, "");
  const isOneMobile =
    digits.length === 10 ||
    (digits.length === 11 && digits.startsWith("0")) ||
    (digits.length === 12 && digits.startsWith("91")) ||
    (digits.length === 13 && digits.startsWith("091"));
  return isOneMobile ? digits.slice(-10) : value;
}

// WhatsApp's API needs the full international MSISDN - a bare 10-digit
// number is accepted (a message id comes back) but never delivered. Leads
// are entered as plain 10-digit Indian mobiles, so those get the 91 prefix;
// anything else is sent as its digits.
export function toWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}
