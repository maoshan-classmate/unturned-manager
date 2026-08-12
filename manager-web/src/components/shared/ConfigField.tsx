import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 下拉「服务端默认」哨兵值——选中后映射为空串（不写该指令行，回 SDK 默认值）。
 */
const RESET_VALUE = "__reset__";

/**
 * 配置表单字段——标签 + 输入控件组合。
 * 在 ConfigPage / Config.txt / SettingsPage 中复用。
 *
 * 三种形态（按 props 优先级）：
 * 1. 传 `options` → 渲染下拉框（固定枚举字段，如难度/视角）
 * 2. 传 `suggestions` → 渲染可输入文本框 + 建议列表（datalist，如地图）
 * 3. 都不传 → 纯文本/数字输入框
 *
 * @param props - 组件属性
 * @param props.label - 字段标签，显示在输入框上方
 * @param props.value - 当前值（下拉形态为枚举原始名；空串 = 未配置）
 * @param props.onChange - 值变化回调（下拉形态回传 U3DS 识别的枚举原始名，选「服务端默认」回传空串）
 * @param props.type - HTML input type（text/password/number 等），默认 text；下拉形态忽略
 * @param props.placeholder - 空值时的占位提示（下拉形态 = 「服务端默认」含义说明）
 * @param props.options - 下拉选项（value 为枚举原始名，label 为界面文案）；传入则渲染下拉框
 * @param props.suggestions - datalist 建议值（如官方地图 + 已下载地图名）；传入则文本框带建议下拉，不限制输入
 * @returns 配置字段 React 元素（下拉 / 带建议文本框 / 普通文本框）
 *
 * @example
 * ```tsx
 * // 下拉枚举字段（难度）
 * <ConfigField label="难度" value={fields.Mode} onChange={(v) => onChange('Mode', v)}
 *   options={COMMANDS_DAT_ENUMS.Mode} placeholder="使用服务端默认（普通）" />
 * // 带建议的文本框（地图——mod 地图可自由输入）
 * <ConfigField label="地图" value={fields.Map} onChange={(v) => onChange('Map', v)}
 *   suggestions={['PEI', 'Washington']} />
 * ```
 */
interface ConfigFieldProps {
  /** 字段标签，显示在输入框上方 */
  label: string;
  /** 输入框当前值 */
  value: string;
  /** 输入值变化回调 */
  onChange: (value: string) => void;
  /** HTML input type（text/password/number 等），默认 text */
  type?: string;
  /** 占位符——表单字段为空时显示。留空 = 无占位符 */
  placeholder?: string;
  /** 下拉选项（value 为枚举原始名，label 为界面文案）。传入则渲染下拉框 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** datalist 建议值。传入则文本框带建议下拉，不限制输入 */
  suggestions?: readonly string[];
}

export function ConfigField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  options,
  suggestions,
}: ConfigFieldProps) {
  const datalistId = `datalist-${label.replace(/\s+/g, "-")}`;

  if (options) {
    return (
      <label className="block">
        <span className="text-xs" style={{ color: "#94A3B8" }}>
          {label}
        </span>
        <Select
          value={value || null}
          onValueChange={(v) =>
            onChange(v === null || v === RESET_VALUE ? "" : v)
          }
          // Base UI 的 SelectValue 不会自动从 SelectItem children 取 label——
          // 必须显式传 items 映射，否则选中后显示原始枚举名而非界面文案
          items={Object.fromEntries(options.map((o) => [o.value, o.label]))}
        >
          <SelectTrigger className="mt-1 h-8 w-full text-sm" size="sm">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RESET_VALUE}>服务端默认</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="text-xs" style={{ color: "#94A3B8" }}>
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 text-sm"
        type={type}
        placeholder={placeholder}
        list={suggestions ? datalistId : undefined}
      />
      {suggestions && (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </label>
  );
}
