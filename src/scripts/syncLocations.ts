import { pool } from "../config/db";

// Fills districts (cities) and areas (post offices) from pincode_directory,
// the hand-imported copy of the India Post pincode file.
//   npm run sync:locations
// Insert/update only - never deletes, so ids already saved on users/leads
// stay valid. Safe to re-run after importing a newer file.

// "THE DADRA & NAGAR HAVELI ..." and "Dadra and Nagar Haveli ..." compare equal.
const normState = (col: string) =>
  `lower(regexp_replace(regexp_replace(replace(trim(${col}), '&', ' and '), '^the\\s+', '', 'i'), '\\s+', ' ', 'g'))`;
const clean = (col: string) => `regexp_replace(trim(${col}), '\\s+', ' ', 'g')`;
// "19.36387" -> number; "NA", "", "-" and junk like "832015.52" (the
// government file has some) -> NULL instead of failing the whole sync.
const coord = (col: string) =>
  `CASE WHEN trim(${col}) ~ '^-?\\d{1,3}(\\.\\d+)?$' AND abs(trim(${col})::numeric) <= 180 THEN round(trim(${col})::numeric, 6) END`;

async function main(): Promise<void> {
  const total = Number((await pool.query("SELECT count(*) FROM pincode_directory")).rows[0].count);
  if (total === 0) {
    console.log("pincode_directory is empty - import the pincode file into it first.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("BEGIN");

    await client.query(`
      CREATE TEMP TABLE loc_src ON COMMIT DROP AS
      SELECT s.id AS state_id,
             replace(initcap(${clean("pd.district")}), ' And ', ' and ') AS city,
             ${clean("pd.office_name")} AS area,
             trim(pd.pincode) AS pincode,
             ${coord("pd.latitude")} AS latitude,
             ${coord("pd.longitude")} AS longitude
      FROM pincode_directory pd
      JOIN states s ON ${normState("s.name")} = ${normState("pd.state_name")}
      WHERE trim(pd.pincode) ~ '^\\d{6}$'
        AND coalesce(trim(pd.district), '') <> ''
        AND coalesce(trim(pd.office_name), '') <> ''`);

    const cities = await client.query(`
      INSERT INTO districts (name, state_id)
      SELECT DISTINCT city, state_id FROM loc_src
      ON CONFLICT (name, state_id) DO NOTHING`);

    const areas = await client.query(`
      INSERT INTO areas (name, district_id, pincode, latitude, longitude)
      SELECT DISTINCT ON (d.id, src.area, src.pincode) src.area, d.id, src.pincode, src.latitude, src.longitude
      FROM loc_src src
      JOIN districts d ON d.state_id = src.state_id AND d.name = src.city
      ORDER BY d.id, src.area, src.pincode, src.latitude NULLS LAST
      ON CONFLICT (name, district_id, pincode) DO UPDATE
        SET latitude = coalesce(EXCLUDED.latitude, areas.latitude),
            longitude = coalesce(EXCLUDED.longitude, areas.longitude)`);

    await client.query("COMMIT");

    const unmatched = await client.query(`
      SELECT pd.state_name, count(*)::int AS n FROM pincode_directory pd
      WHERE NOT EXISTS (SELECT 1 FROM states s WHERE ${normState("s.name")} = ${normState("pd.state_name")})
      GROUP BY pd.state_name ORDER BY pd.state_name`);
    const badPincode = Number(
      (await client.query(`SELECT count(*) FROM pincode_directory WHERE coalesce(trim(pincode), '') !~ '^\\d{6}$'`)).rows[0].count
    );
    const totals = (
      await client.query(`SELECT (SELECT count(*) FROM states)::int AS states,
                                 (SELECT count(*) FROM districts)::int AS cities,
                                 (SELECT count(*) FROM areas)::int AS areas,
                                 (SELECT count(DISTINCT pincode) FROM areas)::int AS pincodes`)
    ).rows[0];

    console.log(`Rows in pincode_directory: ${total}`);
    console.log(`New cities: ${cities.rowCount}, areas inserted/updated: ${areas.rowCount}`);
    console.log(`Now in DB -> states ${totals.states}, cities ${totals.cities}, areas ${totals.areas}, pincodes ${totals.pincodes}`);
    if (badPincode > 0) console.log(`Skipped ${badPincode} rows with a missing/invalid pincode`);
    if (unmatched.rows.length > 0) {
      console.log("Skipped rows whose state is not in the states table:");
      for (const r of unmatched.rows) console.log(`  ${r.state_name}: ${r.n} rows`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
