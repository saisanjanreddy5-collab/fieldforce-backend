import { Router } from "express";
import * as pipelineStageController from "../../controllers/pipeline-stage-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import {
  createPipelineStageSchema,
  reorderPipelineStagesSchema,
  updatePipelineStageSchema,
} from "../../validators/pipeline-stage-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("pipeline_stages.view"), pipelineStageController.list);
router.post(
  "/",
  requirePermission("pipeline_stages.manage"),
  validateBody(createPipelineStageSchema),
  pipelineStageController.create
);
// Ahead of "/:key" so "reorder" is never swallowed as a stage key.
router.patch(
  "/reorder",
  requirePermission("pipeline_stages.manage"),
  validateBody(reorderPipelineStagesSchema),
  pipelineStageController.reorder
);
router.patch(
  "/:key",
  requirePermission("pipeline_stages.manage"),
  validateBody(updatePipelineStageSchema),
  pipelineStageController.update
);

export default router;
