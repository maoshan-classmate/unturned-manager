import { z } from "zod";

/** 事件类型枚举（与 contracts/incidents.ts 的 IncidentType 对齐） */
export const IncidentTypeSchema = z.enum([
  "start",
  "stop",
  "restart",
  "mod_apply",
  "ldm_apply",
  "crash",
]);

/** 严重程度 */
export const IncidentSeveritySchema = z.enum(["info", "warning", "error"]);

/** 事件详情 */
export const IncidentDetailsSchema = z
  .object({
    reason: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
  })
  .strict();

/** 单条事件 */
export const IncidentSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  type: IncidentTypeSchema,
  severity: IncidentSeveritySchema,
  message: z.string().min(1),
  timestamp: z.number().int().positive(),
  details: IncidentDetailsSchema.optional(),
});

/** 事件接口查询参数（limit 默认 50，上限 200） */
export const IncidentsQuerySchema = z.object({
  limit: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int())
    .pipe(z.number().int().min(1).max(200))
    .optional(),
});

/** 事件响应 */
export const IncidentsResponseSchema = z.object({
  serverId: z.string().min(1),
  total: z.number().int().nonnegative(),
  incidents: z.array(IncidentSchema),
});

export type IncidentDto = z.infer<typeof IncidentSchema>;
export type IncidentsQueryDto = z.infer<typeof IncidentsQuerySchema>;
export type IncidentsResponseDto = z.infer<typeof IncidentsResponseSchema>;
