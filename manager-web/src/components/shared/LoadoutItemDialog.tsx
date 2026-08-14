import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog.js";
import { Plus, X } from "lucide-react";
import type { ItemRecord } from "@unturned-manager/shared";

/** 标签区 + 搜索/手输的物品选择 dialog 属性 */
interface LoadoutItemDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 目标技能组 ID（0–10 或 255） */
  skillsetId: number;
  /** 技能组显示名（LoadoutEditor 传入，避免循环引用） */
  skillsetName: string;
  /** 已有物品 ID 列表（打开时预填为标签） */
  initialItemIds: number[];
  /** 物品清单（内置 + 自定义）——名称解析 + 下拉数据源 */
  items: ItemRecord[];
  /** 保存：回传最终物品 ID 列表 */
  onSave: (itemIds: number[]) => void;
  /** 取消：丢弃本次编辑 */
  onCancel: () => void;
}

/** 下拉最多展示条数（超出滚动） */
const DROPDOWN_LIMIT = 8;

/**
 * 单个技能组的开局物品选择 dialog。
 * 交互：搜索/手输选物品 → 回车/点击成标签 → 多标签 → 保存/取消。
 * 输入框同时支持：① 搜索内置+自定义清单（ID 或名称子串）；② 直接输合法整数
 * ID（Mod 物品，清单外 → 标签显示「未知物品」）。重复 ID 忽略，Backspace 删末标签。
 *
 * @param props - 组件属性
 * @param props.open - 是否打开
 * @param props.skillsetId - 目标技能组 ID
 * @param props.skillsetName - 技能组显示名
 * @param props.initialItemIds - 已有物品 ID（预填标签）
 * @param props.items - 物品清单
 * @param props.onSave - 保存回调，回传最终物品 ID 列表
 * @param props.onCancel - 取消回调
 * @returns 物品选择 dialog React 元素；未打开时返回 null
 *
 * @example
 * ```tsx
 * <LoadoutItemDialog
 *   open={picker !== null}
 *   skillsetId={picker?.skillsetId ?? 255}
 *   skillsetName={SKILLSET_NAMES[picker?.skillsetId ?? 255]}
 *   initialItemIds={picker?.itemIds ?? []}
 *   items={items}
 *   onSave={handleSave}
 *   onCancel={() => setPicker(null)}
 * />
 * ```
 */
export function LoadoutItemDialog({
  open,
  skillsetId,
  skillsetName,
  initialItemIds,
  items,
  onSave,
  onCancel,
}: LoadoutItemDialogProps) {
  const [tags, setTags] = useState<number[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时重置工作副本（不污染已保存状态）
  useEffect(() => {
    if (open) {
      setTags(initialItemIds);
      setInputValue("");
      setActiveIndex(0);
    }
  }, [open, initialItemIds]);

  // 打开后聚焦输入框
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const itemsMap = useMemo(
    // 显示优先用中文 label，未配则回落英文 name（M4b）
    () => new Map(items.map((i) => [i.id, i.label ?? i.name])),
    [items],
  );

  /** 名称反查——清单外 ID 显示「未知物品」（Mod 物品 D6） */
  const resolveName = (id: number): string => itemsMap.get(id) ?? "未知物品";

  /** 过滤清单：输入为空展示全部（可浏览），否则按 ID/名称子串过滤 */
  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.id.toString().includes(q) || i.name.toLowerCase().includes(q),
    );
  }, [inputValue, items]);

  /** 提交一个物品 ID 为标签（重复忽略） */
  const addTag = (id: number) => {
    setTags((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setInputValue("");
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  /** 回车提交：优先高亮的下拉项；无匹配且输入为合法整数 → 提交裸 ID（Mod 物品） */
  const commit = () => {
    if (filtered.length > 0) {
      const option = filtered[activeIndex % filtered.length];
      if (option) {
        addTag(option.id);
        return;
      }
    }
    const trimmed = inputValue.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n >= 0 && n <= 65535) {
        addTag(n);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => i + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Backspace" && inputValue === "") {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} width={520}>
      <div className="p-4">
        <Dialog.Title>开局物品：{skillsetName}</Dialog.Title>

        {/* 标签区 */}
        <div
          data-testid="loadout-tags"
          className="flex flex-wrap items-center gap-1.5 min-h-9 p-2 rounded bg-slate-950 border border-slate-700"
        >
          {tags.length === 0 ? (
            <span className="text-xs text-slate-500">
              暂无物品——在下框搜索或输入物品 ID 添加
            </span>
          ) : (
            tags.map((id, idx) => (
              <span
                key={`${id}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-200"
              >
                <span>{id}</span>
                <span className="text-slate-400">{resolveName(id)}</span>
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-slate-400 hover:text-red-500"
                  aria-label={`移除物品 ${id}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))
          )}
        </div>

        {/* 输入 + 下拉 */}
        <div className="mt-2 relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索物品 ID 或名称，或直接输入物品 ID（支持 Mod 物品）"
            className="w-full h-9 rounded text-xs px-3 font-mono bg-slate-950 border border-slate-700 text-slate-100"
          />
          {filtered.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-lg">
              {filtered.slice(0, DROPDOWN_LIMIT).map((item, idx) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addTag(item.id)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                      idx === activeIndex % filtered.length
                        ? "bg-slate-700 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-mono text-slate-400">{item.id}</span>
                    <span>{item.name}</span>
                    {item.source === "builtin" && (
                      <span className="ml-auto text-[10px] text-slate-500">内置</span>
                    )}
                  </button>
                </li>
              ))}
              {filtered.length > DROPDOWN_LIMIT && (
                <li className="px-3 py-1 text-[10px] text-slate-500">
                  还有 {filtered.length - DROPDOWN_LIMIT} 条，继续输入过滤
                </li>
              )}
            </ul>
          )}
        </div>

        <Dialog.Footer>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 h-7 rounded text-xs text-slate-300 hover:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(tags)}
            className="flex items-center gap-1 px-3 h-7 rounded text-xs text-white bg-emerald-500 hover:bg-emerald-600"
          >
            <Plus size={12} />
            保存
          </button>
        </Dialog.Footer>
      </div>
    </Dialog>
  );
}
