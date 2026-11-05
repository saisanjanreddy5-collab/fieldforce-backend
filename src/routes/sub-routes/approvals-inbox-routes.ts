import { Router } from "express";
import * as approvalsInboxController from "../../controllers/approvals-inbox-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { paginationQuerySchema } from "../../validators/pagination";

const router = Router();

router.use(requireAuth);

// No single requirePermission gate here - visibility is inherently
// self-scoped (every item returned is one where the requesting user is
// personally the approver), and each of the three source lists already
// applies leave_requests.approve / expense_claims.approve /
// fofo_onboarding.manage internally before including anything. An agent
// holding none of those three simply gets an empty inbox, same as if they'd
// hit each real source endpoint directly.
router.get("/inbox", approvalsInboxController.getInbox);
// Same self-scoping reasoning as /inbox above - every decided item returned
// is one this requesting user personally decided.
router.get("/history", validateQuery(paginationQuerySchema), approvalsInboxController.getHistory);

export default router;
