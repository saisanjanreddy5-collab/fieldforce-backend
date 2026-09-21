import { z } from "zod";

export const createTerritoryTransferSchema = z.object({
  fromUserId: z.string().uuid(),
  newTerritory: z.string().min(1, "New territory is required"),
  effectiveDate: z.string().min(1, "Effective date is required"),
  note: z.string().optional(),
});

export const createScheduledReassignSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  note: z.string().optional(),
});

export const createExitSchema = z.object({
  fromUserId: z.string().uuid(),
  effectiveDate: z.string().min(1, "Effective date is required"),
});
