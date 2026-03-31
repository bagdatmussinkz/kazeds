import { z } from "zod";

const metaSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const cmsFileSchema = z.object({
  file: z.object({
    mime: z.string(),
    data: z.string(),
  }),
});

const documentItemSchema = z.object({
  id: z.number(),
  nameRu: z.string(),
  nameKz: z.string().optional(),
  nameEn: z.string().optional(),
  meta: z.array(metaSchema).optional(),
  documentXml: z.string().optional(),
  document: cmsFileSchema.optional(),
});

export const createEgovSessionSchema = z.object({
  description: z.string(),
  organisation: z.object({
    nameRu: z.string(),
    nameKz: z.string().optional(),
    nameEn: z.string().optional(),
    bin: z.string(),
  }),
  signMethod: z.enum(["XML", "CMS_SIGN_ONLY", "CMS_WITH_DATA"]),
  documentsToSign: z.array(documentItemSchema).min(1),
});

export const putEgovDocumentsSchema = z.object({
  signMethod: z.enum(["XML", "CMS_SIGN_ONLY", "CMS_WITH_DATA"]),
  documentsToSign: z.array(documentItemSchema).min(1),
});

export type CreateEgovSessionInput = z.infer<typeof createEgovSessionSchema>;
export type PutEgovDocumentsInput = z.infer<typeof putEgovDocumentsSchema>;
