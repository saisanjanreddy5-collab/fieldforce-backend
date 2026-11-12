// TEMPORARY local-only top-up - the first seed pass used fixture users
// (Field B/C/D/E, Revanth) for leave/expense, but the "Mine" tab (the
// default view on both pages) only shows the LOGGED-IN user's own rows, so
// nothing showed up for testadmin. This adds rows directly under testadmin
// so they're visible immediately without switching tabs. Delete after
// verification, same as seedLocalDemoData.ts.
import { pool } from "../config/db";
import { createExpenseClaim, type ExpenseTypeKey } from "../services/expense-service";
import { createLeaveRequest, type LeaveRequestKind } from "../services/leave-service";

const TESTADMIN_ID = "0c51c72e-1da5-4b17-8d0d-3ab11a321eea"; // testadmin@test.local

const EXPENSE_TYPES: { key: ExpenseTypeKey; receiptRequired: boolean; needsOpp: boolean; perUnit: boolean }[] = [
  { key: "travel", receiptRequired: true, needsOpp: false, perUnit: false },
  { key: "fuel", receiptRequired: true, needsOpp: false, perUnit: true },
  { key: "lodging", receiptRequired: true, needsOpp: false, perUnit: true },
  { key: "meals", receiptRequired: false, needsOpp: false, perUnit: true },
  { key: "telecom", receiptRequired: true, needsOpp: false, perUnit: false },
  { key: "marketing_collateral", receiptRequired: true, needsOpp: false, perUnit: false },
];

const LEAVE_KINDS: LeaveRequestKind[] = ["sick", "earned", "half_day", "wfh", "casual"];

function nextWeekday(fromOffset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + fromOffset);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const oppResult = await pool.query<{ opp_id: string }>(
    `SELECT o.id as opp_id FROM leads l JOIN opportunities o ON o.lead_id = l.id WHERE l.status IN ('Qualified','Converted') LIMIT 1`
  );
  const oppId = oppResult.rows[0]?.opp_id;

  let expenseCount = 0;
  for (let i = 0; i < 20; i++) {
    const type = EXPENSE_TYPES[i % EXPENSE_TYPES.length];
    try {
      await createExpenseClaim(
        TESTADMIN_ID,
        {
          expenseTypeKey: type.key,
          title: `${type.key.replace(/_/g, " ")} - demo claim #${i + 1}`,
          expenseDate: iso(nextWeekday(-(i + 1))),
          amount: type.key === "fuel" ? 1500 : type.key === "lodging" ? 3200 : type.key === "meals" ? 450 : 2200 + i * 50,
          quantity: type.perUnit ? 2 + (i % 3) : undefined,
          linkedOpportunityId: type.needsOpp ? oppId : undefined,
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

  let leaveCount = 0;
  for (let i = 0; i < 20; i++) {
    const kind = LEAVE_KINDS[i % LEAVE_KINDS.length];
    const start = nextWeekday(kind === "casual" ? 5 + i : 3 + i);
    const end = kind === "half_day" ? start : nextWeekday(5 + i + (kind === "casual" ? 1 : 0));
    try {
      await createLeaveRequest(TESTADMIN_ID, {
        kind,
        startDate: iso(start),
        endDate: iso(end),
        reason: `Demo seed ${kind} request #${i + 1}`,
      });
      leaveCount++;
    } catch (e) {
      console.error(`Leave request ${i + 1} (${kind}) failed:`, (e as Error).message);
    }
  }

  console.log(`Seeded for testadmin: ${expenseCount} expense claims, ${leaveCount} leave requests`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
