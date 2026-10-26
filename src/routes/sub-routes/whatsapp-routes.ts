import { Router } from "express";
import * as whatsappController from "../../controllers/whatsapp-controller";

const router = Router();

// Not behind requireAuth - K3's own servers call this directly, with no
// Authorization header; a shared secret header (WHATSAPP_WEBHOOK_SECRET)
// stands in for auth instead, same pattern as the Smartflo webhook route.
// GET is the one-time subscription verification handshake (see
// verifyWebhook's own comment); POST is the real, ongoing event delivery.
router.get("/webhook", whatsappController.verifyWebhook);
router.post("/webhook", whatsappController.webhook);

export default router;
