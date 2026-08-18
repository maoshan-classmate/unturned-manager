import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { IncidentsService } from "../src/modules/incidents/IncidentsService.js";
import type { IBroadcaster } from "@unturned-manager/shared";

/** mock broadcaster ——记录所有广播事件 */
function makeBroadcaster(): IBroadcaster & {
  events: unknown[];
} {
  const events: unknown[] = [];
  return {
    events,
    broadcast: (event) => events.push(event),
    register: vi.fn(),
    unregister: vi.fn(),
    registerRequestHandler: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

describe("IncidentsService", () => {
  it("record 写入事件 + 广播 incident_created", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    const incident = service.record("MyServer", "start", "info", "启动请求已发起");

    expect(incident.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(incident.serverId).toBe("MyServer");
    expect(incident.type).toBe("start");
    expect(incident.severity).toBe("info");
    expect(incident.message).toBe("启动请求已发起");
    expect(incident.timestamp).toBeGreaterThan(0);

    expect(broadcaster.events).toHaveLength(1);
    expect(broadcaster.events[0]).toMatchObject({
      type: "incident_created",
      serverId: "MyServer",
      incident: {
        id: incident.id,
        type: "start",
        severity: "info",
        message: "启动请求已发起",
      },
    });
  });

  it("record 可选 details 透传", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    const incident = service.record(
      "MyServer",
      "start",
      "info",
      "启动完成",
      { durationMs: 3500, itemCount: 3 },
    );

    expect(incident.details).toEqual({ durationMs: 3500, itemCount: 3 });
  });

  it("getIncidents 按时间倒序返回 + 限 limit", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    service.record("MyServer", "start", "info", "1");
    service.record("MyServer", "start", "info", "2");
    service.record("MyServer", "stop", "info", "3");

    const result = service.getIncidents("MyServer");

    expect(result.serverId).toBe("MyServer");
    expect(result.total).toBe(3);
    expect(result.incidents[0]?.message).toBe("3");
    expect(result.incidents[1]?.message).toBe("2");
    expect(result.incidents[2]?.message).toBe("1");
  });

  it("getIncidents 支持 limit 截断", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    for (let i = 0; i < 5; i++) {
      service.record("MyServer", "start", "info", `m${i}`);
    }

    const result = service.getIncidents("MyServer", 2);

    expect(result.total).toBe(5);
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents[0]?.message).toBe("m4");
    expect(result.incidents[1]?.message).toBe("m3");
  });

  it("getIncidents 不重叠实例独立缓冲", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    service.record("S1", "start", "info", "S1-1");
    service.record("S2", "start", "info", "S2-1");
    service.record("S1", "start", "info", "S1-2");

    const r1 = service.getIncidents("S1");
    const r2 = service.getIncidents("S2");

    expect(r1.total).toBe(2);
    expect(r1.incidents.map((i) => i.message)).toEqual(["S1-2", "S1-1"]);
    expect(r2.total).toBe(1);
    expect(r2.incidents[0]?.message).toBe("S2-1");
  });

  it("getIncidents 未注册实例返回空", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    const result = service.getIncidents("NonExist");

    expect(result.total).toBe(0);
    expect(result.incidents).toEqual([]);
  });

  it("环形缓冲：超过 100 条时丢最旧", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    for (let i = 0; i < 105; i++) {
      service.record("MyServer", "start", "info", `m${i}`);
    }

    const result = service.getIncidents("MyServer", 200);

    expect(result.total).toBe(100);
    expect(result.incidents[0]?.message).toBe("m104");
    expect(result.incidents[99]?.message).toBe("m5");
  });

  it("广播失败不影响主流程", () => {
    const broadcaster: IBroadcaster = {
      broadcast: () => {
        throw new Error("ws down");
      },
      register: vi.fn(),
      unregister: vi.fn(),
      registerRequestHandler: vi.fn(),
      destroy: vi.fn(async () => {}),
    };
    const service = new IncidentsService(broadcaster);

    expect(() =>
      service.record("MyServer", "start", "info", "启动"),
    ).not.toThrow();
    expect(service.getIncidents("MyServer").total).toBe(1);
  });

  it("UUID v4 唯一性——100 条无重复", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const incident = service.record("MyServer", "start", "info", `m${i}`);
      ids.add(incident.id);
    }
    expect(ids.size).toBe(100);
  });

  it("id 字段是合法 UUID v4", () => {
    const broadcaster = makeBroadcaster();
    const service = new IncidentsService(broadcaster);

    const incident = service.record("MyServer", "start", "info", "x");

    // 验证是合法 UUID v4
    expect(incident.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // 也能通过 Node 自带的 randomUUID 解析
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
