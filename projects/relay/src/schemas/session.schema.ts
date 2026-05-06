import { z } from "zod";

export const createSessionSchema = z.object({
  origin: z.string().url(),
  operation: z.enum(["auth", "sign"]),
  data: z.string().optional(), // base64
  reason: z.string().optional(),
  format: z.enum(["cms", "xml"]).optional(),
});

export const completeSessionSchema = z.object({
  certificate: z.string().min(1),
  signature: z.string().min(1),
  algorithm: z.string().min(1),
  subjectDN: z.string().optional(),
  notBefore: z.string().optional(),
  notAfter: z.string().optional(),
  signedDocument: z.string().optional(),
  cmsSignature: z.string().optional(),
});
