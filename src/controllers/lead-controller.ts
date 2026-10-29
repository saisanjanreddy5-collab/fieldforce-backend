import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as leadService from "../services/lead-service";
import * as leadCallCenterService from "../services/lead-call-center-service";
import * as leadExportService from "../services/lead-export-service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.createLead(req.body, req.user!.id, req.ip);
  sendSuccess(res, lead, "Lead created", 201);
});

// Call Center's own "Add lead" action - a contact who called in directly,
// not from a marketing import. Always lands in the creator's own Call
// Center queue (see createOwnQueueLead's own comment) - deliberately not
// the same createLead path the generic "+ New Lead" form uses above.
export const createOwnQueueLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.createOwnQueueLead(req.body, req.user!.id, req.ip);
  sendSuccess(res, lead, "Lead added to your queue", 201);
});

export const bulkImport = asyncHandler(async (req: Request, res: Response) => {
  const { rows } = req.body as { rows: Record<string, unknown>[] };
  const result = await leadService.bulkImportLeads(rows, req.user!.id);
  sendSuccess(res, result, "Import complete");
});

export const listTerritories = asyncHandler(async (_req: Request, res: Response) => {
  const territories = await leadService.listDistinctTerritories();
  sendSuccess(res, territories);
});

export const listHandedOff = asyncHandler(async (req: Request, res: Response) => {
  const leads = await leadService.listLeadsHandedOffByUser(req.user!.id);
  sendSuccess(res, leads);
});

export const listSources = asyncHandler(async (_req: Request, res: Response) => {
  const sources = await leadService.getDistinctLeadSources();
  sendSuccess(res, sources);
});

export const quickFilterCounts = asyncHandler(async (req: Request, res: Response) => {
  const counts = await leadService.getQuickFilterCounts(req.user!.id);
  sendSuccess(res, counts);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    status?: string;
    ownerId?: string;
    zoneId?: string;
    stateId?: string;
    districtId?: string;
    areaId?: string;
    search?: string;
    category?: string;
    source?: string;
    overdueOnly?: boolean;
    highScoreOnly?: boolean;
    consentPending?: boolean;
    unassignedOnly?: boolean;
    page: number;
    limit: number;
  };
  const result = await leadService.listLeadsForUser(req.user!.id, query);
  sendSuccess(res, result);
});

export const exportLeads = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    status?: string;
    ownerId?: string;
    zoneId?: string;
    stateId?: string;
    districtId?: string;
    areaId?: string;
    search?: string;
    category?: string;
    source?: string;
    overdueOnly?: boolean;
    highScoreOnly?: boolean;
    consentPending?: boolean;
    unassignedOnly?: boolean;
  };
  const result = await leadExportService.getLeadsExportData(req.user!.id, query);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.getLeadById(String(req.params.id), req.user!.id);
  sendSuccess(res, lead);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadService.updateLead(String(req.params.id), req.body, req.user!.id, req.ip);
  sendSuccess(res, lead, "Lead updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await leadService.deleteLead(String(req.params.id), req.user!.id, req.ip);
  sendSuccess(res, null, "Lead deleted");
});

export const share = asyncHandler(async (req: Request, res: Response) => {
  await leadService.shareLead(String(req.params.id), req.body.userId, req.user!.id);
  sendSuccess(res, null, "Lead shared", 201);
});

export const unshare = asyncHandler(async (req: Request, res: Response) => {
  await leadService.unshareLead(String(req.params.id), String(req.params.userId), req.user!.id);
  sendSuccess(res, null, "Share removed");
});

export const listShares = asyncHandler(async (req: Request, res: Response) => {
  const shares = await leadService.listLeadShares(String(req.params.id), req.user!.id);
  sendSuccess(res, shares);
});

export const getConsent = asyncHandler(async (req: Request, res: Response) => {
  const consent = await leadService.getLeadConsent(String(req.params.id), req.user!.id);
  sendSuccess(res, consent);
});

export const getTimeline = asyncHandler(async (req: Request, res: Response) => {
  const timeline = await leadService.getLeadTimeline(String(req.params.id), req.user!.id);
  sendSuccess(res, timeline);
});

export const logCallDisposition = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.logCallDisposition(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, lead, "Call logged", 201);
});

export const qualify = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.qualifyLead(String(req.params.id), req.user!.id, req.ip);
  sendSuccess(res, lead, "Lead marked Qualified");
});

export const escalateToSlc = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.escalateToSlc(String(req.params.id), req.user!.id, req.ip);
  sendSuccess(res, lead, "Escalated to SLC");
});

export const getSwapCandidates = asyncHandler(async (req: Request, res: Response) => {
  const candidates = await leadCallCenterService.getSwapCandidates(String(req.params.id), req.user!.id);
  sendSuccess(res, candidates);
});

export const sendToField = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.sendToField(String(req.params.id), req.user!.id, req.body.ownerId, req.ip);
  sendSuccess(res, lead, "Sent to Field Sales");
});

export const reassign = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadCallCenterService.reassignLead(String(req.params.id), req.body.ownerId, req.user!.id, req.ip);
  sendSuccess(res, lead, "Lead reassigned");
});
