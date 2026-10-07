import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import * as leadCategoryService from "../services/lead-category-service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validatedQuery as unknown as { page: number; limit: number };
  sendSuccess(res, await leadCategoryService.listLeadCategoriesPaginated(query));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const category = await leadCategoryService.createLeadCategory(req.body);
  sendSuccess(res, category, "Category created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const category = await leadCategoryService.updateLeadCategory(String(req.params.key), req.body);
  sendSuccess(res, category, "Category updated");
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const categories = await leadCategoryService.reorderLeadCategories(req.body.orderedKeys);
  sendSuccess(res, categories, "Categories reordered");
});
