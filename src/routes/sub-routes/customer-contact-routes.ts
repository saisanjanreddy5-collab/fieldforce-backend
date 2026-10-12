import { Router } from "express";
import * as customerContactController from "../../controllers/customer-contact-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateContactSchema } from "../../validators/customer-contact-validator";

const router = Router();
router.use(requireAuth);

// List/create live nested under /customers/:customerId/contacts - this
// router only handles update/delete by the contact's own id.
router.patch("/:id", requirePermission("customers.update"), validateBody(updateContactSchema), customerContactController.update);
router.delete("/:id", requirePermission("customers.update"), customerContactController.remove);

export default router;
