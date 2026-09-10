import { pool } from "../config/db";
import { registerUser } from "../services/auth-service";
import { ROLES } from "../utils/roles";

async function main(): Promise<void> {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error('Usage: npm run seed:admin -- "Full Name" email@example.com password');
    process.exit(1);
  }

  const admin = await registerUser({
    name,
    email,
    password,
    role: ROLES.ADMIN,
    designation: "Administrator",
  });

  console.log("Admin user created:", admin);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
