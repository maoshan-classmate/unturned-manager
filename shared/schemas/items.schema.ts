import { z } from 'zod';

// ─── 物品清单 ────────────────────────────────────────────

/** 物品清单记录 schema——source 驱动只读规则 */
export const ItemRecordSchema = z.object({
  /** 物品 ID（0–65535，全局唯一） */
  id: z.number().int().min(0).max(65535),
  /** 源名（内置=wiki 英文名；自定义=用户输入） */
  name: z.string().min(1, '名称不能为空').max(64, '名称不能超过 64 字'),
  /** 中文显示名（仅前端 UI 显示）；空 → 回落 name */
  label: z.string().max(64, '显示名不能超过 64 字').nullable().optional(),
  /** 来源：内置（只读）| 自定义 */
  source: z.enum(['builtin', 'custom']),
});
export type ItemRecordDto = z.infer<typeof ItemRecordSchema>;

/** 新增自定义物品 */
export const CreateItemSchema = z.object({
  id: z
    .number()
    .int('物品 ID 需为整数')
    .min(0, '物品 ID 需在 0–65535 之间')
    .max(65535, '物品 ID 需在 0–65535 之间'),
  name: z.string().min(1, '名称不能为空').max(64, '名称不能超过 64 字'),
  label: z.string().max(64, '显示名不能超过 64 字').nullable().optional(),
});
export type CreateItemInput = z.infer<typeof CreateItemSchema>;

/** 修改自定义物品——ID / 名称 / 显示名至少改一项 */
export const UpdateItemSchema = z
  .object({
    id: z
      .number()
      .int('物品 ID 需为整数')
      .min(0, '物品 ID 需在 0–65535 之间')
      .max(65535, '物品 ID 需在 0–65535 之间')
      .optional(),
    name: z.string().min(1, '名称不能为空').max(64, '名称不能超过 64 字').optional(),
    label: z.string().max(64, '显示名不能超过 64 字').nullable().optional(),
  })
  .refine(
    (d) => d.id !== undefined || d.name !== undefined || d.label !== undefined,
    { message: '至少修改一项' },
  );
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
