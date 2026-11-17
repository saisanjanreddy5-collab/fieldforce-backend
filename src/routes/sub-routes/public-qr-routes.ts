import fs from "fs";
import { NextFunction, Request, Response, Router } from "express";
import * as publicQrController from "../../controllers/public-qr-controller";
import { qrScanRateLimiter, qrSubmitRateLimiter } from "../../middleware/rate-limit-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { publicSubmitSchema } from "../../validators/qr-campaign-validator";
import { documentUpload } from "../../services/lead-document-service";

const router = Router();

// Deliberately no requireAuth anywhere in this file - a QR code is scanned by
// an anonymous visitor with no FieldForce account. Rate limiting is the only
// abuse guard, same as loginRateLimiter protects the login route.
router.get("/:code", qrScanRateLimiter, publicQrController.getInfo);
// The photo is written to disk by multer BEFORE the code, the form or the
// campaign settings are checked. Whenever the request then fails (unknown
// code, invalid form, photo not allowed...), delete that file - otherwise an
// anonymous caller could fill the server's disk with rejected uploads.
function discardUploadOnError(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    if (res.statusCode >= 400 && req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => undefined);
    }
  });
  next();
}

router.post(
  "/:code/submit",
  qrSubmitRateLimiter,
  documentUpload.single("photo"),
  discardUploadOnError,
  validateBody(publicSubmitSchema),
  publicQrController.submit
);

export default router;
