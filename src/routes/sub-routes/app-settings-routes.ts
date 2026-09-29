import { Router } from "express";
import * as appSettingsController from "../../controllers/app-settings-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { setAppSettingSchema } from "../../validators/app-settings-validator";

const router = Router();

router.use(requireAuth);

router.get("/:key", requirePermission("app_settings.view"), appSettingsController.get);
router.patch("/:key", requirePermission("app_settings.manage"), validateBody(setAppSettingSchema), appSettingsController.set);

export default router;
