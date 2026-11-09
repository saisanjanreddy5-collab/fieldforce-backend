import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import * as leadDocumentService from "../services/lead-document-service";
import * as leadService from "../services/lead-service";

// Generic per-lead document upload/download, reusing the exact same
// lead_documents table and files FOFO onboarding already relies on (see
// lead-document-service.ts) - this just opens a second, more appropriately-
// scoped front door onto it for a lead that isn't in FOFO onboarding yet
// (e.g. uploading the Consent tab's "consent_form" evidence), gated by the
// general leads.update permission instead of a FOFO-specific one.

async function assertVisible(leadId: string, userId: string): Promise<void> {
  const visible = await leadService.isLeadVisibleToUser(leadId, userId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this lead");
  }
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const leadId = String(req.params.leadId);
  await assertVisible(leadId, req.user!.id);
  sendSuccess(res, await leadDocumentService.listDocuments(leadId));
});

export const upload = asyncHandler(async (req: Request, res: Response) => {
  const leadId = String(req.params.leadId);
  await assertVisible(leadId, req.user!.id);
  if (!req.file) {
    throw new ApiError(422, "A file is required");
  }
  const document = await leadDocumentService.saveUploadedFile(leadId, String(req.body.docType), req.file, req.user!.id);
  sendSuccess(res, document, "Document uploaded", 201);
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const documentId = String(req.params.documentId);
  const leadId = await leadDocumentService.getDocumentLeadId(documentId);
  await assertVisible(leadId, req.user!.id);
  const { filePath, originalFilename } = await leadDocumentService.getDocumentFile(documentId);
  res.download(filePath, originalFilename);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const documentId = String(req.params.documentId);
  const leadId = await leadDocumentService.getDocumentLeadId(documentId);
  await assertVisible(leadId, req.user!.id);
  const document = await leadDocumentService.deleteDocumentFile(documentId);
  sendSuccess(res, document, "Document removed");
});
