import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Plus, Server as ServerIcon } from "lucide-react";
import { useServer } from "../../hooks/useServer.js";
import { useCurrentServer } from "../../contexts/CurrentServerContext.js";

/**
 * 服务器选择器（sc:design 第 5 阶段）。
 *
 * 行为要点：
 *   - 从共享层读取当前选中实例 + 实例列表
 *   - 点击触发器展开下拉面板，列出所有实例
 *   - 点击实例 → 写入共享层 + 关闭面板
 *   - 点击面板底部"新建实例"链接 → 跳到服务器设置页
 *   - 点击面板外部或按 ESC 关闭
 *
 * 无 props——所有数据来自上游上下文钩子。
 */
export function ServerSelector() {
  const { servers } = useServer();
  const { currentServerId, setCurrentServerId } = useCurrentServer();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当前显示的实例名——已选就展示该实例名；未选就展示"未选择实例"
  const currentServer = servers.find((s) => s.id === currentServerId);
  const displayName = currentServer?.name ?? currentServerId ?? "未选择实例";
  const isReady = currentServer !== undefined;

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return;
    /**
     * @param e - 全局点击事件
     */
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    /**
     * @param e - 键盘事件
     */
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative px-6 mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="切换服务器"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 text-xs font-normal hover:opacity-80 transition-opacity w-full text-left"
        style={{ color: "#94A3B8" }}
      >
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
        <span className="flex items-center gap-1.5 truncate flex-1">
          <ServerIcon size={12} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{displayName}</span>
          {isReady && (
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: "#22C55E" }}
              aria-hidden="true"
            />
          )}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-6 right-6 mt-1 rounded shadow-lg z-50"
          style={{
            backgroundColor: "#0F172A",
            border: "1px solid #334059",
          }}
          role="menu"
          aria-label="实例列表"
        >
          <div className="py-1 max-h-72 overflow-auto">
            {servers.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-xs"
                style={{ color: "#94A3B8" }}
              >
                还没有服务器实例
              </div>
            ) : (
              servers.map((s) => {
                const selected = s.id === currentServerId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      setCurrentServerId(s.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:opacity-90 transition-opacity"
                    style={{
                      backgroundColor: selected
                        ? "#22C55E20"
                        : "transparent",
                      color: selected ? "#22C55E" : "#F1F5FB",
                    }}
                  >
                    <span className="truncate flex-1">
                      {s.name || s.id}
                    </span>
                    {selected && (
                      <span
                        className="text-xs shrink-0"
                        style={{ color: "#22C55E" }}
                      >
                        当前
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t" style={{ borderColor: "#334059" }}>
            <Link
              to="/server-setup"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs hover:opacity-90"
              style={{ color: "#22C55E" }}
            >
              <Plus size={12} aria-hidden="true" />
              新建实例
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
