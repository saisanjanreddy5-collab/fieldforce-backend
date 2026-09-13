import { Router } from "express";
import * as userController from "../../controllers/user-controller";
import { MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";

const router = Router();

router.get("/", requireAuth, requireRole(...MANAGER_AND_ABOVE), userController.list);

export default router;
