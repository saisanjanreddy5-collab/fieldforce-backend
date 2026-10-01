import { Router } from "express";
import * as quoteController from "../../controllers/quote-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createQuoteSchema,
  listQuotesQuerySchema,
  updateQuoteSchema,
  updateQuoteStatusSchema,
} from "../../validators/quote-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("quotes.view"), validateQuery(listQuotesQuerySchema), quoteController.list);
router.post("/", requirePermission("quotes.create"), validateBody(createQuoteSchema), quoteController.create);
router.get("/:id", requirePermission("quotes.view"), quoteController.getById);
router.get("/:id/pdf", requirePermission("quotes.view"), quoteController.downloadPdf);
router.patch("/:id", requirePermission("quotes.update"), validateBody(updateQuoteSchema), quoteController.update);
router.patch("/:id/status", requirePermission("quotes.update"), validateBody(updateQuoteStatusSchema), quoteController.updateStatus);

export default router;
