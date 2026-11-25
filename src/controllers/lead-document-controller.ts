import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/api-error";
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

// Changing a lead's files needs the same right as editing the lead itself -
// read-only visibility (a shared lead, or Call Center's company-wide lookup)
// is enough to view/download, never to upload over or remove a document.
async function assertCanModify(leadId: string, userId: string): Promise<void> {
  const canModify = await leadService.isLeadInOwnerScope(leadId, userId);
  if (!canModify) {
    throw new ApiError(403, "You can't change documents on this lead");
  }
}

// This general door exists for the Consent tab's evidence only. Every FOFO
// document (PAN, GST, cheque, ...) goes through fofo-onboarding-routes.ts,
// which has its own upload/verify permissions - so it can't be replaced or
// removed from here, bypassing those.
const GENERAL_DOC_TYPES = new Set(["consent_form"]);

export const list = asyncHandler(async (req: Request, res: Response) => {
  const leadId = String(req.params.leadId);
  await assertVisible(leadId, req.user!.id);
  sendSuccess(res, await leadDocumentService.listDocuments(leadId));
});

export const upload = asyncHandler(async (req: Request, res: Response) => {
  const leadId = String(req.params.leadId);
  await assertCanModify(leadId, req.user!.id);
  if (!req.file) {
    throw new ApiError(422, "A file is required");
  }
  const docType = String(req.body.docType);
  if (!GENERAL_DOC_TYPES.has(docType)) {
    throw new ApiError(422, "This document type is uploaded from FOFO onboarding");
  }
  const document = await leadDocumentService.saveUploadedFile(leadId, docType, req.file, req.user!.id, req.ip);
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
  await assertCanModify(leadId, req.user!.id);
  const docType = await leadDocumentService.getDocumentType(documentId);
  if (!GENERAL_DOC_TYPES.has(docType)) {
    throw new ApiError(422, "This document is managed from FOFO onboarding");
  }
  const document = await leadDocumentService.deleteDocumentFile(documentId, req.user!.id, req.ip);
  sendSuccess(res, document, "Document removed");
});
