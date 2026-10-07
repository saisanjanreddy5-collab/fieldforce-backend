import { Router } from "express";
import * as salesTeamController from "../../controllers/sales-team-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createSalesTeamSchema, listSalesTeamsQuerySchema } from "../../validators/sales-team-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("sales_teams.view"), validateQuery(listSalesTeamsQuerySchema), salesTeamController.list);
router.post("/", requirePermission("sales_teams.create"), validateBody(createSalesTeamSchema), salesTeamController.create);

export default router;
