import { z } from "zod";

export const setAppSettingSchema = z.object({
  value: z.union([z.string(), z.number()]),
});
