import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { pool } from "./config/db";
import { createTables } from "./models/model";
import routes from "./routes/routes";
import { errorHandler, notFoundHandler } from "./middleware/error-middleware";
import { startMailSyncScheduler } from "./services/microsoft-mail-sync-service";
import { startCallReminderScheduler } from "./services/call-reminder-service";

async function start(): Promise<void> {
  await pool.query("SELECT 1");
  console.log("Database connection established.");

  await createTables();

  const app = express();

  // CORS is driven entirely by CORS_ALLOWED_ORIGINS in .env for every route
  // except the public website-lead-capture endpoint, which by definition is
  // called from an arbitrary client website's own domain we can't know in
  // advance - that one gets a permissive, credential-less origin instead.
  // This has to be decided here, at the one global `cors()` call: a `cors()`
  // applied again on that route's own sub-router never actually runs for
  // preflight (OPTIONS) requests, because this app-level instance already
  // intercepts and terminates them first, using its own restrictive origin
  // list, before the request reaches any router further down the chain -
  // confirmed by testing (curl showed the preflight response had no
  // Access-Control-Allow-Origin header at all when a route-level `cors()`
  // was relied on instead).
  app.use(
    cors((req, callback) => {
      const isPublicWebsiteLead = req.path.startsWith("/api/public/website-leads");
      callback(null, isPublicWebsiteLead ? { origin: true, credentials: false } : { origin: env.CORS_ALLOWED_ORIGINS, credentials: true });
    })
  );

  // Frappe's own webhook requests don't carry Content-Type: application/json
  // (confirmed against a real failed delivery, not guessed) - express.json()
  // below only parses a body when the Content-Type matches, so it silently
  // skips these requests entirely, leaving nothing to verify the HMAC
  // signature against. Reading them as raw bytes here, before the global
  // JSON parser even sees them, works regardless of whatever Content-Type
  // (or none) Frappe actually sends - every other route is unaffected, this
  // only applies to these two specific paths.
  app.use("/api/integrations/frappe/webhook", express.raw({ type: () => true, limit: "1mb" }));

  // Default express.json() limit is 100kb - fine for every other route, but
  // the bulk lead import sends its whole sheet as one JSON request (see
  // bulkImportLeads's own MAX_BULK_IMPORT_ROWS = 5000), and a real multi-
  // hundred-row sheet routinely exceeds 100kb on its own. That made large
  // imports fail outright with a generic 500 before a single row was even
  // read - confirmed by a real failed import, not guessed. 10mb comfortably
  // covers 5,000 rows even with long free-text fields (notes, addresses).
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`FieldForce API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  startMailSyncScheduler();
  startCallReminderScheduler();
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
