import { Router } from "express";
import * as activityController from "../../controllers/activity-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { addCommentSchema, listActivitiesQuerySchema, updateActivitySchema } from "../../validators/activity-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("activities.view"), validateQuery(listActivitiesQuerySchema), activityController.list);
router.get("/:id", requirePermission("activities.view"), activityController.getById);
router.patch("/:id", requirePermission("activities.update"), validateBody(updateActivitySchema), activityController.update);
router.delete("/:id", requirePermission("activities.delete"), activityController.remove);

router.get("/:id/comments", requirePermission("activities.view"), activityController.listComments);
// activities.create here gates the action; addComment's own record-scope
// check (activity-service.ts) deliberately stays on the broad view scope -
// see the comment there for why commenting isn't treated like update/delete.
router.post(
  "/:id/comments",
  requirePermission("activities.create"),
  validateBody(addCommentSchema),
  activityController.addComment
);

export default router;
