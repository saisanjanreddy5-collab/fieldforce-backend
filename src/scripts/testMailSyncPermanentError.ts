import { pool } from "../config/db";
import * as microsoftService from "../services/microsoft-service";
import { syncAllConnectedMailboxes } from "../services/microsoft-mail-sync-service";

// Verifies the production fix for the "Mail sync failed... 404
// MailboxNotEnabledForRESTAPI" log spam seen on devcrm: once Microsoft
// Graph says a mailbox can never be synced (soft-deleted/deactivated/
// on-premise), the sync job must disconnect that user's Microsoft
// connection instead of retrying the same permanent failure every 3
// minutes forever.

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (!pass) failures += 1;
}

async function main(): Promise<void> {
  const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'admin@fieldforce.local'");
  const userId = user.rows[0].id;

  await pool.query(
    `INSERT INTO microsoft_connections (user_id, ms_account_email, access_token, refresh_token, token_expires_at)
     VALUES ($1, 'sync-test@example.com', 'fake-access', 'fake-refresh', now() + interval '1 hour')
     ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token`,
    [userId]
  );

  // Mutating the shared CommonJS exports object - microsoft-mail-sync-
  // service.ts resolves the same module instance via require(), so this
  // stub is what it actually calls, no mocking library needed.
  const mutableMicrosoftService = microsoftService as Record<string, unknown>;
  const realGetValidAccessToken = microsoftService.getValidAccessToken;
  const realFetch = global.fetch;
  mutableMicrosoftService.getValidAccessToken = async () => "fake-token";
  global.fetch = (async () =>
    ({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          error: {
            code: "MailboxNotEnabledForRESTAPI",
            message: "The mailbox is either inactive, soft-deleted, or is hosted on-premise.",
          },
        }),
    }) as unknown as Response) as typeof fetch;

  try {
    await syncAllConnectedMailboxes();
  } finally {
    mutableMicrosoftService.getValidAccessToken = realGetValidAccessToken;
    global.fetch = realFetch;
  }

  const statusAfter = await microsoftService.getConnectionStatus(userId);
  assertEqual("Connection auto-disconnected after a permanent Graph 404", statusAfter.connected, false);

  console.log(`\n${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`}`);

  // Cleanup is a no-op if the fix worked (the row is already gone) - this
  // only matters if the assertion above failed and left the row behind.
  await pool.query("DELETE FROM microsoft_connections WHERE user_id = $1", [userId]);

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
