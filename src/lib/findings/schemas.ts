import { z } from "zod";
import { Constants } from "@/types/database";

/** Filtros de la tabla de hallazgos (vienen de la URL: se validan y se normalizan). */

const severity = z.enum(Constants.public.Enums.severity_level);
const status = z.enum(Constants.public.Enums.finding_status);

/** Un valor inválido o vacío equivale a "sin filtro" en lugar de un error. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (Array.isArray(value) ? value[0] : value), schema.optional().catch(undefined));
}

export const findingFiltersSchema = z.object({
  severity: optional(severity),
  status: optional(status),
  project: optional(z.uuid()),
  type: optional(z.string().regex(/^[a-z0-9_]{1,64}$/)),
  page: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.coerce.number().int().min(1).max(10_000).catch(1),
  ),
});

export type FindingFilters = z.infer<typeof findingFiltersSchema>;

export const FINDINGS_PAGE_SIZE = 25;

/** Cambio de estado hecho por el usuario (solo `status` y `status_note`, como permite RLS). */
export const statusChangeSchema = z.object({
  id: z.uuid(),
  status,
  note: z
    .string()
    .trim()
    .max(500, "La nota admite hasta 500 caracteres.")
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "La nota tiene caracteres no válidos."),
});
