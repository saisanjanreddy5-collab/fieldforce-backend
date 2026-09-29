import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { isWhatsappConfigured } from "../config/whatsapp";
import { isSmartfloConfigured } from "../config/smartflo";

// Org-wide (env-configured) integrations only - Microsoft 365 is per-user
// OAuth and already has its own /integrations/microsoft/status. This is
// deliberately a status *read*, not a connect/disconnect surface: both of
// these are set via server environment variables, not anything a UI button
// can toggle.
export const status = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, {
    whatsapp: isWhatsappConfigured(),
    smartflo: isSmartfloConfigured(),
  });
});
