import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { Dialog } from "./Dialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { SearchInput } from "./SearchInput.js";
import { createItem, deleteItem, updateItem } from "../../api/items.js";
import type { ItemRecord } from "@unturned-manager/shared";

/**
 * 新增/编辑物品表单 schema。
 * ID 字段用字符串注册，schema 内 preprocess + coerce：空串 → NaN → 校验失败；
 * "123" → 123（number）。避免 valueAsNumber 默认值回显 0。
 */
const itemFormSchema = z.object({
  /** 物品 ID（0–65535）——表单为字符串，校验时转 number */
  id: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? NaN : v),
    z
      .coerce.number({ invalid_type_error: "请输入物品 ID" })
      .int("物品 ID 需为整数")
      .min(0, "物品 ID 需在 0–65535 之间")
      .max(65535, "物品 ID 需在 0–65535 之间"),
  ),
  /** 源名（英文/原义） */
  name: z.string().min(1, "名称不能为空").max(64, "名称不能超过 64 字"),
  /** 中文显示名（可选，仅前端显示） */
  label: z.string().max(64, "显示名不能超过 64 字").optional(),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;

/** 增/改共用子弹窗——新增模式 originalId 为空，编辑模式预填 */
interface ItemFormDialogProps {
  open: boolean;
  /** 编辑时的原 ID（新增模式为 null） */
  originalId: number | null;
  /** 编辑预填值 */
  initial?: { id: number; name: string; label?: string | null };
  /** 当前全部物品 ID 集合（内置 + 自定义）——提交前本地查重，命中直接在 ID 字段下报错；后端 409 兜底 */
  existingIds: Set<number>;
  onSave: (input: { id: number; name: string; label?: string | null }) => Promise<void>;
  onClose: () => void;
}

/** 物品新增/编辑表单弹窗（react-hook-form + zod） */
function ItemFormDialog({
  open,
  originalId,
  existingIds,
  initial,
  onSave,
  onClose,
}: ItemFormDialogProps) {
  const isEdit = originalId !== null;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      id: (initial?.id != null ? String(initial.id) : "") as unknown as number,
      name: initial?.name ?? "",
      label: initial?.label ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        id: (initial?.id != null ? String(initial.id) : "") as unknown as number,
        name: initial?.name ?? "",
        label: initial?.label ?? "",
      });
    }
  }, [open, initial, reset]);

  const onSubmit = async (data: ItemFormValues) => {
    // ★ 提交前本地查重：ID 主键全局唯一（内置 + 自定义同一张表），命中直接在 ID 字段下报错，
    // 省一次网络往返；后端 SQLITE_CONSTRAINT_UNIQUE → 409 仍保留作兜底。
    if (data.id !== originalId && existingIds.has(data.id)) {
      setError("id", { type: "custom", message: "该物品 ID 已存在" });
      return;
    }
    try {
      await onSave({
        id: data.id,
        name: data.name.trim(),
        label: data.label?.trim() ? data.label.trim() : null,
      });
      onClose();
    } catch {
      // onSave 内部已 toast 后端中文错误；此处不吞异常避免重复提示
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={420}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-3">
        <Dialog.Title>{isEdit ? "编辑物品" : "新增物品"}</Dialog.Title>

        <div>
          <label className="block text-xs text-slate-400 mb-1">物品 ID</label>
          <input
            type="text"
            inputMode="numeric"
            {...register("id")}
            placeholder="例如 1"
            aria-invalid={!!errors.id}
            className="w-full h-9 rounded text-xs px-3 font-mono bg-slate-950 border border-slate-700 text-slate-100"
          />
          {errors.id && (
            <p role="alert" className="text-xs mt-1" style={{ color: "#EF4444" }}>
              {errors.id.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">名称</label>
          <input
            {...register("name")}
            placeholder="例如 手枪（Mod 物品填自定义名）"
            aria-invalid={!!errors.name}
            className="w-full h-9 rounded text-xs px-3 bg-slate-950 border border-slate-700 text-slate-100"
          />
          {errors.name && (
            <p role="alert" className="text-xs mt-1" style={{ color: "#EF4444" }}>
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            显示名称（可选，中文）
          </label>
          <input
            {...register("label")}
            placeholder="中文显示名，留空则显示上方名称"
            aria-invalid={!!errors.label}
            className="w-full h-9 rounded text-xs px-3 bg-slate-950 border border-slate-700 text-slate-100"
          />
          {errors.label && (
            <p role="alert" className="text-xs mt-1" style={{ color: "#EF4444" }}>
              {errors.label.message}
            </p>
          )}
        </div>

        <Dialog.Footer>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex items-center gap-1 px-3 h-7 rounded text-xs text-slate-300 hover:bg-slate-800"
          >
            <X size={12} />
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-1 px-3 h-7 rounded text-xs text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
          >
            <Plus size={12} />
            {isSubmitting ? "保存中..." : isEdit ? "保存" : "添加"}
          </button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

/** 物品清单管理弹窗属性 */
interface ItemListDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 物品清单（内置 + 自定义） */
  items: ItemRecord[];
  /** 关闭回调 */
  onClose: () => void;
  /** 清单变更后触发（父组件 reload useItems） */
  onChanged: () => void;
}

/** 编辑目标状态 */
type EditTarget =
  | { mode: "add"; originalId: null; initial?: undefined }
  | {
      mode: "edit";
      originalId: number;
      initial: { id: number; name: string; label?: string | null };
    }
  | null;

/** 从 axios 错误提取后端中文 message */
function extractError(err: unknown, fallback: string): string {
  const msg = (
    err as { response?: { data?: { error?: { message?: string } } } }
  )?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}

/**
 * 物品清单管理弹窗——搜索 + 列表 + 新增/编辑/删除。
 * 内置物品只读（无操作按钮）；自定义物品完整 CRUD（ID + 名称可编辑）。
 * 增/改走子弹窗（react-hook-form + zod），删除走 ConfirmDialog。
 *
 * @param props - 组件属性
 * @param props.open - 是否打开
 * @param props.items - 物品清单
 * @param props.onClose - 关闭回调
 * @param props.onChanged - 清单变更后触发
 * @returns 物品清单管理弹窗 React 元素
 *
 * @example
 * ```tsx
 * <ItemListDialog open={open} items={items} onClose={() => setOpen(false)} onChanged={reload} />
 * ```
 */
export function ItemListDialog({
  open,
  items,
  onClose,
  onChanged,
}: ItemListDialogProps) {
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<ItemRecord | null>(null);

  // 关闭/打开时清空本地状态
  useEffect(() => {
    if (!open) {
      setSearch("");
      setEditTarget(null);
      setDeleteTarget(null);
    }
  }, [open]);

  /** 过滤：ID 或名称子串（大小写不敏感） */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.id.toString().includes(q) || i.name.toLowerCase().includes(q),
    );
  }, [search, items]);

  /** 全部物品 ID 集合（内置 + 自定义同表）——新增/编辑表单提交前本地查重 */
  const existingIds = useMemo(
    () => new Set(items.map((i) => i.id)),
    [items],
  );

  /** 新增/编辑提交——调用 API 后刷新清单 */
  const handleSave = async (input: {
    id: number;
    name: string;
    label?: string | null;
  }) => {
    try {
      if (editTarget?.mode === "edit") {
        await updateItem(editTarget.originalId, input);
        toast.success("物品已更新");
      } else {
        await createItem(input);
        toast.success("物品已添加");
      }
      onChanged();
      setEditTarget(null);
    } catch (err) {
      toast.error(extractError(err, "保存失败"));
    }
  };

  /** 删除提交 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteItem(deleteTarget.id);
      toast.success("物品已删除");
      onChanged();
      setDeleteTarget(null);
    } catch (err) {
      toast.error(extractError(err, "删除失败"));
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} width={560}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <Dialog.Title>物品清单</Dialog.Title>
            <button
              type="button"
              onClick={() => setEditTarget({ mode: "add", originalId: null })}
              className="flex items-center gap-1 px-3 h-7 rounded text-xs text-white bg-emerald-500 hover:bg-emerald-600"
            >
              <Plus size={12} />
              新增物品
            </button>
          </div>

          <div className="mb-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="搜索物品 ID 或名称"
              width={220}
            />
          </div>

          {/* 列表 */}
          <div className="max-h-80 overflow-y-auto rounded border border-slate-700 divide-y divide-slate-700">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                没有匹配的物品
              </div>
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-900"
                >
                  <span
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
                      item.source === "builtin"
                        ? "bg-slate-800 text-slate-500"
                        : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {item.source === "builtin" ? "内置" : "自定义"}
                  </span>
                  <span className="font-mono text-xs text-slate-300 shrink-0">
                    {item.id}
                  </span>
                  <span className="text-xs text-slate-100 flex-1 min-w-0 truncate">
                    {item.label ?? item.name}
                  </span>
                  {item.source !== "builtin" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditTarget({
                            mode: "edit",
                            originalId: item.id,
                            initial: {
                              id: item.id,
                              name: item.name,
                              label: item.label ?? null,
                            },
                          })
                        }
                        className="p-1 rounded hover:bg-slate-700"
                        aria-label={`编辑物品 ${item.id}`}
                      >
                        <Pencil size={12} className="text-slate-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="p-1 rounded hover:bg-red-500/20"
                        aria-label={`删除物品 ${item.id}`}
                      >
                        <Trash2 size={12} className="text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <Dialog.Footer>
            <button
              type="button"
              onClick={onClose}
              className="px-3 h-7 rounded text-xs text-slate-300 hover:bg-slate-800"
            >
              关闭
            </button>
          </Dialog.Footer>
        </div>
      </Dialog>

      {/* 新增/编辑子弹窗 */}
      <ItemFormDialog
        open={editTarget !== null}
        originalId={editTarget?.originalId ?? null}
        existingIds={existingIds}
        initial={
          editTarget?.mode === "edit" ? editTarget.initial : undefined
        }
        onSave={handleSave}
        onClose={() => setEditTarget(null)}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除物品"
        message={`将删除「${deleteTarget?.name ?? ""}」（ID ${deleteTarget?.id ?? ""}）。已配置在开局物品里的该物品会显示为「未知物品」。`}
        confirmLabel="删除"
        variant="danger"
        icon={Trash2}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
