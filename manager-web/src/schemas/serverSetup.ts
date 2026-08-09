import { z } from 'zod';

/**
 * SteamCMD 安装路径——绝对路径校验,只允许 Linux/Mac 风格 (/)。
 * Windows 风格 (C:\...) 当前不在范围,因为面板部署目标是 Linux。
 */
export const steamcmdPathSchema = z.object({
  installPath: z
    .string()
    .min(1, '请输入安装路径')
    .regex(/^\/[a-zA-Z0-9_\-/.]+$/, '必须是绝对路径,以 / 开头'),
});
export type SteamcmdPathForm = z.infer<typeof steamcmdPathSchema>;

/** Cron 五字段下拉枚举(分钟/小时/日/月/周) */
export const CRON_FIELDS = ['minute', 'hour', 'day', 'month', 'weekday'] as const;
export type CronField = (typeof CRON_FIELDS)[number];

/**
 * 计划任务——cron 5 字段 + shell 命令 + 启用开关。
 * 5 字段全部非空,允许 "*" 表示"每"。
 */
export const scheduledTaskSchema = z.object({
  name: z.string().min(1, '请输入任务名称').max(64),
  minute: z.string().min(1, '分钟必填'),
  hour: z.string().min(1, '小时必填'),
  day: z.string().min(1, '日必填'),
  month: z.string().min(1, '月必填'),
  weekday: z.string().min(1, '周必填'),
  shellCommand: z.string().min(1, '请输入要执行的命令'),
  enabled: z.boolean(),
});
export type ScheduledTaskForm = z.infer<typeof scheduledTaskSchema>;

/**
 * 启动命令(commands.dat 多行文本)
 * 一行一条指令;最小 1 行,最大 100 行(防误粘贴)
 */
export const launchCommandsSchema = z.object({
  commands: z
    .string()
    .min(1, '命令不能为空')
    .max(10_000, '命令过长(>10KB)')
    .refine((v) => v.split('\n').length <= 100, '行数过多(>100 行)'),
});
export type LaunchCommandsForm = z.infer<typeof launchCommandsSchema>;