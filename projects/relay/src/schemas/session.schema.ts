import { z } from "zod";

export const createSessionSchema = z.object({
  origin: z.string().url(),
  operation: z.enum(["auth", "sign"]),
  data: z.string().optional(), // base64
  reason: z.string().optional(),
});

export const completeSessionSchema = z.object({
  certificate: z.string().min(1),
  signature: z.string().min(1),
  algorithm: z.enum(["SHA256withRSA", "SHA256withECDSA"]),
});
