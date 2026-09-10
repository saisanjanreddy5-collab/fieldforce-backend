import { Router } from "express";
import * as authController from "../../controllers/auth-controller";
import { ADMIN_ONLY, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { loginSchema, refreshSchema, registerSchema } from "../../validators/auth-validator";
import { authRateLimiter } from "../../middleware/rate-limit-middleware";

const router = Router();

// Only an Admin can create new users - there's no public self-signup.
// The very first Admin account is created by the seed script (npm run seed:admin).
router.post("/register", requireAuth, requireRole(...ADMIN_ONLY), validateBody(registerSchema), authController.register);

router.post("/login", authRateLimiter, validateBody(loginSchema), authController.login);
router.post("/refresh", authRateLimiter, validateBody(refreshSchema), authController.refresh);
router.get("/me", requireAuth, authController.me);

export default router;
