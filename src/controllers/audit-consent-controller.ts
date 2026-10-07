import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as auditLogService from "../services/audit-log-service";
import * as consentRegisterService from "../services/consent-register-service";

export const listAuditLog = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await auditLogService.listAuditLog(page, limit));
});

export const getConsentRegister = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await consentRegisterService.getConsentRegister());
});

export const listConsentRecords = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await consentRegisterService.listConsentRecords(page, limit));
});
