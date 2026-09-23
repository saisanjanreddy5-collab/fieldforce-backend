import { registerUser } from "./src/services/auth-service.ts";
const admin = await registerUser({
  name: "Test SFMv21 Admin",
  email: "test-sfmv21-admin@fieldforce.local",
  password: "TestPass123!",
  role: "admin",
});
console.log("admin", admin.id);
process.exit(0);
