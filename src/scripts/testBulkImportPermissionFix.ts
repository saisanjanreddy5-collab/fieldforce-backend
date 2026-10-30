import { NextFunction, Request, Response } from "express";
import { pool } from "../config/db";
import { requirePermission } from "../middleware/permission-middleware";
import { ApiError } from "../utils/ApiError";
import { ROLES } from "../utils/roles";

// Verifies the fix for a real permission leak: Agent (Field Sales/RM) holds
// leads.create (needed for "create your own individual leads"), and the
// bulk-import route used to accept that same permission as sufficient -
// meaning an Agent could actually reach POST /leads/bulk-import, which
// contradicts the client's explicit "Export/Import restricted to Admins
// only" requirement. The route now requires leads.bulk_import specifically
// (same pattern/helper as testPermissionMiddleware.ts, exercised against the
// real live role_permissions table, not a mock).

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function runMiddleware(permission: string, role: string): Promise<{ nextCalled: boolean; error: unknown }> {
  const middleware = requirePermission(permission);
  const req = { user: { id: "x", role, managerId: null } } as unknown as Request;
  const res = {} as Response;
  let nextCalled = false;
  let error: unknown = null;
  const next = ((err?: unknown) => {
    if (err) error = err;
    else nextCalled = true;
  }) as NextFunction;
  await middleware(req, res, next);
  return { nextCalled, error };
}

async function main(): Promise<void> {
  const agentBulkImport = await runMiddleware("leads.bulk_import", ROLES.AGENT);
  assertEqual("Agent is denied leads.bulk_import", agentBulkImport.nextCalled, false);
  assertEqual("Agent's denial is a 403", (agentBulkImport.error as ApiError)?.statusCode, 403);

  const agentCreate = await runMiddleware("leads.create", ROLES.AGENT);
  assertEqual("Agent still keeps leads.create (their own single-lead right)", agentCreate.nextCalled, true);

  const callCenterBulkImport = await runMiddleware("leads.bulk_import", ROLES.CALL_CENTER);
  assertEqual("Call Center is denied leads.bulk_import (already revoked earlier this session)", callCenterBulkImport.nextCalled, false);

  const adminBulkImport = await runMiddleware("leads.bulk_import", ROLES.ADMIN);
  assertEqual("Admin keeps leads.bulk_import", adminBulkImport.nextCalled, true);

  const managerBulkImport = await runMiddleware("leads.bulk_import", ROLES.MANAGER);
  assertEqual("Manager keeps leads.bulk_import", managerBulkImport.nextCalled, true);

  const adminExport = await runMiddleware("leads.export", ROLES.ADMIN);
  assertEqual("Admin keeps leads.export (unaffected by this fix)", adminExport.nextCalled, true);

  const agentExport = await runMiddleware("leads.export", ROLES.AGENT);
  assertEqual("Agent still correctly denied leads.export", agentExport.nextCalled, false);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);
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
