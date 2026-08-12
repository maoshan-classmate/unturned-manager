import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  detectStartScript,
  ensureStartScriptExecutable,
  startScriptNames,
  normalizeStartCommand,
} from "../src/modules/server/startScript.js";

// chmod 用 exec——mock 掉避免真执行（且不依赖平台 chmod）
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    exec: vi.fn(
      (
        cmd: string,
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb?.(null, "", "");
        return {} as never;
      },
    ),
  };
});
import { exec } from "child_process";

describe("startScriptNames — 平台优先级（T6 抄 GSM detectStartScript 4 项）", () => {
  it("linux: ServerHelper.sh 优先于 ExampleServer.sh", () => {
    expect(startScriptNames("linux")).toEqual([
      "ServerHelper.sh",
      "ExampleServer.sh",
    ]);
  });

  it("win32: 空数组（U3DS 是 Linux 专用服务端）", () => {
    expect(startScriptNames("win32")).toEqual([]);
  });
});

describe("detectStartScript — fixture 目录", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "startscript-"));
  });

  it("linux: 高优先级 ServerHelper.sh 命中", async () => {
    await fs.writeFile(path.join(dir, "ServerHelper.sh"), "#!/bin/bash\n");
    await fs.writeFile(path.join(dir, "ExampleServer.sh"), "#!/bin/bash\n");
    expect(await detectStartScript(dir, "linux")).toBe("ServerHelper.sh");
  });

  it("linux: 仅 ExampleServer.sh → 回落单服脚本", async () => {
    await fs.writeFile(path.join(dir, "ExampleServer.sh"), "#!/bin/bash\n");
    expect(await detectStartScript(dir, "linux")).toBe("ExampleServer.sh");
  });

  it("linux: 无启动脚本 → null", async () => {
    await fs.writeFile(path.join(dir, "random.txt"), "x");
    expect(await detectStartScript(dir, "linux")).toBeNull();
  });

  it("win32: 即使目录有 .sh 也不命中 → null", async () => {
    await fs.writeFile(path.join(dir, "ServerHelper.sh"), "#!/bin/bash\n");
    expect(await detectStartScript(dir, "win32")).toBeNull();
  });

  it("目录不存在 → null（不抛错）", async () => {
    expect(await detectStartScript(path.join(dir, "nope"), "linux")).toBeNull();
  });
});

describe("normalizeStartCommand — +InternetServer 必须末位（BUG-1，CommandLine.cs:203-216）", () => {
  it("尾随参数移到 server 参数之前", () => {
    const r = normalizeStartCommand(
      "./ServerHelper.sh +InternetServer/MyServer -ThreadedConsole",
    );
    expect(r).toEqual({
      command: "./ServerHelper.sh -ThreadedConsole +InternetServer/MyServer",
      changed: true,
    });
  });

  it("server 参数已在末位 → 不变", () => {
    expect(
      normalizeStartCommand("./ServerHelper.sh +InternetServer/MyServer"),
    ).toEqual({
      command: "./ServerHelper.sh +InternetServer/MyServer",
      changed: false,
    });
    expect(
      normalizeStartCommand(
        "./ServerHelper.sh -ThreadedConsole +InternetServer/MyServer",
      ),
    ).toEqual({
      command: "./ServerHelper.sh -ThreadedConsole +InternetServer/MyServer",
      changed: false,
    });
  });

  it("多个尾随参数整体前置", () => {
    const r = normalizeStartCommand(
      "./ServerHelper.sh +InternetServer/MyServer -nographics -batchmode",
    );
    expect(r).toEqual({
      command:
        "./ServerHelper.sh -nographics -batchmode +InternetServer/MyServer",
      changed: true,
    });
  });

  it("LANServer 同样归一化（tryGetServer 支持 4 种前缀）", () => {
    const r = normalizeStartCommand(
      "./ServerHelper.sh +LANServer/Hawaii -ThreadedConsole",
    );
    expect(r).toEqual({
      command: "./ServerHelper.sh -ThreadedConsole +LANServer/Hawaii",
      changed: true,
    });
  });

  it("server 参数前有自定义参数时保持前序", () => {
    const r = normalizeStartCommand(
      "./ServerHelper.sh -a +InternetServer/X -b",
    );
    expect(r).toEqual({
      command: "./ServerHelper.sh -a -b +InternetServer/X",
      changed: true,
    });
  });

  it("无 server 参数 / 空字符串 → 不变", () => {
    expect(normalizeStartCommand("./foo.sh -x")).toEqual({
      command: "./foo.sh -x",
      changed: false,
    });
    expect(normalizeStartCommand("")).toEqual({ command: "", changed: false });
    expect(normalizeStartCommand("   ")).toEqual({
      command: "   ",
      changed: false,
    });
  });
});

describe("ensureStartScriptExecutable — chmod +x", () => {
  beforeEach(() => {
    vi.mocked(exec).mockClear(); // 避免 exec mock 调用跨用例残留
  });

  it("linux: 调用 chmod +x 完整路径", async () => {
    await ensureStartScriptExecutable(
      "/opt/unturned",
      "ServerHelper.sh",
      "linux",
    );
    expect(exec).toHaveBeenCalledWith(
      'chmod +x "/opt/unturned/ServerHelper.sh"',
      expect.anything(),
    );
  });

  it("win32: 跳过（不调 chmod）", async () => {
    await ensureStartScriptExecutable("/x", "ServerHelper.sh", "win32");
    expect(exec).not.toHaveBeenCalled();
  });
});
