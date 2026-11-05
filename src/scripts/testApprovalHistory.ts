import { pool } from "../config/db";
import { createLeaveRequest, decideLeaveRequest, listDecidedByUser as listDecidedLeaveByUser, listPendingApprovals as listPendingLeaveApprovals } from "../services/leave-service";
import { createExpenseClaim, decideExpenseClaim, listDecidedByUser as listDecidedExpenseByUser } from "../services/expense-service";
import { listDecidedStepsByUser } from "../services/fofo-onboarding-service";
import { getApprovalHistory, getApprovalInbox } from "../services/approvals-inbox-service";

// Covers WEB-014: the Approvals Inbox only ever showed pending items, with
// no way to see what you'd already decided, even though every decision
// (leave, expense, FOFO step) already carries approver/decided_at columns.
// Fixed with a real History feed merged across all three sources, reusing
// that existing data rather than inventing new tracking.

let failures = 0;
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

function nextWeekday(minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86400000);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // cc1's real current manager (checked directly - not assumed) is
  // admin@fieldforce.local, not any of the transient "manager-under-a-..."
  // fixtures other scripts create and tear down for their own purposes.
  const cc1Row = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'cc1@test.local'");
  const cc1Id = cc1Row.rows[0].id;
  const managerRow = await pool.query<{ id: string; role: string }>("SELECT id, role FROM users WHERE email = 'admin@fieldforce.local'");
  const managerId = managerRow.rows[0].id;
  const managerRole = managerRow.rows[0].role;

  const createdLeaveRequestIds: string[] = [];
  const createdClaimIds: string[] = [];

  try {
    const nearFutureDate = nextWeekday(10);
    const leaveRequest = await createLeaveRequest(cc1Id, {
      kind: "casual",
      startDate: nearFutureDate,
      endDate: nearFutureDate,
      reason: "Approval history test - leave",
    });
    createdLeaveRequestIds.push(leaveRequest.id);

    const claim = await createExpenseClaim(cc1Id, {
      expenseTypeKey: "meals",
      title: "Approval history test - expense",
      expenseDate: "2026-11-01",
      amount: 300,
    });
    createdClaimIds.push(claim.id);

    const pendingBefore = await listPendingLeaveApprovals(managerId);
    assertTrue("Leave request starts out pending for the manager", pendingBefore.some((r) => r.id === leaveRequest.id));

    await decideLeaveRequest(leaveRequest.id, managerId, "approved");
    await decideExpenseClaim(claim.id, managerId, "rejected");

    const pendingAfter = await listPendingLeaveApprovals(managerId);
    assertTrue("Decided leave request no longer shows up as pending", !pendingAfter.some((r) => r.id === leaveRequest.id));

    const decidedLeave = await listDecidedLeaveByUser(managerId);
    assertTrue("listDecidedByUser (leave) includes the decided request", decidedLeave.some((r) => r.id === leaveRequest.id));

    const decidedExpense = await listDecidedExpenseByUser(managerId);
    assertTrue("listDecidedByUser (expense) includes the decided claim", decidedExpense.some((c) => c.id === claim.id));

    const fofoDecided = await listDecidedStepsByUser(managerId);
    assertTrue("listDecidedStepsByUser (FOFO) returns an array without crashing", Array.isArray(fofoDecided));

    const history = await getApprovalHistory(managerId, managerRole, 1, 50);
    const leaveEntry = history.items.find((i) => i.id === `leave:${leaveRequest.id}`);
    const expenseEntry = history.items.find((i) => i.id === `expense:${claim.id}`);
    assertTrue("getApprovalHistory includes the decided leave request", leaveEntry !== undefined);
    assertTrue("getApprovalHistory includes the decided expense claim", expenseEntry !== undefined);
    assertTrue("Leave entry's decision is 'approved', matching what was actually recorded", leaveEntry?.decision === "approved");
    assertTrue("Expense entry's decision is 'rejected', matching what was actually recorded", expenseEntry?.decision === "rejected");
    assertTrue("History total reflects at least these two items", history.total >= 2);

    const inbox = await getApprovalInbox(managerId, managerRole);
    assertTrue(
      "The now-decided items are gone from the pending Inbox, not duplicated into both views",
      !inbox.items.some((i) => i.id === `leave:${leaveRequest.id}` || i.id === `expense:${claim.id}`)
    );

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
    if (createdLeaveRequestIds.length > 0) {
      await pool.query("DELETE FROM leave_requests WHERE id = ANY($1::uuid[])", [createdLeaveRequestIds]);
    }
    if (createdClaimIds.length > 0) {
      await pool.query("DELETE FROM expense_claims WHERE id = ANY($1::uuid[])", [createdClaimIds]);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
