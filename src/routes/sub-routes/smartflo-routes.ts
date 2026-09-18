import { Router } from "express";
import * as smartfloController from "../../controllers/smartflo-controller";

const router = Router();

// Not behind requireAuth - Smartflo's own servers call this directly once a
// call hangs up, with no Authorization header; a shared secret header
// (SMARTFLO_WEBHOOK_SECRET) stands in for auth instead, same pattern as the
// Microsoft OAuth callback route.
router.post("/webhook", smartfloController.webhook);

export default router;
