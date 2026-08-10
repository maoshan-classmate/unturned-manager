import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Save, X, Plus } from "lucide-react";
import { Dialog } from "../shared/Dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import type { CreateServerPayload } from "@/hooks/useServer";

interface CreateServerForm {
  id: string;
  name: string;
  gamePort: number;
  ownerSteamId: string;
  installDir: string;
}

/**
 * 创建新实例弹窗——5 字段表单 + 取消/创建。
 * 走 react-hook-form(项目铁律)。提交经 onCreated 回调接真实 POST /servers(ADR-0003 B2)。
 *
 * ★ ADR-0004 Phase 6：RCON 字段已删除（rconPassword / openModCredential）。
 *   所有命令通过 PTY 终端 owner-trust 模型执行，不再需要 RCON 凭证。
 *
 * @param props - 组件属性
 * @param props.open - 弹窗是否打开
 * @param props.onClose - 关闭回调
 * @param props.onCreated - 提交回调,接收创建负载并异步创建;失败抛错由本组件 toast
 * @returns 创建实例弹窗 React 元素
 *
 * @example
 * ```tsx
 * <CreateServerDialog open={open} onClose={close} onCreated={addServer} />
 * ```
 *//**
 * 创建新实例弹窗——7 字段表单 + 取消/创建。
 * 走 react-hook-form(项目铁律)。提交经 onCreated 回调接真实 POST /servers(ADR-0003 B2)。
 *
 * @param props - 组件属性
 * @param props.open - 弹窗是否打开
 * @param props.onClose - 关闭回调
 * @param props.onCreated - 提交回调,接收创建负载并异步创建;失败抛错由本组件 toast
 * @returns 创建实例弹窗 React 元素
 *
 * @example
 * ```tsx
 * <CreateServerDialog open={open} onClose={close} onCreated={addServer} />
 * ```
 */
export function CreateServerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (server: CreateServerPayload) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateServerForm>({
    defaultValues: {
      id: "",
      name: "",
      gamePort: 27015,
      ownerSteamId: "76561198000000000",
      installDir: "/opt/unturned",
    },
  });

  const onSubmit = async (data: CreateServerForm) => {
    if (!onCreated) {
      toast.error("创建通道未就绪");
      return;
    }
    try {
      await onCreated({
        id: data.id,
        name: data.name || data.id,
        gamePort: Number(data.gamePort),
        ownerSteamId: data.ownerSteamId,
        installDir: data.installDir,
      });
      toast.success(`实例「${data.id}」已创建`);
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建实例失败");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={520}>
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-3">
        <Dialog.Title>创建新实例</Dialog.Title>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              ServerID
            </label>
            <Input
              {...register("id", { required: "请输入 ServerID" })}
              placeholder="MyServer"
              className="h-9 text-sm"
            />
            {errors.id && (
              <p
                role="alert"
                className="text-sm mt-1"
                style={{ color: "#EF4444" }}
              >
                {errors.id.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">名称</label>
            <Input
              {...register("name")}
              placeholder="我的 Unturned 服务器"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              游戏端口
            </label>
            <Input
              type="number"
              {...register("gamePort", {
                valueAsNumber: true,
                required: "请输入端口",
              })}
              className="h-9 text-sm"
            />
            {errors.gamePort && (
              <p
                role="alert"
                className="text-sm mt-1"
                style={{ color: "#EF4444" }}
              >
                {errors.gamePort.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">
              Owner SteamID64
            </label>
            <Input
              {...register("ownerSteamId", {
                required: "请输入 Owner SteamID64",
              })}
              placeholder="76561198000000000"
              className="h-9 text-sm font-mono"
            />
            {errors.ownerSteamId && (
              <p
                role="alert"
                className="text-sm mt-1"
                style={{ color: "#EF4444" }}
              >
                {errors.ownerSteamId.message}
              </p>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-slate-400 mb-1">
              安装目录
            </label>
            <Input
              {...register("installDir", { required: "请输入安装目录" })}
              placeholder="/opt/unturned"
              className="h-9 text-sm font-mono"
            />
            {errors.installDir && (
              <p
                role="alert"
                className="text-sm mt-1"
                style={{ color: "#EF4444" }}
              >
                {errors.installDir.message}
              </p>
            )}
          </div>
          {/* ★ ADR-0004 Phase 6：RCON 通道已删除——创建实例不再需要 RCON 凭证字段 */}
        </div>

        <Dialog.Footer>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X size={14} /> 取消
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? (
              <Save size={14} className="animate-pulse" />
            ) : (
              <Plus size={14} />
            )}
            {isSubmitting ? "创建中..." : "创建"}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
