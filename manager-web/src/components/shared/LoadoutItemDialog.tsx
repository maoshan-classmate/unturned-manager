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

/** 下拉分页：初始/每滚动一批加载条数 */
const PAGE_SIZE = 10;

/**
 * 单个技能组的开局物品选择 dialog。
 * 交互：搜索/手输选物品 → 回车/点击成标签 → 多标签 → 保存/取消。
 * 输入框同时支持：① 搜索内置+自定义清单（ID 或名称子串，显示中文 label）；
 * ② 直接输合法整数 ID（Mod 物品，清单外 → 标签显示「未知物品」）。
 * 下拉是**分页列表**——滚动到底自动加载下 10 条，不再一次性铺满。
 * 重复 ID 忽略，Backspace 删末标签。
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
  /** 下拉已加载条数（分页：滚动到底 +10） */
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 打开时重置工作副本（不污染已保存状态）
  useEffect(() => {
    if (open) {
      setTags(initialItemIds);
      setInputValue("");
      setActiveIndex(0);
      setVisibleCount(PAGE_SIZE);
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
      (i) =>
        i.id.toString().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.label ?? "").toLowerCase().includes(q),
    );
  }, [inputValue, items]);

  /** 当前已加载的子集（分页切片） */
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  // 键盘高亮项滚动进可视区（分页列表可能超出视口）；jsdom 无 scrollIntoView → 可选链保护
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  /**
   * 提交一个物品 ID 为标签——允许重复（U3DS `Loadout 0/1100/1100/1100` 合法；
   * 后端 schema/序列化天然支持；重复时标签旁显示「×N」徽章）。
   * @param id - 物品 ID
   * @param keepView - true = 点击添加：保持当前过滤/高亮/滚动，不跳回顶部（多选连续点）；
   *   false = 键盘回车提交：清空输入框重新开始
   */
  const addTag = (id: number, keepView = false) => {
    setTags((prev) => [...prev, id]);
    if (!keepView) {
      setInputValue("");
      setActiveIndex(0);
      setVisibleCount(PAGE_SIZE);
    }
    inputRef.current?.focus();
  };

  /** 回车提交：优先高亮的下拉项（需有输入或手动导航过）；否则合法整数 → 提交裸 ID（Mod 物品） */
  const commit = () => {
    const navigated = inputValue.trim() !== "" || activeIndex > 0;
    if (navigated && visible.length > 0) {
      const option = visible[activeIndex % visible.length];
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

  /** 列表滚动到底 → 加载下 PAGE_SIZE 条 */
  const handleListScroll = (e: React.UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
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
      const next = activeIndex + 1;
      // 到达当前已加载末尾且还有更多 → 先扩一页，让高亮能继续前进
      if (visible.length > 0 && next >= visible.length && hasMore) {
        setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
      }
      setActiveIndex(next);
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
    <Dialog open={open} onClose={onCancel} width={640}>
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
            (() => {
              // 按 id 统计出现次数（保持原顺序）——首个出现位置显示完整标签 + 数量徽章
              const counts = new Map<number, number>();
              for (const id of tags) {
                counts.set(id, (counts.get(id) ?? 0) + 1);
              }
              const seen = new Set<number>();
              return tags.map((id, idx) => {
                if (seen.has(id)) return null;
                seen.add(id);
                const count = counts.get(id) ?? 1;
                return (
                  <span
                    key={`${id}-${idx}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-slate-800 text-slate-200"
                  >
                    <span>{id}</span>
                    <span className="text-slate-400">{resolveName(id)}</span>
                    {count > 1 && (
                      <span
                        data-testid="loadout-count-badge"
                        className="px-1 rounded bg-emerald-500/20 text-emerald-400 font-sans"
                      >
                        ×{count}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        // 移除该 id 的所有出现
                        const removedId = id;
                        setTags((prev) => prev.filter((x) => x !== removedId));
                      }}
                      className="text-slate-400 hover:text-red-500"
                      aria-label={`移除物品 ${id}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              });
            })()
          )}
        </div>

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setActiveIndex(0);
            setVisibleCount(PAGE_SIZE);
          }}
          onKeyDown={handleKeyDown}
          placeholder="搜索物品 ID 或名称，或直接输入物品 ID（支持 Mod 物品）"
          className="mt-2 w-full h-9 rounded text-xs px-3 font-mono bg-slate-950 border border-slate-700 text-slate-100"
        />

        {/* 分页下拉列表——常驻块（不 absolute，避免被覆盖），滚动到底加载更多 */}
        {filtered.length > 0 && (
          <ul
            ref={listRef}
            onScroll={handleListScroll}
            className="mt-2 w-full max-h-64 overflow-y-auto rounded border border-slate-700 bg-slate-900"
          >
            {visible.map((item, idx) => {
              const active = idx === activeIndex % visible.length;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addTag(item.id, true)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    data-active={active}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                      active
                        ? "bg-slate-700 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-mono text-slate-400 shrink-0">
                      {item.id}
                    </span>
                    <span>{item.label ?? item.name}</span>
                    {item.label && item.label !== item.name && (
                      <span className="text-slate-500 text-xs truncate">
                        {item.name}
                      </span>
                    )}
                    {item.source === "builtin" && (
                      <span className="ml-auto text-xs text-slate-500 shrink-0">
                        内置
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {hasMore && (
              <li className="px-3 py-1.5 text-xs text-center text-slate-500">
                已显示 {visible.length} / {filtered.length} 条——继续向下滚动加载
              </li>
            )}
          </ul>
        )}

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
            onClick={() => onSave(Array.from(new Set(tags)))}
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
