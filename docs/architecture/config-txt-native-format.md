# Config.txt 原生格式解析/序列化设计

> 目标：修复「高级设置保存后启动服务端变回默认」——根因是面板 Config.txt 序列化用 `[Browser]` + `key = value`，与 U3DS 原生格式（`Browser { }` + `key value`）双向不兼容。
> 真源：U3-SDK `UnturnedDat/DatTokenizer.cs` + `DatParser.cs`（官方 Config.txt 语法权威）。

---

## 1. 现状与根因

| 维度 | U3DS 原生 | 面板现状 | 结果 |
|---|---|---|---|
| 区块 | `Browser { ... }` 大括号块 | `[Browser]` 方括号 | U3DS 读不懂面板写的 |
| key-value | `VAC_Secure`（裸 key=默认）或 `VAC_Secure 值` | `VAC_Secure = 值`（等号） | 语义不匹配 |
| 文件头 | `Version 1` + `// >` 自动注释 | 无 | U3DS 拒读/重建 |
| 注释 | `//` 起（含 `// >` 自动生成） | `>` 起（错——`>` 不是注释） | 解析错位 |
| 读取侧 | — | `parseConfigTxt` 只认 `[Browser]` + `=` | 读实机文件 → sections 空（已实测） |
| 写入侧 | — | `serializeConfigTxt` 写 `[Browser]` + `=` | U3DS 读不懂 → 用默认重建覆盖 |

**完整循环**：面板读 → 空 → 用户填 → 保存写 `[Browser]` → U3DS 读不懂 → 启动重建默认 → 面板再读还是空。

## 2. U3-SDK 官方语法（真源 DatTokenizer.cs）

| token | 触发 | 语义 |
|---|---|---|
| `/` | 行首 | **注释**（`//` 后为注释文本）——不是值 |
| `{` `}` | 独立 | 字典块开/闭（嵌套配置节） |
| `[` `]` | 独立 | 列表开/闭（Config.txt 的 Links 用） |
| 行首非空白 | — | **key**（`ReadDictionaryKey`，遇空白结束） |
| key 后空格 + 非空白 | — | **value**（`ReadStringValue`，到行尾） |
| 无 value | — | 裸 key = 该字段用默认值 |
| `"..."` | 引号 | 转义字符串（`\n` `\t` `\\` `\"`） |
| 逗号 | 任意 | 当空白忽略 |

**`ReadDictionaryValue` 语义**（DatParser.cs:214-278）：
1. 读到 key → 前进
2. 下一 token 是 `Value` → 消费为 key 的值
3. 下一 token 是 `OpenDictionary`/`OpenList` → 解析嵌套块作为该 key 的值
4. 否则 → `DatValue(null)` = 裸 key（用默认值）

## 3. 数据结构设计

```typescript
// shared/types/domain.ts 现有 ConfigTxtRecord 改造
export interface ConfigSection {
  name: string;        // "Browser" | "Server" | "Items" | "Gameplay" | "_unlabeled"
  entries: ConfigEntry[];
}

export interface ConfigEntry {
  key: string;         // SDK C# 字段名（如 VAC_Secure）
  value: string | null; // null = 裸 key（默认值）；string = 覆盖值
  comment: string | null; // // 前缀注释文本（保留 U3DS 自动生成的 // > 注释）
  known: boolean;
  type: "string" | "bool" | "int";
}
```

> **注释保留策略**：U3DS 自动生成的 `// > ...` 注释是官方默认值的说明（面板 placeholder 依赖它），**必须保留**。用户手写 `// ...` 注释也应保留。parse 时把每个 key 前的注释块附到该 key 的 `comment` 字段，序列化时原样写回。

## 4. 解析器（parseConfigTxt）

```
行循环（保留原始缩进/注释）：
  遇 `//` 开行 → 记入 pendingComment（多行合并）
  遇 `{` → 若当前 pendingKey 存在 → 开始嵌套块（递归解析为该 key 的 value）
  遇 `}` → 关闭当前块
  遇 `[` → 列表（Links 场景，面板只读展示，不做结构解析——原样保留行）
  行首非空白（且不在 { 块内）→ key = 该行内容；若行内 key 后还有非空白 → value
  否则 → 该 key 无 value（裸 key = 默认）
```

关键：**保留注释与 key 的关联** + **嵌套块原样保留**（面板不编辑嵌套结构，只读）。

## 5. 序列化器（serializeConfigTxt）

```
Version 1
(根级注释原样保留)

Browser
{
	// > 注释块原样
	Icon              ← 裸 key（value 为 null 时）
	Login_Token xxx   ← key + 空格 + value
}

Server
{
	...
}
```

规则：
- `Version 1` 固定头
- 区块 `Section { }` 大括号 + Tab 缩进
- 裸 key（value null）= 字段名独占一行
- 覆盖 key = `字段名 值`（空格分隔，不用 `=`）
- `// >` 注释原样保留（value 为 null 时注释即默认值说明）

## 6. 前端适配

`ConfigPage.tsx` 的 `ConfigTxtTab` 读取逻辑：
- `readBoolEntry(section, key, default)` —— section 现在是 `Browser`/`Server`（原生名），key 匹配不变
- `readStringEntry(section, key)` —— 同上
- **默认值依赖注释**：`getFieldPlaceholder` 读的是 `TXT_FIELD_DEFAULTS` 硬编码表——可改为从 key 的 comment 里解析 `Default: xxx`（注释真源），更可靠

### 裸 key 语义（关键）

U3DS 原生格式里「裸 key（无 value）」与「key 缺失」语义**不同**：

| 状态 | U3DS 语义 | 面板应显示 |
|---|---|---|
| 裸 key（如 `VAC_Secure` 独占一行） | 显式使用官方默认值 | 该字段用官方默认（placeholder 显示默认） |
| key 完全不存在 | 也是官方默认 | 同上 |

两者对 U3DS 都是「用默认值」，但**裸 key 是用户主动写过的（可能在别的版本改过）**。面板显示上**无需区分**——都是「默认值」——但序列化时必须保留裸 key（不把它当「用户想清空」）。

> **陷阱**：`readBoolEntry` 现有逻辑 `value=null → 返回 defaultVal` 恰好对裸 key 成立（裸 key 的 value 就是 null）。但 `readStringEntry` 的 `value=null → 返回 ""` 会把裸 key 当「空串」——对 string 字段（如 Login_Token）裸 key 应显示为空（因为默认就是空），语义仍成立。**无需改 readStringEntry**。

## 7. 测试策略

| 目标 | 用例 |
|---|---|
| parse | 裸 key、key+value、`// >` 注释保留、`Version 1` 跳过、嵌套块原样、空文件 |
| serialize | 裸 key 不写 `=`、覆盖 key 写空格、注释原样、区块缩进 |
| round-trip | 实机 Config.txt → parse → serialize → 再 parse → 不变 |
| 与 Commands.dat 无关 | Config.txt 改动不影响 Commands.dat 逻辑 |

## 8. 影响面

| 文件 | 改动 |
|---|---|
| `manager-server/src/modules/config/ConfigService.ts` | 重写 `parseConfigTxt`/`serializeConfigTxt` |
| `manager-web/src/pages/configTxtAdapter.ts` | `readBoolEntry`/`readStringEntry` 适配原生 section 名 |
| `manager-web/src/pages/ConfigPage.tsx` | 适配新 parse 结构（如注释来源的 placeholder） |
| `manager-server/tests/configService.test.ts` | 更新 Config.txt 解析/序列化用例 |

## 9. 风险

- **低**：改的是 Config.txt 专属 parse/serialize 纯函数，不碰 Commands.dat/Workshop 逻辑
- **中**：注释保留逻辑复杂（`// >` 自动 + `//` 手写混合），需 round-trip 测试兜底
- **实机验证**：改后保存高级设置 → 重启 U3DS → 确认配置保留 + 面板能读到
