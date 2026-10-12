import { Router } from "express";
import * as paymentController from "../../controllers/payment-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updatePaymentSchema } from "../../validators/payment-validator";

const router = Router();
router.use(requireAuth);

router.patch("/:id", requirePermission("payments.update"), validateBody(updatePaymentSchema), paymentController.update);
router.delete("/:id", requirePermission("payments.delete"), paymentController.remove);

export default router;
