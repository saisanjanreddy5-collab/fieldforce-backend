import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { pool } from "./config/db";
import { createTables } from "./models/model";
import routes from "./routes/routes";
import { errorHandler, notFoundHandler } from "./middleware/error-middleware";

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

  // The verify callback runs for every request, but only stashes the raw
  // buffer already being read - it changes nothing about normal parsing, and
  // every route except the Frappe webhook ignores req.rawBody entirely.
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`FieldForce API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
