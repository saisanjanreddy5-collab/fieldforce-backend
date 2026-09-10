import { Router } from "express";
import * as activityController from "../../controllers/activity-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { addCommentSchema, listActivitiesQuerySchema, updateActivitySchema } from "../../validators/activity-validator";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listActivitiesQuerySchema), activityController.list);
router.get("/:id", activityController.getById);
router.patch("/:id", validateBody(updateActivitySchema), activityController.update);
router.delete("/:id", activityController.remove);

router.get("/:id/comments", activityController.listComments);
router.post("/:id/comments", validateBody(addCommentSchema), activityController.addComment);

export default router;
