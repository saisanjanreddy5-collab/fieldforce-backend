import { Router } from "express";
import * as invoiceController from "../../controllers/invoice-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateInvoiceSchema } from "../../validators/invoice-validator";

const router = Router();
router.use(requireAuth);

router.patch("/:id", requirePermission("invoices.update"), validateBody(updateInvoiceSchema), invoiceController.update);
router.delete("/:id", requirePermission("invoices.delete"), invoiceController.remove);

export default router;
