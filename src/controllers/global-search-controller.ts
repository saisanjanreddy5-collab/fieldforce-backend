import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as globalSearchService from "../services/global-search-service";

export const search = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { q: string };
  const results = await globalSearchService.globalSearch(req.user!.id, query.q);
  sendSuccess(res, results);
});
