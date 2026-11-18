import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as customerService from "../services/customer-service";
import { ApiError } from "../utils/ApiError";
import { ROLES } from "../utils/roles";
import { getCustomerPortalStatus, inviteCustomerToPortal, HelpdeskError } from "../services/frappe-helpdesk-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number; search?: string; status?: string };
  const result = await customerService.listCustomers(req.user!.id, query);
  sendSuccess(res, result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(String(req.params.id), req.user!.id);
  sendSuccess(res, customer);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(String(req.params.id), req.body, req.user!.id);
  sendSuccess(res, customer, "Customer updated");
});

export const transactions = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.getCustomerTransactions(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});

export const timeline = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.getCustomerTimeline(String(req.params.id), req.user!.id);
  sendSuccess(res, result);
});

async function assertInScope(customerId: string, userId: string): Promise<void> {
  if (!(await customerService.isCustomerInScope(customerId, userId))) {
    throw new ApiError(403, "You do not have access to this customer");
  }
}

// Support-portal (Frappe Helpdesk) access for this customer - shown on the
// customer page with its Send / Resend invite button.
export const supportPortalStatus = asyncHandler(async (req: Request, res: Response) => {
  const customerId = String(req.params.id);
  await assertInScope(customerId, req.user!.id);
  sendSuccess(res, await getCustomerPortalStatus(customerId));
});

export const supportPortalInvite = asyncHandler(async (req: Request, res: Response) => {
  const customerId = String(req.params.id);
  await assertInScope(customerId, req.user!.id);
  // Giving access before a deal is Won is an Admin decision.
  const grant = req.body?.grant === true;
  if (grant && req.user!.role !== ROLES.ADMIN) {
    throw new ApiError(403, "Only an Admin can give support-portal access before a deal is Won");
  }
  try {
    const status = await inviteCustomerToPortal(customerId, grant);
    sendSuccess(res, status, "Invite sent");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof HelpdeskError && (err.status === 403 || err.status === 503)) throw new ApiError(err.status, err.message);
    console.error(`Support-portal invite for customer ${customerId} failed:`, err instanceof Error ? err.message : err);
    throw new ApiError(502, "Couldn't reach the support helpdesk to send the invite - please try again in a minute");
  }
});
