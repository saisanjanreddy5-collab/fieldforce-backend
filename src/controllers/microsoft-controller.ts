import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import * as microsoftService from "../services/microsoft-service";

// Returns the Microsoft sign-in URL as JSON rather than redirecting
// directly - this endpoint is behind requireAuth (reads the CRM user from
// the Authorization header), but a plain browser navigation can't carry
// that header. The frontend calls this via axios, then navigates the
// browser to the returned URL itself.
export const connect = asyncHandler(async (req: Request, res: Response) => {
  const authUrl = microsoftService.buildAuthUrl(req.user!.id);
  sendSuccess(res, { authUrl });
});

export const callback = asyncHandler(async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (!code || !state) {
    throw new ApiError(400, "Missing code or state from Microsoft's redirect");
  }

  try {
    await microsoftService.handleOAuthCallback(code, state);
    res.redirect(`${env.FRONTEND_URL}/sales-force-management?microsoft=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    res.redirect(`${env.FRONTEND_URL}/sales-force-management?microsoft=error&reason=${encodeURIComponent(message)}`);
  }
});

export const status = asyncHandler(async (req: Request, res: Response) => {
  const result = await microsoftService.getConnectionStatus(req.user!.id);
  sendSuccess(res, result);
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  await microsoftService.disconnect(req.user!.id);
  sendSuccess(res, null, "Microsoft 365 account disconnected");
});

export const sendEmailForLead = asyncHandler(async (req: Request, res: Response) => {
  const { subject, body } = req.body;
  await microsoftService.sendMailForLead(String(req.params.id), subject, body, req.user!.id);
  sendSuccess(res, null, "Email sent");
});

export const createMeetingForLead = asyncHandler(async (req: Request, res: Response) => {
  const { subject, startTime, endTime } = req.body;
  const result = await microsoftService.createTeamsMeetingForLead(
    String(req.params.id),
    subject,
    startTime,
    endTime,
    req.user!.id
  );
  sendSuccess(res, result, "Teams meeting created");
});
