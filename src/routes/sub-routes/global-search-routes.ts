import { Router } from "express";
import * as globalSearchController from "../../controllers/global-search-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { globalSearchQuerySchema } from "../../validators/global-search-validator";

const router = Router();

router.use(requireAuth);

// No extra permission gate beyond auth - every result row is already
// filtered by the same leads/opportunities visibility rule those modules'
// own endpoints enforce, so this never surfaces a record the requester
// couldn't already see by going to Leads or Opportunities directly.
router.get("/", validateQuery(globalSearchQuerySchema), globalSearchController.search);

export default router;
