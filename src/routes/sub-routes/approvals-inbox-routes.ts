import { Router } from "express";
import * as approvalsInboxController from "../../controllers/approvals-inbox-controller";
import { requireAuth } from "../../middleware/auth-middleware";

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

export default router;
