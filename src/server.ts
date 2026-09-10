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

  // CORS is driven entirely by CORS_ALLOWED_ORIGINS in .env - today that's the
  // frontend's IP-based origin (e.g. http://203.0.113.10). If a domain is added
  // later, only that env var changes, nothing here does.
  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS,
      credentials: true,
    })
  );

  app.use(express.json());
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
