import { pool } from "../config/db";
import { createExpenseClaim, listMyClaims } from "../services/expense-service";

// Covers WEB-009: the expense receipt downloaded as "random/unexpected
// text" - root cause was the frontend inventing an extension-less filename
// for the download (the backend already served the real file correctly).
// Fixed by exposing the real original filename on the public claim DTO so
// the frontend can use it instead of guessing. This test only needs to
// prove the DTO carries it through, in both the single-create response and
// the list view - the actual browser download trigger is a frontend-only
// change with nothing further to unit-test on the backend.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}
function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

function fakeFile(path: string, originalname: string): Express.Multer.File {
  return { path, originalname } as Express.Multer.File;
}

async function main(): Promise<void> {
  const testadmin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'testadmin@test.local'");
  const testadminId = testadmin.rows[0].id;

  const createdClaimIds: string[] = [];

  try {
    const claim = await createExpenseClaim(
      testadminId,
      { expenseTypeKey: "meals", title: "Receipt Filename Round-Trip Test", expenseDate: "2026-11-01", amount: 450 },
      fakeFile("/tmp/receipt-scan.pdf", "receipt-scan.pdf")
    );
    createdClaimIds.push(claim.id);

    assertTrue("Claim reports it has a receipt", claim.hasReceipt);
    assertEqual("Create response carries the real original filename", claim.receiptOriginalFilename, "receipt-scan.pdf");

    const myClaims = await listMyClaims(testadminId);
    const fromList = myClaims.find((c) => c.id === claim.id);
    assertEqual("List view also carries the real original filename (not just the create response)", fromList?.receiptOriginalFilename, "receipt-scan.pdf");

    const claimWithoutReceipt = await createExpenseClaim(testadminId, {
      expenseTypeKey: "meals",
      title: "No Receipt Test",
      expenseDate: "2026-11-01",
      amount: 200,
    });
    createdClaimIds.push(claimWithoutReceipt.id);
    assertEqual("A claim with no receipt reports a null filename, not a crash", claimWithoutReceipt.receiptOriginalFilename, null);

    console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
  } finally {
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
