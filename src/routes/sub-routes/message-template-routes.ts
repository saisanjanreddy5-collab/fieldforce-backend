import { Router } from "express";
import * as messageTemplateController from "../../controllers/message-template-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createMessageTemplateSchema,
  listMessageTemplatesQuerySchema,
  updateMessageTemplateSchema,
} from "../../validators/message-template-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("message_templates.view"), validateQuery(listMessageTemplatesQuerySchema), messageTemplateController.list);
router.post(
  "/",
  requirePermission("message_templates.manage"),
  validateBody(createMessageTemplateSchema),
  messageTemplateController.create
);
router.patch(
  "/:key",
  requirePermission("message_templates.manage"),
  validateBody(updateMessageTemplateSchema),
  messageTemplateController.update
);

export default router;
