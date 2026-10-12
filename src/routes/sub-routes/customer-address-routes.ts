import { Router } from "express";
import * as customerAddressController from "../../controllers/customer-address-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateAddressSchema } from "../../validators/customer-address-validator";

const router = Router();
router.use(requireAuth);

router.patch("/:id", requirePermission("customers.update"), validateBody(updateAddressSchema), customerAddressController.update);
router.delete("/:id", requirePermission("customers.update"), customerAddressController.remove);

export default router;
