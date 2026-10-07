import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const listManagerChangesQuerySchema = paginationQuerySchema.extend({
  userId: z.string().uuid().optional(),
});
