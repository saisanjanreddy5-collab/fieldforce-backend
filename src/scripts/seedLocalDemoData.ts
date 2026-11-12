// TEMPORARY local-only seed script - creates demo rows so pagination can be
// visually verified on localhost. Not a permanent test, not registered in
// package.json. Delete this file (and the rows it created) after verification.
import { pool } from "../config/db";
import { createQuote } from "../services/quote-service";
import { createExpenseClaim, type ExpenseTypeKey } from "../services/expense-service";
import { createLeaveRequest, type LeaveRequestKind } from "../services/leave-service";

const TESTADMIN_ID = "0c51c72e-1da5-4b17-8d0d-3ab11a321eea"; // testadmin@test.local
const FIXTURE_USER_IDS = [
  "3a466cfa-3d4a-477e-a54d-f7b51462f661", // Revanth
  "5f7f31c4-2050-474f-adcf-272b5e17119b", // Field B
  "6ed20795-6dd5-4836-847b-192743e219db", // Field C
  "d1809897-b4a0-4d4b-8666-921770855d00", // Field D
  "c6f14706-f5ca-4ab0-b74d-c28847be1314", // Field E
];

const EXPENSE_TYPES: { key: ExpenseTypeKey; receiptRequired: boolean; needsOpp: boolean; perUnit: boolean }[] = [
  { key: "travel", receiptRequired: true, needsOpp: false, perUnit: false },
  { key: "fuel", receiptRequired: true, needsOpp: false, perUnit: true },
  { key: "lodging", receiptRequired: true, needsOpp: false, perUnit: true },
  { key: "meals", receiptRequired: false, needsOpp: false, perUnit: true },
  { key: "client_entertainment", receiptRequired: true, needsOpp: true, perUnit: false },
  { key: "telecom", receiptRequired: true, needsOpp: false, perUnit: false },
  { key: "marketing_collateral", receiptRequired: true, needsOpp: false, perUnit: false },
];

const LEAVE_KINDS: LeaveRequestKind[] = ["casual", "sick", "earned", "comp_off", "half_day", "wfh"];
const TICKET_STATUSES = ["Open", "Replied", "Resolved", "Closed"];
const TICKET_PRIORITIES = ["Urgent", "High", "Medium", "Low"];
const TICKET_SUBJECTS = [
  "Delivery delayed for store setup",
  "Invoice mismatch on last order",
  "Franchise signage not yet installed",
  "POS terminal not syncing",
  "Need replacement for damaged stock",
  "Query about renewal terms",
  "Store opening checklist clarification",
  "Billing portal access issue",
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const pairsResult = await pool.query<{ lead_id: string; opp_id: string }>(
    `SELECT l.id as lead_id, o.id as opp_id
     FROM leads l JOIN opportunities o ON o.lead_id = l.id
     WHERE l.status IN ('Qualified','Converted')
     ORDER BY l.lead_number
     LIMIT 30`
  );
  const pairs = pairsResult.rows;
  if (pairs.length === 0) throw new Error("No Qualified/Converted lead+opportunity pairs found - cannot seed quotes/tickets");

  let quoteCount = 0;
  let expenseCount = 0;
  let leaveCount = 0;
  let ticketCount = 0;

  // --- Quotes (25) ---
  for (let i = 0; i < 25; i++) {
    const pair = pairs[i % pairs.length];
    try {
      await createQuote(
        {
          leadId: pair.lead_id,
          opportunityId: pair.opp_id,
          lineItems: [
            { description: "Franchise setup kit", quantity: 1, unitPrice: 45000 + i * 1000, taxPercent: 18 },
            { description: "Installation & training", quantity: 1, unitPrice: 8000, taxPercent: 18 },
          ],
          notes: `Demo seed quote #${i + 1}`,
        },
        TESTADMIN_ID
      );
      quoteCount++;
    } catch (e) {
      console.error(`Quote ${i + 1} failed:`, (e as Error).message);
    }
  }

  // --- Expense claims (25) ---
  for (let i = 0; i < 25; i++) {
    const type = EXPENSE_TYPES[i % EXPENSE_TYPES.length];
    const userId = FIXTURE_USER_IDS[i % FIXTURE_USER_IDS.length];
    const pair = pairs[i % pairs.length];
    try {
      await createExpenseClaim(
        userId,
        {
          expenseTypeKey: type.key,
          title: `${type.key.replace(/_/g, " ")} - demo claim #${i + 1}`,
          expenseDate: daysAgo(i + 1),
          amount: type.key === "fuel" ? 1500 : type.key === "lodging" ? 3200 : type.key === "meals" ? 450 : 2200 + i * 50,
          quantity: type.perUnit ? 2 + (i % 3) : undefined,
          linkedOpportunityId: type.needsOpp ? pair.opp_id : undefined,
        },
        type.receiptRequired
          ? ({ path: "C:\\field force\\feildforce_backend\\uploads\\demo-seed-receipt.txt", originalname: "receipt.pdf" } as Express.Multer.File)
          : undefined
      );
      expenseCount++;
    } catch (e) {
      console.error(`Expense claim ${i + 1} (${type.key}) failed:`, (e as Error).message);
    }
  }

  // --- Leave requests (25) ---
  for (let i = 0; i < 25; i++) {
    const kind = LEAVE_KINDS[i % LEAVE_KINDS.length];
    const userId = FIXTURE_USER_IDS[i % FIXTURE_USER_IDS.length];
    const past = i % 2 === 0;
    const start = past ? daysAgo(30 - i) : daysFromNow(i + 1);
    const end = kind === "half_day" ? start : past ? daysAgo(30 - i - 1 >= 0 ? 29 - i : 0) : daysFromNow(i + 2);
    try {
      await createLeaveRequest(userId, {
        kind,
        startDate: start,
        endDate: end,
        reason: `Demo seed ${kind} request #${i + 1}`,
      });
      leaveCount++;
    } catch (e) {
      console.error(`Leave request ${i + 1} (${kind}) failed:`, (e as Error).message);
    }
  }

  // --- Support tickets (25) - direct SQL, bypassing real Frappe call ---
  for (let i = 0; i < 25; i++) {
    const pair = pairs[i % pairs.length];
    const status = TICKET_STATUSES[i % TICKET_STATUSES.length];
    const priority = TICKET_PRIORITIES[i % TICKET_PRIORITIES.length];
    const subject = TICKET_SUBJECTS[i % TICKET_SUBJECTS.length];
    try {
      await pool.query(
        `INSERT INTO support_tickets (lead_id, subject, description, status, priority, frappe_ticket_name, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
        [pair.lead_id, `${subject} #${i + 1}`, "Demo seed ticket for local pagination testing.", status, priority, TESTADMIN_ID]
      );
      ticketCount++;
    } catch (e) {
      console.error(`Support ticket ${i + 1} failed:`, (e as Error).message);
    }
  }

  console.log(`Seeded: ${quoteCount} quotes, ${expenseCount} expense claims, ${leaveCount} leave requests, ${ticketCount} support tickets`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
