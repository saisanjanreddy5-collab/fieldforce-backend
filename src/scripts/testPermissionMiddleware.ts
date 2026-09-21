import { NextFunction, Request, Response } from "express";
import { pool } from "../config/db";
import { requirePermission } from "../middleware/permission-middleware";
import { ApiError } from "../utils/ApiError";
import { ROLES } from "../utils/roles";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

interface FakeUser {
  id: string;
  role: string;
  managerId: string | null;
}

async function runMiddleware(permission: string, user?: FakeUser): Promise<{ nextCalled: boolean; error: unknown }> {
  const middleware = requirePermission(permission);
  const req = { user } as unknown as Request;
  const res = {} as Response;

  let nextCalled = false;
  let error: unknown = null;
  const next = ((err?: unknown) => {
    if (err) {
      error = err;
    } else {
      nextCalled = true;
    }
  }) as NextFunction;

  await middleware(req, res, next);
  return { nextCalled, error };
}

async function main(): Promise<void> {
  console.log("--- 1. Admin + existing valid permission -> next() ---");
  let r = await runMiddleware("leads.view", { id: "x", role: ROLES.ADMIN, managerId: null });
  assertEqual("admin + leads.view calls next()", r.nextCalled, true);

  console.log("\n--- 2. Manager + permission they have -> next() ---");
  r = await runMiddleware("leads.view", { id: "x", role: ROLES.MANAGER, managerId: null });
  assertEqual("manager + leads.view calls next()", r.nextCalled, true);

  console.log("\n--- 3. Agent + permission they have -> next() ---");
  r = await runMiddleware("leads.view", { id: "x", role: ROLES.AGENT, managerId: null });
  assertEqual("agent + leads.view calls next()", r.nextCalled, true);

  console.log("\n--- 4. Agent + permission they do NOT have -> 403 ---");
  r = await runMiddleware("targets.create", { id: "x", role: ROLES.AGENT, managerId: null });
  assertEqual("agent + targets.create does not call next()", r.nextCalled, false);
  assertEqual("agent + targets.create yields an ApiError", r.error instanceof ApiError, true);
  assertEqual("agent + targets.create -> 403", (r.error as ApiError)?.statusCode, 403);

  console.log("\n--- 5. Manager + permission they do NOT have -> 403 ---");
  r = await runMiddleware("targets.create", { id: "x", role: ROLES.MANAGER, managerId: null });
  assertEqual("manager + targets.create does not call next()", r.nextCalled, false);
  assertEqual("manager + targets.create -> 403", (r.error as ApiError)?.statusCode, 403);

  console.log("\n--- 6. Unknown/nonexistent role -> safely denied ---");
  r = await runMiddleware("leads.view", { id: "x", role: "superuser", managerId: null });
  assertEqual("unknown role does not call next()", r.nextCalled, false);
  assertEqual("unknown role -> 403", (r.error as ApiError)?.statusCode, 403);

  console.log("\n--- 7. Missing authenticated user/role -> safely denied ---");
  r = await runMiddleware("leads.view", undefined);
  assertEqual("missing user does not call next()", r.nextCalled, false);
  assertEqual("missing user -> 401", (r.error as ApiError)?.statusCode, 401);

  console.log("\n--- 8. Permission service/database failure -> safely denied, no internal error exposed ---");
  const originalQuery = pool.query.bind(pool);
  pool.query = (() => {
    throw new Error("simulated DB connection failure - internal detail");
  }) as typeof pool.query;
  r = await runMiddleware("leads.view", { id: "x", role: ROLES.ADMIN, managerId: null });
  pool.query = originalQuery;
  assertEqual("DB failure does not call next()", r.nextCalled, false);
  assertEqual("DB failure yields an ApiError", r.error instanceof ApiError, true);
  assertEqual("DB failure -> 403", (r.error as ApiError)?.statusCode, 403);
  assertEqual(
    "DB failure message does not leak internal detail",
    (r.error as ApiError)?.message.includes("simulated"),
    false
  );

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
