import { z } from 'zod';

// ─── System info ──────────────────────────────────────────────

/** 单条 CPU 核心信息（来自 systeminformation.cpu()） */
export const CpuInfoSchema = z.object({
  /** CPU 品牌字符串（如 "Intel(R) Xeon(R) CPU @ 2.60GHz"） */
  brand: z.string(),
  /** 物理核心数 */
  physicalCores: z.number().int().nonnegative(),
  /** 逻辑核心数 */
  cores: z.number().int().nonnegative(),
  /** CPU 频率（GHz） */
  speed: z.number().nonnegative(),
});
export type CpuInfoDto = z.infer<typeof CpuInfoSchema>;

/** 主机信息响应——前后端共用 */
export const SystemInfoSchema = z.object({
  /** 主机名（如 "unturned-host-01"） */
  hostname: z.string(),
  /** 操作系统发行版（如 "Debian GNU/Linux"） */
  distro: z.string(),
  /** 系统版本（如 "12" / "22.04"） */
  release: z.string(),
  /** 系统架构（如 "x64" / "arm64"） */
  arch: z.string(),
  /** 内核版本（如 "6.1.0-13-amd64"） */
  kernel: z.string(),
  /** 平台标识（如 "linux" / "darwin" / "win32"） */
  platform: z.string(),
  /** CPU 信息 */
  cpu: CpuInfoSchema,
  /** 总内存（MB） */
  memTotalMB: z.number().nonnegative(),
  /** 磁盘总字节数（首个挂载点；容器内即宿主视角） */
  diskTotalBytes: z.number().nonnegative().nullable(),
  /** 磁盘已用字节数 */
  diskUsedBytes: z.number().nonnegative().nullable(),
  /** 游戏端口（来自实例配置 Commands.dat Port，无 serverId 或无配置时为空） */
  gamePort: z.number().int().min(1).max(65535).nullable(),
  /** 查询端口（来自实例配置 Commands.dat QueryPort；U3DS 默认 27016，无配置时为空） */
  queryPort: z.number().int().min(1).max(65535).nullable(),
});
export type SystemInfoDto = z.infer<typeof SystemInfoSchema>;

/** GET /api/system/info 查询参数 */
export const SystemInfoQuerySchema = z.object({
  /** 实例标识（可选，仅用于读取该实例的端口配置；主机信息本身不区分实例） */
  serverId: z.string().optional(),
});
export type SystemInfoQueryInput = z.infer<typeof SystemInfoQuerySchema>;