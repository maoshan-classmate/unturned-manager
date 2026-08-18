import type { ServerId } from "../types/branded.js";

/**
 * ServerID 事件流——Dashboard Status Block 支撑。
 *
 * 设计边界：
 * - **进程内环形缓冲**（不落 SQLite）——incident 是高频流，不是审计日志；后端重启清空可接受
 * - **每实例独立缓冲**——`ServerId → Incident[]`，按时间倒序
 * - **6 类事件**——start / stop / restart / mod_apply / ldm_apply / crash
 * - **3 级严重程度**——info / warning / error
 * - **中文消息**——`message` 是界面可见文案（符合 CLAUDE.md 铁律 ①）
 *
 * 实时推送：broadcast `incident_created` 事件（新增即推）；历史拉取：REST `GET /api/servers/:id/incidents?limit=50`。
 */

/** 事件类型 */
export type IncidentType =
  /** 实例启动（STOPPED → STARTING transition） */
  | "start"
  /** 实例主动停止（transition STOPPING，由用户触发） */
  | "stop"
  /** 实例重启（合并到 start/stop 序列——记录为 start，detail.reason="restart"） */
  | "restart"
  /** Mod 应用变更（mod_apply ready/failed） */
  | "mod_apply"
  /** LDM 应用变更（ldm_apply ready/failed） */
  | "ldm_apply"
  /** 实例异常退出（transition STOPPING 之外的 STOPPED，如 bash 进程崩溃） */
  | "crash";

/** 严重程度 */
export type IncidentSeverity = "info" | "warning" | "error";

/** 事件详情（可选上下文） */
export interface IncidentDetails {
  /** 失败根因 / 重启原因 */
  reason?: string;
  /** 持续时长（毫秒）——例如启动耗时 */
  durationMs?: number;
  /** 应用的 Mod 数 / 插件数 */
  itemCount?: number;
}

/** 单条事件 */
export interface Incident {
  /** UUID v4 ——前端 React key 用 */
  id: string;
  serverId: ServerId;
  type: IncidentType;
  severity: IncidentSeverity;
  /** 中文描述（界面可见文案） */
  message: string;
  /** Unix ms 时间戳 */
  timestamp: number;
  /** 上下文详情 */
  details?: IncidentDetails;
}

/** 事件响应 */
export interface IncidentsResponse {
  serverId: ServerId;
  /** 缓冲事件总数（按时间倒序） */
  total: number;
  /** 事件列表（按时间倒序） */
  incidents: Incident[];
}

/**
 * 事件流服务接口——单进程单实例，跨 ServerID 共享内存缓冲。
 */
export interface IIncidentsService {
  /**
   * 记录一条事件——同步推入环形缓冲 + 经 broadcaster 广播 `incident_created`。
   *
   * @param serverId - 实例标识
   * @param type - 事件类型
   * @param severity - 严重程度
   * @param message - 中文描述（界面可见文案）
   * @param details - 可选上下文
   * @returns 完整事件对象（含生成的 id 与 timestamp）
   */
  record(
    serverId: ServerId,
    type: IncidentType,
    severity: IncidentSeverity,
    message: string,
    details?: IncidentDetails,
  ): Incident;

  /**
   * 查询指定实例的事件快照。
   *
   * @param serverId - 实例标识
   * @param limit - 返回条数（默认 50，上限 200）
   * @returns 事件列表（按时间倒序）+ 总数
   */
  getIncidents(serverId: ServerId, limit?: number): IncidentsResponse;
}
