import { useEffect, useRef } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { Button } from "../ui/button.js";
import { useSteamCmdJobLog } from "@/hooks/useSteamCmdJobLog";

/**
 * 阶段标识 → 中文说明。
 * 阶段标识是后端内部约定，界面上要显示普通用户看得懂的话。
 */
const STAGE_LABELS: Record<string, string> = {
  spawned: "正在启动",
  downloading: "正在下载",
  validating: "正在校验",
  installed: "安装完成",
  checking: "正在检查",
  updating: "正在更新",
  update_complete: "更新完成",
  preallocating: "正在准备空间",
  deprecated: "版本已过期",
  extracting: "正在解压",
  initializing: "正在初始化",
  queued: "排队中",
  completed: "已完成",
  failed: "失败",
};

/** 任务输出面板属性 */
interface TaskLogPanelProps {
  /** 要监听的任务标识列表（如 `steamcmd-install-/opt/unturned`） */
  jobIds: string[];
  /** 面板标题 */
  title?: string;
  /** 没有输出时显示的提示语 */
  emptyHint?: string;
}

/**
 * 任务输出面板——把安装 / 更新 / 重装的实时过程显示成命令行。
 *
 * 面板内容来自服务端推送的每一行输出：点「安装」或「重装」后，
 * 用户能直接看到正在做什么、卡在哪一步、成功没有。
 *
 * @param props - 组件属性
 * @param props.jobIds - 要监听的任务标识列表
 * @param props.title - 面板标题，默认「任务输出」
 * @param props.emptyHint - 没有输出时的提示语
 * @returns 任务输出面板 React 元素
 *
 * @example
 * ```tsx
 * <TaskLogPanel jobIds={[`steamcmd-install-${installPath}`]} />
 * ```
 */
export function TaskLogPanel({
  jobIds,
  title = "任务输出",
  emptyHint = "点击上方按钮后，这里会实时显示执行过程",
}: TaskLogPanelProps) {
  const { lines, stage, percent, finished, errorMessage, clear } =
    useSteamCmdJobLog(jobIds);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新输出到达时滚到底部——用户不用手动拉
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const failed = stage === "failed";
  const stageText = stage
    ? (STAGE_LABELS[stage] ?? stage)
    : lines.length > 0
      ? "有输出"
      : "空闲";

  return (
    <div className="mt-4 rounded-md border border-slate-700 bg-slate-900 overflow-hidden">
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-700 bg-slate-800/60">
        <Terminal size={12} className="text-emerald-500 shrink-0" />
        <span className="text-xs font-medium text-slate-300">{title}</span>
        <span
          className={`text-xs ${
            failed
              ? "text-red-400"
              : finished
                ? "text-emerald-400"
                : "text-slate-400"
          }`}
        >
          {stageText}
        </span>
        {percent != null && !finished && (
          <span className="text-xs text-slate-500">{percent}%</span>
        )}
        {lines.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={clear}
            className="ml-auto h-6 w-6 text-slate-500 hover:text-slate-300"
            aria-label="清空输出"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>

      {/* 输出区 */}
      <div
        ref={scrollRef}
        className="h-40 overflow-y-auto px-2 py-1.5 font-mono text-xs leading-relaxed"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <p className="text-slate-600">{emptyHint}</p>
        ) : (
          lines.map((line, index) => (
            <p
              key={`${index}-${line}`}
              className={`whitespace-pre-wrap break-all ${
                /^ERROR!/i.test(line) || /失败/.test(line)
                  ? "text-red-400"
                  : "text-slate-300"
              }`}
            >
              {line}
            </p>
          ))
        )}
        {failed && errorMessage && (
          <p className="mt-1 whitespace-pre-wrap break-all text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
