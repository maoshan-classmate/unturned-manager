import { randomUUID } from "node:crypto";
import type {
  IBroadcaster,
  IIncidentsService,
  Incident,
  IncidentDetails,
  IncidentSeverity,
  IncidentType,
  IncidentsResponse,
  ServerId,
} from "@unturned-manager/shared";

/**
 * ServerID 事件流服务——Dashboard Status Block 支撑。
 *
 * 实现：
 * - 进程内环形缓冲（每实例一份），默认 100 条上限
 * - 经 IBroadcaster 推送 `incident_created` 事件（前端无须轮询）
 * - 时间倒序返回（最近事件在前）
 * - 单调递增 timestamp：record 内自增序列号，避免同毫秒多事件时排序不稳定
 */
const DEFAULT_LIMIT = 50;
const MAX_BUFFER = 100;

export class IncidentsService implements IIncidentsService {
  private buffers = new Map<ServerId, Incident[]>();
  private monotonicTs = Date.now();

  constructor(private readonly broadcaster: IBroadcaster) {}

  /**
   * 单调递增时间戳——同毫秒内多次 record 时保证后写者 timestamp 严格大于先写者，
   * 排序时无须 fallback 到插入序。
   */
  private nextTimestamp(): number {
    const now = Date.now();
    if (now > this.monotonicTs) {
      this.monotonicTs = now;
    } else {
      this.monotonicTs += 1;
    }
    return this.monotonicTs;
  }

  record(
    serverId: ServerId,
    type: IncidentType,
    severity: IncidentSeverity,
    message: string,
    details?: IncidentDetails,
  ): Incident {
    const incident: Incident = {
      id: randomUUID(),
      serverId,
      type,
      severity,
      message,
      timestamp: this.nextTimestamp(),
      details,
    };

    // 写入环形缓冲
    let buffer = this.buffers.get(serverId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(serverId, buffer);
    }
    buffer.push(incident);
    if (buffer.length > MAX_BUFFER) {
      buffer.shift();
    }

    // 广播
    try {
      this.broadcaster.broadcast({
        type: "incident_created",
        serverId,
        incident,
      });
    } catch {
      /* 广播失败不影响主流程 */
    }

    return incident;
  }

  getIncidents(serverId: ServerId, limit?: number): IncidentsResponse {
    const buffer = this.buffers.get(serverId) ?? [];
    const take = Math.min(
      Math.max(limit ?? DEFAULT_LIMIT, 1),
      MAX_BUFFER,
    );
    const sorted = [...buffer].sort((a, b) => b.timestamp - a.timestamp);
    return {
      serverId,
      total: sorted.length,
      incidents: sorted.slice(0, take),
    };
  }
}
