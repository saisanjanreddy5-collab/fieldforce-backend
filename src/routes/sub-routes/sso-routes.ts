import { Router } from "express";
import * as ssoController from "../../controllers/sso-controller";
import { ssoRateLimiter } from "../../middleware/rate-limit-middleware";

const router = Router();

// All three unauthenticated by requireAuth on purpose - the whole point is
// that Frappe's server (token/userinfo) and a not-yet-logged-in browser
// (authorize) call these without a FieldForce Bearer token. Each one does
// its own, different proof of identity instead (the ff_sso_session cookie,
// then the client_secret, then the access_token this flow itself issued).
router.get("/authorize", ssoRateLimiter, ssoController.authorize);
router.post("/token", ssoRateLimiter, ssoController.token);
router.get("/userinfo", ssoRateLimiter, ssoController.userinfo);

export default router;
