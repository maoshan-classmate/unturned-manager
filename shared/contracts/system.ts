/**
 * 主机信息服务契约——Dashboard 主机信息卡后端支撑。
 *
 * 数据来源：systeminformation 一次性快照（osInfo / cpu / mem / fsSize）+ 实例端口。
 * 进程内缓存，不采样；主机信息变化慢。
 */

/** CPU 核心信息 */
export interface CpuInfo {
  /** 品牌字符串 */
  brand: string;
  /** 物理核心数 */
  physicalCores: number;
  /** 逻辑核心数 */
  cores: number;
  /** 频率（GHz） */
  speed: number;
}

/** 主机信息响应 */
export interface SystemInfo {
  hostname: string;
  distro: string;
  release: string;
  arch: string;
  kernel: string;
  platform: string;
  cpu: CpuInfo;
  memTotalMB: number;
  /** 磁盘总字节数（首个挂载点） */
  diskTotalBytes: number | null;
  /** 磁盘已用字节数 */
  diskUsedBytes: number | null;
  /** 游戏端口（来自实例配置，无 serverId 或无配置时为空） */
  gamePort: number | null;
  /** 查询端口 */
  queryPort: number | null;
}

/**
 * 主机信息服务接口。
 *
 * @example
 * ```typescript
 * const info = await systemInfoService.getSystemInfo("MyServer");
 * // → SystemInfo
 * ```
 */
export interface ISystemInfoService {
  /**
   * 查询主机信息。
   *
   * @param serverId - 实例标识（可选，传入时附加该实例的游戏端口与查询端口）
   * @returns 主机信息快照；字段读取失败时降级为空
   */
  getSystemInfo(serverId?: string): Promise<SystemInfo>;
}