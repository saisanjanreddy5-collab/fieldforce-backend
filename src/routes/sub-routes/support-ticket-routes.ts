import { Router } from "express";
import * as supportTicketController from "../../controllers/support-ticket-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createSupportTicketSchema,
  listSupportTicketsQuerySchema,
  replySupportTicketSchema,
} from "../../validators/support-ticket-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("support_tickets.view"), validateQuery(listSupportTicketsQuerySchema), supportTicketController.list);
router.post("/", requirePermission("support_tickets.create"), validateBody(createSupportTicketSchema), supportTicketController.create);
router.get("/:id", requirePermission("support_tickets.view"), supportTicketController.getById);

router.get("/:id/messages", requirePermission("support_tickets.view"), supportTicketController.listMessages);
// Replying advances an existing ticket rather than raising a new one, so
// it's gated on .update, not .create - matching how expense_claims uses
// .update for every change to an already-raised claim.
router.post(
  "/:id/messages",
  requirePermission("support_tickets.update"),
  validateBody(replySupportTicketSchema),
  supportTicketController.reply
);

export default router;
