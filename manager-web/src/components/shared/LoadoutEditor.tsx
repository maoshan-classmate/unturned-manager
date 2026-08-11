import { useState } from 'react';
import { Plus, Trash2, X, PackageOpen, Shield } from 'lucide-react';
import { ConfigSection } from './ConfigSection.js';
import { ConfirmDialog } from './ConfirmDialog.js';

/**
 * 单条 Loadout 配置——开局携带的物品 ID 列表（CommandLoadout.cs:13-49 / PlayerSkills.cs:43-97）。
 * 权威约束：SkillsetID ∈ {0,1,2,3,4,5,6,7,8,9,10,255}（255 = 默认全部技能组），
 *           ItemID ∈ [0, 65535] ushort。
 */
export interface LoadoutEntry {
  /** 0–10 = 11 个技能组，255 = 默认全部技能组 */
  skillsetId: number;
  /** 该技能组开局携带的物品 ID 列表；空数组表示该技能组无物品加成 */
  itemIds: number[];
}

/** 11 个技能组中文映射（PlayerSkills.cs:43-97 权威枚举，ID 顺序对齐） */
export const SKILLSET_NAMES: Record<number, string> = {
  0: '无技能',
  1: '消防员',
  2: '警察',
  3: '军人',
  4: '农民',
  5: '渔夫',
  6: '露营者',
  7: '工匠',
  8: '厨师',
  9: '盗贼',
  10: '医生',
  255: '默认（所有技能组）',
};

/** 按技能组 ID 升序排列——保证展示稳定 */
const SKILLSET_OPTIONS = Object.keys(SKILLSET_NAMES)
  .map(Number)
  .sort((a, b) => a - b);

interface LoadoutEditorProps {
  /** 当前 Loadout 列表（按面板添加顺序） */
  loadouts: LoadoutEntry[];
  /** Loadout 变更回调（新增 / 删除 / 修改 itemIds） */
  onChange: (loadouts: LoadoutEntry[]) => void;
}

/**
 * Loadout 结构化编辑器——Figma ConfigPage Tab「开局物品」区块。
 * 用户视角：选技能组 → 输入物品 ID → 添加。条目按添加顺序展示，支持删除。
 * 内部数据：LoadoutEntry[]（每 SkillsetID 一条；U3DS 同 ID 多行后写覆盖前写，
 *           故面板策略：每个 SkillsetID 只保留最新一行）。
 *
 * @param props - 组件属性
 * @returns Loadout 编辑器 React 元素
 *
 * @example
 * ```tsx
 * <LoadoutEditor
 *   loadouts={fields.Loadout}
 *   onChange={(next) => setFields((f) => ({ ...f, Loadout: next }))}
 * />
 * ```
 */
export function LoadoutEditor({ loadouts, onChange }: LoadoutEditorProps) {
  const [newSkillsetId, setNewSkillsetId] = useState<number>(255);
  const [newItemIdsText, setNewItemIdsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  /** 已使用的 SkillsetID——下拉只显示未使用的，避免重行 */
  const usedSkillsetIds = new Set(loadouts.map((l) => l.skillsetId));
  const availableSkillsetIds = SKILLSET_OPTIONS.filter((id) => !usedSkillsetIds.has(id));

  /** 解析用户输入的物品 ID 字符串——支持空格 / 逗号 / 斜杠分隔 */
  const parseItemIds = (raw: string): number[] | null => {
    const tokens = raw
      .split(/[\s,/]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return null;
    const ids: number[] = [];
    for (const t of tokens) {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0 || n > 65535) return null;
      ids.push(n);
    }
    return ids;
  };

  /** 添加新条目——校验后写入 loadouts 数组末尾（保留添加顺序） */
  const handleAdd = () => {
    setError(null);
    if (availableSkillsetIds.length === 0) {
      setError('已为所有技能组配置开局物品');
      return;
    }
    const itemIds = parseItemIds(newItemIdsText);
    if (itemIds === null) {
      setError('物品 ID 必须是非负整数（0–65535），多个用空格 / 逗号 / 斜杠分隔');
      return;
    }
    onChange([...loadouts, { skillsetId: newSkillsetId, itemIds }]);
    setNewItemIdsText('');
    // 下次添加默认选中下一个可用 SkillsetID
    const nextAvailable = SKILLSET_OPTIONS.filter(
      (id) => id !== newSkillsetId && !usedSkillsetIds.has(id) && id !== newSkillsetId,
    );
    setNewSkillsetId(nextAvailable[0] ?? newSkillsetId);
  };

  /** 删除确认后从数组移除——按 index 而非 ID（保留顺序） */
  const handleDelete = (index: number) => {
    setDeleteTarget(index);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget === null) return;
    onChange(loadouts.filter((_, i) => i !== deleteTarget));
    setDeleteTarget(null);
  };

  return (
    <ConfigSection title="开局物品（Loadout）">
      <p className="text-[11px] text-slate-500">
        配置玩家进入服务器时的默认背包物品。不填则没有任何额外物品（SDK 默认 `LOADOUT = {}`，PlayerInventory.cs:30）。
      </p>

      {/* 现有条目列表 */}
      {loadouts.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-4 rounded border border-dashed border-slate-700 text-slate-500">
          <PackageOpen size={14} />
          <span className="text-xs">暂无配置——下方添加一个技能组的开局物品</span>
        </div>
      ) : (
        <div className="space-y-2">
          {loadouts.map((entry, index) => (
            <div
              key={`${entry.skillsetId}-${index}`}
              className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-700"
            >
              <Shield size={14} className="text-blue-500 shrink-0" />
              <span className="text-xs font-medium shrink-0 text-slate-100">
                {SKILLSET_NAMES[entry.skillsetId] ?? `#${entry.skillsetId}`}
              </span>
              <span className="text-xs shrink-0 text-slate-500">
                ID {entry.skillsetId}
              </span>
              <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                {entry.itemIds.map((id, i) => (
                  <span
                    key={`${id}-${i}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-400"
                  >
                    {id}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(index)}
                className="shrink-0 p-1 rounded hover:bg-red-500/20"
                aria-label={`删除 ${SKILLSET_NAMES[entry.skillsetId] ?? entry.skillsetId}`}
              >
                <Trash2 size={12} className="text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 添加新条目表单 */}
      {availableSkillsetIds.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-700">
          <div className="flex items-center gap-2">
            <label className="text-xs shrink-0 text-slate-400">
              技能组
            </label>
            <select
              value={newSkillsetId}
              onChange={(e) => setNewSkillsetId(Number(e.target.value))}
              className="flex-1 h-8 rounded text-xs px-2 bg-slate-950 border border-slate-700 text-slate-100"
            >
              {availableSkillsetIds.map((id) => (
                <option key={id} value={id}>
                  {SKILLSET_NAMES[id]}（ID {id}）
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs shrink-0 text-slate-400">
              物品 ID
            </label>
            <input
              type="text"
              value={newItemIdsText}
              onChange={(e) => setNewItemIdsText(e.target.value)}
              placeholder="例如 5 18 100 / 255（空格/逗号/斜杠分隔）"
              className="flex-1 h-8 rounded text-xs px-2 font-mono bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>
          {error && (
            <p className="text-[11px] text-red-500" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newItemIdsText.trim()}
              className="flex items-center gap-1 px-3 h-7 rounded text-xs text-white bg-emerald-500 disabled:opacity-40"
            >
              <Plus size={12} />
              添加
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除开局物品"
        message="将移除该技能组的开局物品配置。确认继续？"
        confirmLabel="删除"
        variant="danger"
        icon={X}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ConfigSection>
  );
}