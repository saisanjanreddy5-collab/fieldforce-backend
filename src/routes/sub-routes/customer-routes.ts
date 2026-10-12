import { Router } from "express";
import * as customerController from "../../controllers/customer-controller";
import * as customerContactController from "../../controllers/customer-contact-controller";
import * as customerAddressController from "../../controllers/customer-address-controller";
import * as salesOrderController from "../../controllers/sales-order-controller";
import * as invoiceController from "../../controllers/invoice-controller";
import * as paymentController from "../../controllers/payment-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { listCustomersQuerySchema, updateCustomerSchema } from "../../validators/customer-validator";
import { createContactSchema } from "../../validators/customer-contact-validator";
import { createAddressSchema } from "../../validators/customer-address-validator";
import { createSalesOrderSchema } from "../../validators/sales-order-validator";
import { createInvoiceSchema } from "../../validators/invoice-validator";
import { createPaymentSchema } from "../../validators/payment-validator";

const router = Router();

router.use(requireAuth);

// No POST / - a customer is never created directly, only produced
// automatically when a lead's status changes to 'converted'.
router.get("/", requirePermission("customers.view"), validateQuery(listCustomersQuerySchema), customerController.list);
router.get("/:id", requirePermission("customers.view"), customerController.getById);
router.patch("/:id", requirePermission("customers.update"), validateBody(updateCustomerSchema), customerController.update);

// Read-only merged feeds for the detail panel's Transactions/Activity tabs.
router.get("/:id/transactions", requirePermission("customers.view"), customerController.transactions);
router.get("/:id/timeline", requirePermission("customers.view"), customerController.timeline);

// Contacts/addresses are sub-records of a customer, not independent
// entities - gated on customers.view/update like everything else here,
// not a separate permission namespace.
router.get("/:customerId/contacts", requirePermission("customers.view"), customerContactController.list);
router.post(
  "/:customerId/contacts",
  requirePermission("customers.update"),
  validateBody(createContactSchema),
  customerContactController.create
);
router.get("/:customerId/addresses", requirePermission("customers.view"), customerAddressController.list);
router.post(
  "/:customerId/addresses",
  requirePermission("customers.update"),
  validateBody(createAddressSchema),
  customerAddressController.create
);

// Sales orders/invoices/payments are real, independent business entities -
// their own permission namespace, same reasoning quotes.* already follows.
router.get("/:customerId/sales-orders", requirePermission("sales_orders.view"), salesOrderController.list);
router.post(
  "/:customerId/sales-orders",
  requirePermission("sales_orders.create"),
  validateBody(createSalesOrderSchema),
  salesOrderController.create
);
router.get("/:customerId/invoices", requirePermission("invoices.view"), invoiceController.list);
router.post(
  "/:customerId/invoices",
  requirePermission("invoices.create"),
  validateBody(createInvoiceSchema),
  invoiceController.create
);
router.get("/:customerId/payments", requirePermission("payments.view"), paymentController.list);
router.post(
  "/:customerId/payments",
  requirePermission("payments.create"),
  validateBody(createPaymentSchema),
  paymentController.create
);

export default router;
