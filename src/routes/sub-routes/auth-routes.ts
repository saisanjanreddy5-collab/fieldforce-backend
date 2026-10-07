import { Router } from "express";
import * as authController from "../../controllers/auth-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "../../validators/auth-validator";
import { authRateLimiter } from "../../middleware/rate-limit-middleware";

const router = Router();

// Registering a new user is a users.create action - no public self-signup.
// The very first Admin account is created by the seed script (npm run seed:admin).
router.post("/register", requireAuth, requirePermission("users.create"), validateBody(registerSchema), authController.register);

router.post("/login", authRateLimiter, validateBody(loginSchema), authController.login);
router.post("/refresh", authRateLimiter, validateBody(refreshSchema), authController.refresh);
router.post("/logout", authRateLimiter, validateBody(logoutSchema), authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
