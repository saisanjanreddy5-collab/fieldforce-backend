import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as auditLogService from "../services/audit-log-service";
import * as consentRegisterService from "../services/consent-register-service";

export const listAuditLog = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await auditLogService.listAuditLog());
});

export const getConsentRegister = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await consentRegisterService.getConsentRegister());
});

export const listConsentRecords = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await consentRegisterService.listConsentRecords());
});
