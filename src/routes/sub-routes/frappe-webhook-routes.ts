import { Router } from "express";
import * as supportTicketController from "../../controllers/support-ticket-controller";

const router = Router();

// Not behind requireAuth - Frappe's own servers call these directly, with
// no Authorization header; an HMAC signature (X-Frappe-Webhook-Signature)
// stands in for auth instead, same role a shared secret plays for the
// WhatsApp/Smartflo webhook routes.
router.post("/webhook/ticket-status", supportTicketController.ticketStatusWebhook);
router.post("/webhook/new-reply", supportTicketController.newReplyWebhook);

export default router;
