import { Router } from "express";
import * as expenseController from "../../controllers/expense-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { receiptUpload } from "../../services/expense-service";
import {
  decideExpenseClaimSchema,
  listExpenseTypesQuerySchema,
  searchExpenseClaimsQuerySchema,
} from "../../validators/expense-validator";

const router = Router();

router.use(requireAuth);

router.get(
  "/types",
  requirePermission("expense_types.view"),
  validateQuery(listExpenseTypesQuerySchema),
  expenseController.listTypes
);
router.get("/mine", requirePermission("expense_claims.view"), expenseController.listMine);
router.get("/team", requirePermission("expense_claims.approve"), expenseController.listTeam);
router.get("/pending-approvals", requirePermission("expense_claims.approve"), expenseController.listPendingApprovals);
// Mobile API handoff - same gate as /team (direct reports), since this is
// that same capability widened to the whole reporting chain plus an
// optional month filter, not a new privilege level.
router.get(
  "/search",
  requirePermission("expense_claims.approve"),
  validateQuery(searchExpenseClaimsQuerySchema),
  expenseController.search
);
router.post("/", requirePermission("expense_claims.create"), receiptUpload.single("receipt"), expenseController.create);
router.patch("/:id/decision", requirePermission("expense_claims.approve"), validateBody(decideExpenseClaimSchema), expenseController.decide);
router.patch("/:id/mark-paid", requirePermission("expense_claims.mark_paid"), expenseController.markPaid);
router.get("/:id/receipt", requirePermission("expense_claims.view"), expenseController.downloadReceipt);

export default router;
