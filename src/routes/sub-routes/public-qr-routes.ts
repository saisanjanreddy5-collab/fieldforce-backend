import { Router } from "express";
import * as publicQrController from "../../controllers/public-qr-controller";
import { qrScanRateLimiter, qrSubmitRateLimiter } from "../../middleware/rate-limit-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { publicSubmitSchema } from "../../validators/qr-campaign-validator";
import { documentUpload } from "../../services/lead-document-service";

const router = Router();

// Deliberately no requireAuth anywhere in this file - a QR code is scanned by
// an anonymous visitor with no FieldForce account. Rate limiting is the only
// abuse guard, same as authRateLimiter protects the login route.
router.get("/:code", qrScanRateLimiter, publicQrController.getInfo);
router.post(
  "/:code/submit",
  qrSubmitRateLimiter,
  documentUpload.single("photo"),
  validateBody(publicSubmitSchema),
  publicQrController.submit
);

export default router;
