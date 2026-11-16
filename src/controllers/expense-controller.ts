import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import * as expenseService from "../services/expense-service";
import type { ExpenseTypeKey } from "../services/expense-service";

export const listTypes = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await expenseService.listExpenseTypes(query));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await expenseService.listMyClaims(req.user!.id));
});

export const listTeam = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await expenseService.listTeamClaims(req.user!.id));
});

export const listPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await expenseService.listPendingApprovals(req.user!.id));
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { userId?: string; from?: string; to?: string; page: number; limit: number };
  sendSuccess(res, await expenseService.searchExpenseClaims(req.user!.id, query));
});

// Multipart request (a receipt file rides alongside the form fields), so
// fields arrive as raw strings in req.body rather than a JSON body zod can
// validate - same shape as fofo-onboarding's document upload route.
export const create = asyncHandler(async (req: Request, res: Response) => {
  const { expenseTypeKey, title, expenseDate, amount, quantity, linkedLeadId, linkedOpportunityId } = req.body;
  if (!expenseTypeKey || !title || !expenseDate || !amount) {
    throw new ApiError(422, "Expense type, title, date and amount are required");
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(422, "Enter a valid amount");
  }
  // expense_claims.amount is NUMERIC(10,2) - anything larger would crash the
  // insert with a database error instead of a clear message.
  if (parsedAmount > 99_999_999.99) {
    throw new ApiError(422, "Amount is too large");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expenseDate)) || Number.isNaN(new Date(`${expenseDate}T00:00:00Z`).getTime())) {
    throw new ApiError(422, "Enter a valid expense date");
  }
  const parsedQuantity = quantity ? Number(quantity) : undefined;
  // Upper bound keeps quantity x per-unit limit inside the NUMERIC(10,2)
  // policy_limit_at_submission column (100,000 km/nights/etc. is already far
  // beyond any real claim).
  if (quantity && (!Number.isFinite(parsedQuantity) || (parsedQuantity as number) <= 0 || (parsedQuantity as number) > 100_000)) {
    throw new ApiError(422, "Enter a valid quantity");
  }

  const claim = await expenseService.createExpenseClaim(
    req.user!.id,
    {
      expenseTypeKey: expenseTypeKey as ExpenseTypeKey,
      title,
      expenseDate,
      amount: parsedAmount,
      quantity: parsedQuantity,
      linkedLeadId: linkedLeadId || undefined,
      linkedOpportunityId: linkedOpportunityId || undefined,
    },
    req.file
  );
  sendSuccess(res, claim, "Expense claim submitted", 201);
});

export const decide = asyncHandler(async (req: Request, res: Response) => {
  const claim = await expenseService.decideExpenseClaim(String(req.params.id), req.user!.id, req.body.decision, req.body.note, req.ip);
  sendSuccess(res, claim, `Claim ${req.body.decision}`);
});

export const markPaid = asyncHandler(async (req: Request, res: Response) => {
  const claim = await expenseService.markClaimPaid(String(req.params.id), req.user!.id);
  sendSuccess(res, claim, "Claim marked as paid");
});

export const downloadReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, originalFilename } = await expenseService.getClaimFile(String(req.params.id), req.user!.id);
  res.download(filePath, originalFilename);
});
