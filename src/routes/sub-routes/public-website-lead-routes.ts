import { Router } from "express";
import * as publicWebsiteLeadController from "../../controllers/public-website-lead-controller";
import { qrSubmitRateLimiter } from "../../middleware/rate-limit-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { publicWebsiteLeadSubmitSchema } from "../../validators/website-lead-source-validator";

const router = Router();

// CORS for this route is handled in server.ts's single app-level cors()
// call, not here - see the comment there for why a second cors() on this
// sub-router wouldn't actually take effect for preflight requests. The real
// access control is still possession of the secret api_key in the URL, not
// the browser-enforced Origin check - a direct server-to-server POST
// bypasses CORS entirely regardless, same trust model QR's public code
// already uses.

router.post(
  "/:apiKey/submit",
  qrSubmitRateLimiter,
  validateBody(publicWebsiteLeadSubmitSchema),
  publicWebsiteLeadController.submit
);

export default router;
