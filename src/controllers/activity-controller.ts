import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as activityService from "../services/activity-service";

export const createForLead = asyncHandler(async (req: Request, res: Response) => {
  const activity = await activityService.createActivityForLead(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, activity, "Activity created", 201);
});

export const createForOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const activity = await activityService.createActivityForOpportunity(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, activity, "Activity created", 201);
});

export const listForLead = asyncHandler(async (req: Request, res: Response) => {
  const activities = await activityService.listActivitiesForLead(String(req.params.id), req.user!.id);
  sendSuccess(res, activities);
});

export const listForOpportunity = asyncHandler(async (req: Request, res: Response) => {
  const activities = await activityService.listActivitiesForOpportunity(String(req.params.id), req.user!.id);
  sendSuccess(res, activities);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as {
    type?: string;
    leadId?: string;
    opportunityId?: string;
    status?: string;
    assignedTo?: string;
    page: number;
    limit: number;
  };
  const activities = await activityService.listActivitiesForUser(req.user!.id, query);
  sendSuccess(res, activities);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const activity = await activityService.getActivityById(String(req.params.id), req.user!.id);
  sendSuccess(res, activity);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const activity = await activityService.updateActivity(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, activity, "Activity updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await activityService.deleteActivity(String(req.params.id), req.user!.id);
  sendSuccess(res, null, "Activity deleted");
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await activityService.addComment(String(req.params.id), req.body.comment, req.user!.id);
  sendSuccess(res, comment, "Comment added", 201);
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const comments = await activityService.listComments(String(req.params.id), req.user!.id);
  sendSuccess(res, comments);
});
