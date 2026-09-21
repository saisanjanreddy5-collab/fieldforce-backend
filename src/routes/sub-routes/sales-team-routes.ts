import { Router } from "express";
import * as salesTeamController from "../../controllers/sales-team-controller";
import { MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createSalesTeamSchema } from "../../validators/sales-team-validator";

const router = Router();

router.use(requireAuth);

router.get("/", salesTeamController.list);
router.post("/", requireRole(...MANAGER_AND_ABOVE), validateBody(createSalesTeamSchema), salesTeamController.create);

export default router;
