import { Router } from "express";
import * as whatsappController from "../../controllers/whatsapp-controller";
import { whatsappMediaRateLimiter } from "../../middleware/rate-limit-middleware";

const router = Router();

// No requireAuth - see serveMedia's own comment on why that's correct here,
// not an oversight.
router.get("/:filename", whatsappMediaRateLimiter, whatsappController.serveMedia);

export default router;
