import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  X,
  PackageOpen,
  Shield,
  Pencil,
  Settings2,
} from "lucide-react";
import { ConfigSection } from "./ConfigSection.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { LoadoutItemDialog } from "./LoadoutItemDialog.js";
import { ItemListDialog } from "./ItemListDialog.js";
import { useItems } from "../../hooks/useItems.js";

/**
 * 单条 Loadout 配置——开局携带的物品 ID 列表（CommandLoadout.cs:13-49 / PlayerSkills.cs:43-97）。
 * 权威约束：SkillsetID ∈ {0,1,2,3,4,5,6,7,8,9,10,255}（255 = 所有技能组），
 *           ItemID ∈ [0, 65535] ushort。
 */
export interface LoadoutEntry {
  /** 0–10 = 11 个技能组，255 = 所有技能组（对所有人生效） */
  skillsetId: number;
  /** 该技能组开局携带的物品 ID 列表；空数组表示该技能组无物品加成 */
  itemIds: number[];
}

/** 11 个技能组中文映射 + 255（PlayerSkills.cs:43-97 权威枚举，ID 顺序对齐；255 见 wiki「All Skillsets」） */
export const SKILLSET_NAMES: Record<number, string> = {
  0: "无技能",
  1: "消防员",
  2: "警察",
  3: "军人",
  4: "农民",
  5: "渔夫",
  6: "露营者",
  7: "工匠",
  8: "厨师",
  9: "盗贼",
  10: "医生",
  255: "所有技能组",
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

/** 物品选择 dialog 打开状态 */
type PickerState = {
  /** 目标技能组 ID */
  skillsetId: number;
  /** 技能组显示名 */
  skillsetName: string;
  /** 已有物品 ID（编辑模式预填） */
  itemIds: number[];
} | null;

/** 删除确认目标（按 index 定位，保留顺序） */
type DeleteTarget = { index: number; skillsetId: number } | null;

/**
 * Loadout 结构化编辑器——Figma ConfigPage Tab「开局物品」区块。
 * 用户视角：条目列表（技能组 + 物品标签）→ 添加/编辑打开物品选择 dialog →
 * 选物品成标签；区块标题「管理物品清单」维护全局物品库。
 *
 * 内部数据：LoadoutEntry[]（每 SkillsetID 一条；U3DS 同 ID 多行后写覆盖前写，
 *           故面板策略：每个 SkillsetID 只保留最新一行）。
 * 255 互斥（D4）：已配置「所有技能组(255)」时，技能组 0-10 条目灰显不可编辑；
 *           已配置技能组时，255 不可再添加。技能组之间自由并存。
 *
 * @param props - 组件属性
 * @param props.loadouts - 当前 Loadout 列表
 * @param props.onChange - Loadout 变更回调
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
  const { items, reload } = useItems();
  const [addOpen, setAddOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  /** 物品 ID → 名称映射（清单内）——显示优先中文 label，回落英文 name（M4b） */
  const itemsMap = useMemo(
    () => new Map(items.map((i) => [i.id, i.label ?? i.name])),
    [items],
  );
  const resolveName = (id: number): string => itemsMap.get(id) ?? "未知物品";

  /** 255 互斥判定（D4）——SDK `bestowLoadout()` 基础层非空时跳过技能组分支 */
  const has255 = loadouts.some((l) => l.skillsetId === 255);
  const hasSkillset = loadouts.some((l) => l.skillsetId !== 255);

  /** 已使用的 SkillsetID */
  const usedSkillsetIds = useMemo(
    () => new Set(loadouts.map((l) => l.skillsetId)),
    [loadouts],
  );

  /** 可添加的技能组——互斥过滤：255 仅在未配技能组时可加；技能组仅在未配 255 时可加 */
  const addableSkillsets = useMemo(
    () =>
      SKILLSET_OPTIONS.filter((id) => {
        if (usedSkillsetIds.has(id)) return false;
        return id === 255 ? !hasSkillset : !has255;
      }),
    [usedSkillsetIds, hasSkillset, has255],
  );

  /** 默认选中 255（D1），不可用时取第一个可加技能组（D2：不再跳「无技能(0)」） */
  const defaultSkillset = addableSkillsets.includes(255)
    ? 255
    : addableSkillsets[0];

  /** 打开添加下拉选中的技能组的物品选择 dialog */
  const openPickerForAdd = (skillsetId: number) => {
    setPicker({
      skillsetId,
      skillsetName: SKILLSET_NAMES[skillsetId] ?? `#${skillsetId}`,
      itemIds: [],
    });
    setAddOpen(false);
  };

  /** 编辑已有条目的物品选择 dialog */
  const openPickerForEdit = (entry: LoadoutEntry) => {
    setPicker({
      skillsetId: entry.skillsetId,
      skillsetName: SKILLSET_NAMES[entry.skillsetId] ?? `#${entry.skillsetId}`,
      itemIds: entry.itemIds,
    });
  };

  /** 保存：已有条目 → 替换/清空移除；新条目 → 有物品才追加 */
  const handlePickerSave = (itemIds: number[]) => {
    if (!picker) return;
    const { skillsetId } = picker;
    const existing = loadouts.find((l) => l.skillsetId === skillsetId);
    if (existing) {
      onChange(
        itemIds.length === 0
          ? loadouts.filter((l) => l.skillsetId !== skillsetId)
          : loadouts.map((l) =>
              l.skillsetId === skillsetId ? { ...l, itemIds } : l,
            ),
      );
    } else if (itemIds.length > 0) {
      onChange([...loadouts, { skillsetId, itemIds }]);
    }
    setPicker(null);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget === null) return;
    onChange(loadouts.filter((_, i) => i !== deleteTarget.index));
    setDeleteTarget(null);
  };

  return (
    <ConfigSection
      title="开局物品（Loadout）"
      actions={
        <button
          type="button"
          onClick={() => setListDialogOpen(true)}
          className="flex items-center gap-1 px-2 h-6 rounded text-[11px] text-slate-300 hover:bg-slate-800"
          aria-label="管理物品清单"
        >
          <Settings2 size={11} />
          管理物品清单
        </button>
      }
    >
      <p className="text-[11px] text-slate-500">
        配置玩家进入服务器时的默认背包物品。不填则没有任何额外物品。
      </p>

      {/* 255 互斥提示 */}
      {has255 && (
        <p className="text-[11px] mt-1" style={{ color: "#F59E0B" }}>
          已配置「所有技能组」通用包——具体技能组条目会被覆盖，实际不生效，已禁用编辑
        </p>
      )}

      {/* 条目列表 */}
      {loadouts.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-4 rounded border border-dashed border-slate-700 text-slate-500">
          <PackageOpen size={14} />
          <span className="text-xs">暂无配置——下方添加一个技能组的开局物品</span>
        </div>
      ) : (
        <div className="space-y-2">
          {loadouts.map((entry, index) => {
            const disabled = has255 && entry.skillsetId !== 255;
            return (
              <div
                key={`${entry.skillsetId}-${index}`}
                className={`flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-700 ${
                  disabled ? "opacity-50" : ""
                }`}
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
                      <span>{id}</span>
                      <span>{resolveName(id)}</span>
                    </span>
                  ))}
                </div>
                {!disabled && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openPickerForEdit(entry)}
                      className="p-1 rounded hover:bg-slate-700"
                      aria-label={`编辑 ${SKILLSET_NAMES[entry.skillsetId] ?? entry.skillsetId}`}
                    >
                      <Pencil size={12} className="text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({ index, skillsetId: entry.skillsetId })
                      }
                      className="p-1 rounded hover:bg-red-500/20"
                      aria-label={`删除 ${SKILLSET_NAMES[entry.skillsetId] ?? entry.skillsetId}`}
                    >
                      <Trash2 size={12} className="text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 添加按钮 + 技能组下拉 */}
      {addableSkillsets.length > 0 && (
        <div className="relative pt-2 border-t border-slate-700">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-1 px-3 h-7 rounded text-xs text-white bg-emerald-500 hover:bg-emerald-600"
            >
              <Plus size={12} />
              添加开局物品
            </button>
          </div>
          {addOpen && (
            <>
              {/* 点击外部关闭 */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAddOpen(false)}
              />
              <ul className="absolute z-50 right-0 mt-1 w-44 rounded border border-slate-700 bg-slate-900 shadow-lg py-1">
                {addableSkillsets.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => openPickerForAdd(id)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                    >
                      <span>{SKILLSET_NAMES[id] ?? `#${id}`}</span>
                      <span className="font-mono text-slate-500">ID {id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {addableSkillsets.length === 0 && (
        <p className="text-[11px] mt-2 text-slate-500">
          {has255
            ? "已配置所有技能组的通用包，无法再添加具体技能组"
            : "已为所有技能组配置开局物品"}
        </p>
      )}

      {/* 物品选择 dialog（新增/编辑共用） */}
      <LoadoutItemDialog
        open={picker !== null}
        skillsetId={picker?.skillsetId ?? 255}
        skillsetName={picker?.skillsetName ?? ""}
        initialItemIds={picker?.itemIds ?? []}
        items={items}
        onSave={handlePickerSave}
        onCancel={() => setPicker(null)}
      />

      {/* 物品清单管理 dialog——CRUD 后 reload 刷新清单，标签名称即时更新 */}
      <ItemListDialog
        open={listDialogOpen}
        items={items}
        onClose={() => setListDialogOpen(false)}
        onChanged={reload}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除开局物品"
        message={`将移除「${
          deleteTarget ? (SKILLSET_NAMES[deleteTarget.skillsetId] ?? `#${deleteTarget.skillsetId}`) : ""
        }」的开局物品配置。确认继续？`}
        confirmLabel="删除"
        variant="danger"
        icon={X}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ConfigSection>
  );
}
