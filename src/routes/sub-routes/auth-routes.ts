import { Router } from "express";
import * as authController from "../../controllers/auth-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema, registerSchema } from "../../validators/auth-validator";
import { loginIpRateLimiter, loginRateLimiter, passwordChangeRateLimiter, sessionRateLimiter } from "../../middleware/rate-limit-middleware";

const router = Router();

// Registering a new user is a users.create action - no public self-signup.
// The very first Admin account is created by the seed script (npm run seed:admin).
router.post("/register", requireAuth, requirePermission("users.create"), validateBody(registerSchema), authController.register);

router.post("/login", loginIpRateLimiter, loginRateLimiter, validateBody(loginSchema), authController.login);
router.post("/refresh", sessionRateLimiter, validateBody(refreshSchema), authController.refresh);
router.post("/logout", sessionRateLimiter, validateBody(logoutSchema), authController.logout);
router.get("/me", requireAuth, authController.me);
// Self-service, same "ungated by permission, just logged in" pattern as
// PATCH /users/me - every role can change their own password, including
// Call Center and Field Sales accounts.
router.post("/change-password", requireAuth, passwordChangeRateLimiter, validateBody(changePasswordSchema), authController.changePassword);

export default router;
