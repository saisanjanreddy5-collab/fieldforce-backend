import { Router } from "express";
import * as salesOrderController from "../../controllers/sales-order-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateSalesOrderSchema } from "../../validators/sales-order-validator";

const router = Router();
router.use(requireAuth);

router.patch("/:id", requirePermission("sales_orders.update"), validateBody(updateSalesOrderSchema), salesOrderController.update);
router.delete("/:id", requirePermission("sales_orders.delete"), salesOrderController.remove);

export default router;
