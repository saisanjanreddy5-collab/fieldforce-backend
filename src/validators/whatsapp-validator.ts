import { z } from "zod";

export const sendWhatsappMessageSchema = z.object({
  body: z.string().min(1, "Message can't be empty").max(4096),
});
