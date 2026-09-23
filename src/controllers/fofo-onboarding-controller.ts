import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import * as fofoOnboardingService from "../services/fofo-onboarding-service";
import * as leadService from "../services/lead-service";
import * as leadDocumentService from "../services/lead-document-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const leads = await fofoOnboardingService.listFofoOnboardings(req.user!.id);
  sendSuccess(res, leads);
});

export const getHandoff = asyncHandler(async (req: Request, res: Response) => {
  const handoff = await fofoOnboardingService.getHandoff(String(req.params.leadId), req.user!.id);
  sendSuccess(res, handoff);
});

export const decideStep = asyncHandler(async (req: Request, res: Response) => {
  const leadId = await fofoOnboardingService.decideStep(String(req.params.stepId), req.body.decision, req.user!.id, req.user!.role);
  const handoff = await fofoOnboardingService.getHandoff(leadId, req.user!.id);
  sendSuccess(res, handoff, "Approval recorded");
});

export const push = asyncHandler(async (req: Request, res: Response) => {
  const handoff = await fofoOnboardingService.pushToOnboardingApp(String(req.params.leadId), req.user!.id);
  sendSuccess(res, handoff, "Pushed to onboarding app");
});

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new ApiError(422, "A file is required");
  }
  const document = await leadDocumentService.saveUploadedFile(String(req.params.leadId), String(req.body.docType), req.file, req.user!.id);
  sendSuccess(res, document, "Document uploaded", 201);
});

export const updateDocumentStatus = asyncHandler(async (req: Request, res: Response) => {
  const document = await leadDocumentService.updateDocumentStatus(String(req.params.documentId), req.body.status, req.body.notes);
  sendSuccess(res, document, "Document status updated");
});

export const downloadDocument = asyncHandler(async (req: Request, res: Response) => {
  const leadId = await leadDocumentService.getDocumentLeadId(String(req.params.documentId));
  const visible = await leadService.isLeadVisibleToUser(leadId, req.user!.id);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this document");
  }
  const { filePath, originalFilename } = await leadDocumentService.getDocumentFile(String(req.params.documentId));
  res.download(filePath, originalFilename);
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await leadDocumentService.deleteDocumentFile(String(req.params.documentId));
  sendSuccess(res, document, "Document removed");
});
