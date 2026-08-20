# Unturned 官方游戏图标总览（.research/Icons 盘点）

> 研究产出 · 2026-08-20 · 仅整理，不实现
>
> 数据源：`D:\unturned-manager\.research\Icons\`（用户提供，自 Unturned 官方抓取）
> 后续整合基线。本文档只负责索引与归类；图标整合到项目另开实现 PR。

---

## 1. 总体规模

| 维度 | 数值 |
|---|---|
| 文件总数 | **3183** 个 PNG |
| 目录结构 | 扁平（全部在 `.research/Icons/` 根，无子目录） |
| 命名格式 | `<Name>[_<Variant>]_<ItemID>.png`（如 `CN_12G_8_60111.png` = 12 号口径第 8 变种，ItemID 60111） |
| ItemID 范围 | ushort（0–65535）；尾部数字 ≥ 60000 多为社区精选（CN）系列 |
| 用途判定 | 全为游戏内物品的方块图（spawn 时贴在世界上的图标），不是 UI 矢量图标 |

---

## 2. 命名规则与字段语义

每张图标的文件名**携带三类信息**，靠下划线分隔：

```
<主题前缀>_<系列/分类>_<变种序号/外观标签>_<ItemID>.png
```

例：

| 文件名 | 解读 |
|---|---|
| `Alicepack_253.png` | 主题=Alicepack，ItemID=253（背包） |
| `CN_12G_8_60111.png` | 主题=CN 系列，12 号口径霰弹，第 8 变种，ItemID=60111 |
| `Anniversary_0_Blue_701.png` | Anniversary 系列，第 0 代外观，蓝色涂装，ItemID=701 |
| `Arid_Hockey_Mask_Black_1713.png` | Arid 地图风格，黑色曲棍球面具，ItemID=1713 |
| `Military_M4A1_26.png` | Military 地图风格，M4A1 步枪第 26 变种 |
| `Avenger_1021.png` | Avenger 武器，ItemID=1021 |

> ItemID 是 ushort（U3-SDK `Item.cs` ushort 字段，权威真源 U3-SDK 真源 `Items.asset`），所以**文件名末尾数字**就是玩家填进 `Commands.dat` `Loadout` 的数字。

---

## 3. 按前缀/系列粗分（top-30）

下表给出文件名首段（主题前缀）的分布，前缀代表「地图 / 主题 / 系列」归属：

| 数量 | 前缀 | 含义 |
|---:|---|---|
| 1051 | `CN_` | **Community Network / Curator 系列**（社区精选武器 + 配件）—— 项目最相关的资产 |
| 65 | `Rio` | 巴西 Rio 地图主题 |
| 64 | `Kuwait` | 科威特地图主题 |
| 62 | `LS` | Lost Sands 地图主题 |
| 49 | `Buak` | Buak 地图主题 |
| 49 | `Elver2` / `Elver` | 丹麦 Elver 地图主题 |
| 36 | `PBS` | PEI 子类 |
| 36 | `Arid` | 沙漠地图主题 |
| 33 | `Jersey` | Jersey Shore 地图主题 |
| 32 | `Vehicle` | 通用载具配件 |
| 29 | `Frost` | 雪地地图主题 |
| 28 | `Elver` | 同上 |
| 27 | `Military` | Military 地图主题 |
| 25 | `Plate` | 餐盘 / 食物容器系列 |
| 21 | `XMAS` | 圣诞节主题 |
| 20 | `Seed` | 种子 / 农作物系列 |
| 20 | `Sandwich` | 三明治系列 |
| 19 | `Tee` | T 恤系列 |
| 19 | `Anniversary` | 周年庆涂装 |
| 18 | `Hoodie` | 连帽衫系列 |
| 17 | `Shirt` | 衬衫系列 |
| 17 | `HW2` | Halloween Week 2 主题 |
| 17 | `Classic` | 经典主题 |
| 16 | `Stack` | 钱币/物品堆 |
| 16 | `Ghillie` | 吉利服系列 |
| 15 | `Umbrella` | 雨伞 |
| 15 | `EI` | Easter Island 地图主题 |

**结论**：

- `CN_` 占 1/3（1051/3183）—— 这部分是 **Curator / Mod 精选武器 + 配件** 的高分辨率图，整合价值最高（项目会展示 Mod 的物品）
- 其它前缀按地图/主题打散——同一类物品（背包、面具）在不同地图里有同名变种
- 地图/主题前缀是 Unturned 美术包的天然切分粒度

---

## 4. 按物品类型细分类（关键词匹配，机器粗分）

> 关键词法自动归类。一个物品可能匹配多个关键词，下表按首命中归类；个别多义词重复出现不影响大局。
>
> 关键词脚本：`C:\Users\WINDOWS\AppData\Local\Temp\analyze_icons.py`（仅本次盘点用，不入库）

| 数量 | 中文归类（关键词触发的最常见前缀举例） | 主要代表 |
|---:|---|---|
| 94 | **背包**（Backpack_/Pack_/Alicepack/Dufflebag/Daypack/Travelpack） | Alicepack、Alicepack_Arctic、Aprix 系列 |
| 78 | **配件**（弹匣/枪口/瞄具/枪托/握把） | Magazine、Suppressor、Sight、Stock、Grip、Barrel、Muzzle |
| 69 | **上衣**（Shirt/Jacket/Hoodie/Sweater/Coat/Parka/Poncho） | Hoodie、Jacket、Parka、Coat、Sweatervest |
| 62 | **煤炭**（Coal_） | 矿物资源 |
| 61 | **金属/钢材**（Metal/Steel/Scrap） | 矿物资源 |
| 50 | **武器**（Pistol/Rifle/SMG/Shotgun/Sniper/LMG/Bow/Crossbow） | 各地图 M4A1、Avenger、Augewehr、Crossbow |
| 42 | **裤子**（Pants/Jeans/Shorts/Trunks） | Pants、Jeans、Shorts |
| 40 | **面部装饰**（Mask/Balaclava/Goggles/Hair/Wig/Beard） | Mask、Balaclava、Glasses |
| 36 | **瞄具**（Scope/Sight/Holo/Red_Dot/Laser/Binoculars/Monocular） | 8x_Scope、16x_Scope、Holo_Sight、Red_Dot_Sight |
| 32 | **箭矢**（Arrow_/Crossbow_） | Arrow、Arrow_Explosive |
| 32 | **外套/上衣**（Suit/Vest/Tuxedo/Poncho/Coat） | Suit、Aprix 系列、Roman 主题 |
| 30 | **车辆相关**（Vehicle/Tire/Wheel/Engine/Carbattery/Tank/Horn） | Vehicle 系列 |
| 28 | **棒球帽**（Cap_） | 帽子系列 |
| 26 | **水/饮料**（Water_/Soda/Cola/Juice/Beer/Wine） | Water、Soda、Cola、Juice |
| 24 | **弓**（Bow_/Crossbow） | Bow、Crossbow |
| 21 | **围巾**（Scarf/Collar） | Scarf |
| 20 | **种子**（Seed_/Wheat/Crop） | Seed 系列 |
| 18 | **贝雷帽**（Beret） | Beret |
| 18 | **食物**（Pizza/Pie_/Sandwich/Cereal/Pasta/Rice/MRE/Ration/Beef/Chicken/Fish） | Pizza、Sandwich、Pie |
| 18 | **外观涂装**（Skin/Rainbow/Anniversary/Halo/Cape/Aura） | Anniversary 系列彩涂 |
| 18 | **瞄具/瞄准镜** | 同上「瞄具」 |
| 17 | **圣诞节**（XMAS） | 节日主题 |
| 16 | **桶/容器**（Barrel_/Crate/Bucket/Jerrycan） | 桶 |
| 16 | **信号弹**（Flare） | 照明系列 |
| 14 | **头部装饰**（Hat/Cap_/Beret/Helmet） | Helmet 系列 |
| 14 | **雨具**（Umbrella/Poncho） | Umbrella |
| 14 | **箭**（Arrow） | 同上 |
| 13 | **毛衣**（Sweater） | Sweater |
| 13 | **衬衫**（Shirt） | 同「上衣」 |
| 12 | **帽子类** | 同上 |
| 12 | **盒装物资**（Box_/Crate） | 物资箱 |
| 12 | **涂装/Skin** | 外观 |
| 12 | **手枪**（Pistol） | 手枪 |
| 12 | **物资/容器**（Bag_/Crate/Barrel_/Box_） | 容器系列 |
| 11 | **眼镜**（Glasses） | Glasses |
| 10 | **光环**（Aura/Halo） | 装饰系列 |
| 10 | **针织帽**（Toque） | Toque |
| 10 | **防弹衣**（Vest） | 防弹衣 |

未匹配（剩余 ~1700 个）：

| 数量 | 前缀 | 备注 |
|---:|---|---|
| 654 | `CN_` | 社区精选系列——多半可按 ItemID 段再分（弹匣/瞄具/箱/盒子……），需要人工逐项确认 |
| 32 | `Jersey` | Jersey Shore 地图主题 |
| 26 | `Kuwait` | 科威特地图主题 |
| 24 | `Elver` | 丹麦 Elver 地图主题 |
| 22 | `LS` | Lost Sands 地图主题 |
| 18 | `Tee` | T 恤系列 |
| 17 | `PBS` | PEI 子类 |
| 15 | `Frost` | 雪地地图主题 |
| 15 | `Military` | Military 地图主题 |
| 14 | `Buak` | Buak 地图主题 |
| 12 | `Ghillie` | 吉利服系列 |
| 11 | `Arid` | 沙漠地图主题 |
| 11 | `EI` | Easter Island 地图主题 |

---

## 5. CN_ 系列内部形态（最具整合价值的 1/3）

`CN_` 前缀 1051 个 PNG，是 **Curator / Community Network 社区精选武器 + 配件** 的高分辨率方块图，**整合到面板时是首要资产**。

### 5.1 命名 token 示例

```
CN_12G_8_60111.png        # 12 号口径霰弹，第 8 变种，ItemID 60111
CN_12G_Beast_6_63044.png  # 12 号口径「Beast」涂装第 6 变种
CN_12G_Magnesium_6_NB_60064.png  # 12 号口径「Magnesium」涂装「NB」派别
CN_AC_Damage_65019.png    # AC 模组「Damage」版
CN_AC_Firerate_62009.png  # AC 模组「Firerate」版
CN_ADV_Laser_64444.png    # 高级瞄具「Laser」版
CN_Advanced_Barrel_64419.png  # 高级枪管
```

### 5.2 token 结构（推断）

`<主题前缀>` + `<物品族>` + `<变种类型或属性>` + `<外观标签（可选）>` + `<派别（可选）>` + `<ItemID>`

| token 类型 | 含义 | 例子 |
|---|---|---|
| 主题前缀 | CN（Curator） | `CN_` |
| 物品族 | 武器/配件类型 | `12G`（12 号口径霰弹）、`AC`（Advanced 复合瞄具）、`ADV`（高级瞄具） |
| 变种类型 | 数值索引 / 子型号 | `8`（第 8 变种）、`Beast`（野兽涂装）、`Magnesium`（镁光涂装） |
| 外观标签 | 派别 / 阵营 | `NB`、`SC7`、`Coalition`、`Military`、`Void_Heavy` |
| ItemID | 唯一 ushort 标识 | `60111`、`63044` |

> **派别标签**对应游戏内的阵营外观：`Coalition` / `Military` / `NB`（New Bansenian） / `SC7` / `Void` / `Chainbreaker` 等——是 Unturned 美术包的阵营化主题。

### 5.3 与项目的关联

CN_ 系列是 **Mod 精选 / 创意工坊武器** 的图，整合场景对应：

- **Loadout 编辑器**：玩家在 Loadout 行加上 ItemID 后，旁边补物品小图（未在游戏内的 Mod 物品用占位图）
- **物品清单管理弹窗（ItemListDialog）**：列表里加缩略图（替代当前的纯文字标签）
- **Mod 详情弹窗**：Mod 的物品清单预览（创意工坊 Mod 自带的 `Items.txt` 解析时显示）

---

## 6. 地域/地图主题包（前缀汇总）

按地图/主题归类（同一物品在不同地图有不同外观）：

| 主题族 | 前缀 | 数量 |
|---|---|---:|
| Canada / Pacific | `CN_` | 1051 |
| Brazil | `Rio` | 65 |
| Middle East | `Kuwait` `LS`（Lost Sands） | 126 |
| Europe | `Buak` `Elver` `Elver2` `Jersey` `Arid` `EI` `Ireland` | ~190 |
| Russia / East Europe | `Carpat` `FranceHistorical` `AthensAprix` | ~20 |
| Pacific Northwest | `PBS`（PEI 子类） | 36 |
| North America | `Military` `Frost` | 42 |
| Holiday 主题 | `XMAS` `Anniversary` `HW2` `Candyland` `Mystery` `CC24` `Dango` `GA` | ~110 |
| 其他 | `Tee` `Hoodie` `Shirt` `Sweater` `Plaid` `Beret` `Toque` … | 散落 |

---

## 7. 文件大小分布

抽样看：`4655`（最小，Box 缺图占位）~ `85k+`（周年庆金涂装等大图）。多数在 `10k–40k` 区间——单文件轻量，适合直接打包。

---

## 8. 后续整合路线（建议）

> 本节是建议，不是任务清单。具体落实另开 PR。

1. **进入资产库的策略**
   - 当前 `.research/Icons/` 已是 100MB+ 静态资产；不适合作为运行时 import 源
   - 建议改放：`manager-web/public/items/<id>.png` 或 `shared/assets/items/`，按 ItemID 直出 URL，浏览器天然缓存
2. **ItemID → 静态路径映射**
   - 集成方式：常量表 `ITEM_ICON_BASE = "/items"` + `getItemIconUrl(id)` 工具函数（放 `lib/utils.ts`）
   - 离线无图：用 lucide-react `Package` 或 `Box` 占位（颜色按物品类型——武器 `red` / 医疗 `green` / 食物 `amber`）
3. **白名单策略**
   - 不打包全部 3183 张图；项目只引用内置物品清单（375 条 wiki label 物品）+ 用户收藏的 Mod 物品
   - 上线后由真实引用补齐
4. **清理 `.research/` 命名**
   - 这 3183 张图属于**第三方美术资产**（官方版权），**不要**保留 Unturned 官方品牌字样
   - 整合后建议改用 `unturned-item-icons-<id>.png`，去掉官方 `CN_` `Arid_` 前缀（保留 ItemID 作文件名唯一 key）

---

## 9. 附：本次分析脚本

- `analyze_icons.py`（关键词分类）
- `icons_summary.py`（lucide-react 用法汇总）

临时存放在 `C:\Users\WINDOWS\AppData\Local\Temp\`，**不纳入 git**。

---

**研究完成。下一步：等待用户决策是否进入 `/sc:design`（设计整合方案）。**