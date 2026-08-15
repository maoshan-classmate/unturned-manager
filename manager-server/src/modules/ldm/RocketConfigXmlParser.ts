/**
 * RocketConfigXmlParser——LDM 配置 XML 解析器（自写，零依赖）。
 *
 * 设计约束（自写原因）：
 *   - **注释保留**——`<!-- ... -->` 不丢（用户文档/版权声明/字段说明）
 *   - **属性顺序保留**——`<Tag Attr1="x" Attr2="y">` 顺序写回不重排
 *   - **CDATA 保留**——`<![CDATA[ ... ]]>` 原样
 *   - **嵌套保留**——`<Parent><Child/></Parent>` 层级不破坏
 *   - **未知键保留**——`<UnknownKey>value</UnknownKey>` 不删（用户手写配置）
 *   - **文本节点保留**——`<Tag>text content</Tag>` 中间文本不丢
 *
 * 序列化策略——**字段合并**，不整体重写：在原 XML 树中查找对应子元素/属性，更新值；未在 fields
 * 中提及的元素原样保留（注释/CDATA/未知键）。
 *
 * 真源：LDM 仓 `Rocket/Rocket.Core/Serialization/RocketSettings.cs` + `Rocket/Rocket.Unturned/Serialisation/UnturnedSettings.cs`。
 * @see docs/architecture/ldm-integration-design.md §2.4 / §2.4b / §2.5
 * @see docs/architecture/ldm-phase2-design.md §3.1
 */
import type {
  IRocketConfigXmlParser,
  XmlNode,
  RocketConfigFields,
  RocketUnturnedConfigFields,
  PermissionsConfigFields,
} from "@unturned-manager/shared";

// ─── 常量 ─────────────────────────────────────────────

/** XML 声明头 `<?xml version="1.0" encoding="utf-8"?>` 起始标记 */
const XML_DECL_START = "<?xml";
/** XML 注释起始 */
const COMMENT_START = "<!--";
/** XML 注释结束 */
const COMMENT_END = "-->";
/** CDATA 起始 */
const CDATA_START = "<![CDATA[";
/** CDATA 结束 */
const CDATA_END = "]]>";
/** RocketConfiguration 根元素名 */
const ROCKET_CONF_ROOT = "RocketConfiguration";
/** Rocket.Unturned.config.xml 根元素名 */
const ROCKET_UNTURNED_ROOT = "RocketConfiguration"; // 同名（UnturnedSettings 类 XmlSerializer 行为）
/** Permissions.config.xml 根元素名 */
const PERMISSIONS_ROOT = "RocketPermissions";

// ─── 实现 ─────────────────────────────────────────────

export class RocketConfigXmlParser implements IRocketConfigXmlParser {
  // ── parseRocketConfig ──

  parseRocketConfig(xml: string): { fields: RocketConfigFields; raw: string } {
    const tree = this.parseGeneric(xml);
    // tree 即根元素（wrapRoot 在单根情况下返回根元素本身）
    // 直接用 tree 作为 root，不再 findElement
    const root = tree;

    const fields: RocketConfigFields = {
      languageCode: this.elementText(root, "LanguageCode") ?? "en",
      maxFrames: this.parseIntOr(root, "MaxFrames", undefined, 60),
      automaticShutdownEnabled:
        this.elementBool(root, "AutomaticShutdown", "Enabled") ?? false,
      automaticShutdownInterval: this.parseIntOr(
        root,
        "AutomaticShutdown",
        "Interval",
        86400,
      ),
      webPermissionsEnabled:
        this.elementBool(root, "WebPermissions", "Enabled") ?? false,
      webPermissionsUrl:
        this.elementText(root, "WebPermissions", "Url") ?? "",
      webPermissionsInterval: this.parseIntOr(
        root,
        "WebPermissions",
        "Interval",
        180,
      ),
      webConfigurationsEnabled:
        this.elementBool(root, "WebConfigurations", "Enabled") ?? false,
      webConfigurationsUrl:
        this.elementText(root, "WebConfigurations", "Url") ?? "",
    };

    return { fields, raw: xml };
  }

  // ── parseRocketUnturnedConfig ──

  parseRocketUnturnedConfig(xml: string): {
    fields: RocketUnturnedConfigFields;
    raw: string;
  } {
    const tree = this.parseGeneric(xml);
    const root = tree;

    const fields: RocketUnturnedConfigFields = {
      automaticSaveEnabled:
        this.elementBool(root, "AutomaticSave", "Enabled") ?? true,
      automaticSaveInterval: this.parseIntOr(
        root,
        "AutomaticSave",
        "Interval",
        1800,
      ),
      characterNameValidation:
        this.elementBool(root, "CharacterNameValidation") ?? false,
      characterNameValidationRule:
        this.elementText(root, "CharacterNameValidationRule") ??
        "([\\x00-\\AA]|[\\w_\\ \\.\\+\\-])+",
      logSuspiciousPlayerMovement:
        this.elementBool(root, "LogSuspiciousPlayerMovement") ?? true,
      enableItemBlacklist:
        this.elementBool(root, "EnableItemBlacklist") ?? false,
      enableItemSpawnLimit:
        this.elementBool(root, "EnableItemSpawnLimit") ?? false,
      maxSpawnAmount: this.parseIntOr(root, "MaxSpawnAmount", undefined, 10),
      enableVehicleBlacklist:
        this.elementBool(root, "EnableVehicleBlacklist") ?? false,
    };

    return { fields, raw: xml };
  }

  // ── parsePermissionsConfig ──

  parsePermissionsConfig(xml: string): {
    fields: PermissionsConfigFields;
    raw: string;
  } {
    const tree = this.parseGeneric(xml);
    const root = tree;

    const defaultGroup = this.elementText(root, "DefaultGroup") ?? "default";
    const groupsContainer = this.findElement(root, "Groups");
    const groups = (groupsContainer?.children ?? [])
      .filter((c: XmlNode): c is XmlNode & { name: string } => c.type === "element" && c.name === "Group")
      .map((g: XmlNode & { name: string }) => {
        const id = this.elementText(g, "Id") ?? "";
        const displayName = this.elementText(g, "DisplayName") ?? id;
        const color = this.elementText(g, "Color") ?? "white";
        const parentGroup = this.elementText(g, "ParentGroup");
        const priority = this.parseIntOr(g, "Priority", undefined, 100);
        const membersContainer = this.findElement(g, "Members");
        const members = (membersContainer?.children ?? [])
          .filter(
            (c: XmlNode): c is XmlNode & { value: string } =>
              c.type === "element" && c.name === "Member" && typeof c.value === "string",
          )
          .map((m: XmlNode & { value: string }) => m.value);
        const permissionsContainer = this.findElement(g, "Permissions");
        const permissions = (permissionsContainer?.children ?? [])
          .filter(
            (c: XmlNode): c is XmlNode & { value: string } =>
              c.type === "element" && c.name === "Permission" && typeof c.value === "string",
          )
          .map((p: XmlNode & { value: string }) => p.value);
        return { id, displayName, color, members, parentGroup, priority, permissions };
      });

    return { fields: { defaultGroup, groups }, raw: xml };
  }

  // ── serializeRocketConfig ──

  serializeRocketConfig(fields: RocketConfigFields, originalXml: string): string {
    const tree = this.parseGeneric(originalXml);
    // tree 即根元素（wrapRoot 在单根情况下返回根元素本身）
    const root = tree;
    if (!root) {
      // 原 XML 无根元素——降级：构造最小结构
      return originalXml;
    }
    this.setElementText(root, "LanguageCode", undefined, fields.languageCode);
    this.setElementText(root, "MaxFrames", undefined, String(fields.maxFrames));
    this.setElementBool(
      root,
      "AutomaticShutdown",
      "Enabled",
      fields.automaticShutdownEnabled,
    );
    this.setElementText(
      root,
      "AutomaticShutdown",
      "Interval",
      String(fields.automaticShutdownInterval),
    );
    this.setElementBool(
      root,
      "WebPermissions",
      "Enabled",
      fields.webPermissionsEnabled,
    );
    this.setElementText(root, "WebPermissions", "Url", fields.webPermissionsUrl);
    this.setElementText(
      root,
      "WebPermissions",
      "Interval",
      String(fields.webPermissionsInterval),
    );
    this.setElementBool(
      root,
      "WebConfigurations",
      "Enabled",
      fields.webConfigurationsEnabled,
    );
    this.setElementText(
      root,
      "WebConfigurations",
      "Url",
      fields.webConfigurationsUrl,
    );
    return this.serializeGeneric(tree);
  }

  // ── serializeRocketUnturnedConfig ──

  serializeRocketUnturnedConfig(
    fields: RocketUnturnedConfigFields,
    originalXml: string,
  ): string {
    const tree = this.parseGeneric(originalXml);
    const root = this.findElement(tree, ROCKET_UNTURNED_ROOT);
    if (!root) return originalXml;
    this.setElementBool(
      root,
      "AutomaticSave",
      "Enabled",
      fields.automaticSaveEnabled,
    );
    this.setElementText(
      root,
      "AutomaticSave",
      "Interval",
      String(fields.automaticSaveInterval),
    );
    this.setElementBool(
      root,
      "CharacterNameValidation",
      undefined,
      fields.characterNameValidation,
    );
    this.setElementText(
      root,
      "CharacterNameValidationRule",
      undefined,
      fields.characterNameValidationRule,
    );
    this.setElementBool(
      root,
      "LogSuspiciousPlayerMovement",
      undefined,
      fields.logSuspiciousPlayerMovement,
    );
    this.setElementBool(
      root,
      "EnableItemBlacklist",
      undefined,
      fields.enableItemBlacklist,
    );
    this.setElementBool(
      root,
      "EnableItemSpawnLimit",
      undefined,
      fields.enableItemSpawnLimit,
    );
    this.setElementText(root, "MaxSpawnAmount", undefined, String(fields.maxSpawnAmount));
    this.setElementBool(
      root,
      "EnableVehicleBlacklist",
      undefined,
      fields.enableVehicleBlacklist,
    );
    return this.serializeGeneric(tree);
  }

  // ── serializePermissionsConfig ──

  serializePermissionsConfig(
    fields: PermissionsConfigFields,
    originalXml: string,
  ): string {
    const tree = this.parseGeneric(originalXml);
    const root = this.findElement(tree, PERMISSIONS_ROOT);
    if (!root) return originalXml;
    this.setElementText(root, "DefaultGroup", undefined, fields.defaultGroup);
    // Groups 整体替换（groups 列表是动态结构，字段合并复杂；保持简单——直接替换）
    const groupsContainer = this.findElement(root, "Groups");
    if (groupsContainer) {
      groupsContainer.children = fields.groups.map(
        (g: {
          id: string;
          displayName: string;
          color: string;
          members: string[];
          parentGroup?: string;
          priority: number;
          permissions: string[];
        }): XmlNode => ({
          type: "element",
          name: "Group",
          children: [
            this.textElement("Id", g.id),
            this.textElement("DisplayName", g.displayName),
            this.textElement("Color", g.color),
            g.parentGroup
              ? this.textElement("ParentGroup", g.parentGroup)
              : undefined,
            this.textElement("Priority", String(g.priority)),
            {
              type: "element",
              name: "Members",
              children: g.members.map((m: string): XmlNode => ({
                type: "element",
                name: "Member",
                value: m,
              })),
            },
            {
              type: "element",
              name: "Permissions",
              children: g.permissions.map((p: string): XmlNode => ({
                type: "element",
                name: "Permission",
                value: p,
              })),
            },
          ].filter((c): c is XmlNode => c !== undefined),
        }),
      );
    }
    return this.serializeGeneric(tree);
  }

  // ── parseGeneric ──

  parseGeneric(xml: string): XmlNode {
    const nodes: XmlNode[] = [];
    let pos = 0;
    while (pos < xml.length) {
      const nextSpecial = this.findNextSpecial(xml, pos);
      if (nextSpecial === -1) {
        // 剩余全是 text
        const text = xml.slice(pos);
        if (text.length > 0) nodes.push({ type: "text", value: text });
        break;
      }
      // text 节点（在 special 标记之前）
      if (nextSpecial > pos) {
        const text = xml.slice(pos, nextSpecial);
        nodes.push({ type: "text", value: text });
      }
      pos = nextSpecial;
      if (xml.startsWith(COMMENT_START, pos)) {
        const end = xml.indexOf(COMMENT_END, pos + COMMENT_START.length);
        if (end === -1) throw new Error("XML 注释未闭合");
        nodes.push({
          type: "comment",
          value: xml.slice(pos + COMMENT_START.length, end),
          rawStart: pos,
          rawEnd: end + COMMENT_END.length,
        });
        pos = end + COMMENT_END.length;
      } else if (xml.startsWith(CDATA_START, pos)) {
        const end = xml.indexOf(CDATA_END, pos + CDATA_START.length);
        if (end === -1) throw new Error("CDATA 段未闭合");
        nodes.push({
          type: "cdata",
          value: xml.slice(pos + CDATA_START.length, end),
          rawStart: pos,
          rawEnd: end + CDATA_END.length,
        });
        pos = end + CDATA_END.length;
      } else if (xml.startsWith(XML_DECL_START, pos)) {
        const end = xml.indexOf("?>", pos + XML_DECL_START.length);
        if (end === -1) throw new Error("XML 声明未闭合");
        // 视为 text（保留原文）
        nodes.push({ type: "text", value: xml.slice(pos, end + 2) });
        pos = end + 2;
      } else if (xml[pos] === "<") {
        // close tag `</name>` —— 由 parseElement 内部匹配，跳过（顶层不应出现 close tag）
        if (xml[pos + 1] === "/") {
          const closeEnd = xml.indexOf(">", pos);
          if (closeEnd === -1) throw new Error("顶层出现未闭合 close tag");
          pos = closeEnd + 1;
        } else {
          const { node, nextPos } = this.parseElement(xml, pos);
          nodes.push(node);
          pos = nextPos;
        }
      } else {
        // 兜底：作为 text 推进 1 字符（避免死循环）
        nodes.push({ type: "text", value: xml[pos]! });
        pos += 1;
      }
    }
    return this.wrapRoot(nodes);
  }

  // ── serializeGeneric ──

  serializeGeneric(node: XmlNode): string {
    switch (node.type) {
      case "text":
        return node.value ?? "";
      case "comment":
        return `<!--${node.value ?? ""}-->`;
      case "cdata":
        return `<![CDATA[${node.value ?? ""}]]>`;
      case "element": {
        const attrs = node.attrs ?? {};
        const attrStr = (Object.entries(attrs) as [string, string][])
          .map(
            ([k, v]) => ` ${k}="${this.escapeAttr(typeof v === "string" ? v : "")}"`,
          )
          .join("");
        const children = node.children ?? [];
        const inner = children.map((c: XmlNode) => this.serializeGeneric(c)).join("");
        if (children.length === 0 && inner === "") {
          return `<${node.name}${attrStr}/>`;
        }
        return `<${node.name}${attrStr}>${inner}</${node.name}>`;
      }
    }
    // 兜底：未知 type 返回空串（TS strict switch exhaustiveness）
    return "";
  }

  // ─── 私有辅助 ──────────────────────────────────────────

  /**
   * 把 XmlNode[] 包装成单一根节点——用于兼容 caller 期待单一返回的接口。
   * 若只有一个 element 节点且 name 非 undefined，返回该节点；否则包一层 <root>。
   */
  private wrapRoot(nodes: XmlNode[]): XmlNode {
    const elements = nodes.filter(
      (n): n is XmlNode & { name: string } => n.type === "element" && typeof n.name === "string",
    );
    if (elements.length === 1) return elements[0]!;
    return {
      type: "element",
      name: "root",
      children: nodes,
    };
  }

  /**
   * 查找下一个 special 标记位置（< / <!-- / <![CDATA[ / <?xml）
   */
  private findNextSpecial(xml: string, from: number): number {
    const candidates = ["<", COMMENT_START, CDATA_START, XML_DECL_START]
      .map((m) => xml.indexOf(m, from))
      .filter((p) => p !== -1);
    return candidates.length === 0 ? -1 : Math.min(...candidates);
  }

  /**
   * 解析一个元素（从 '<' 开始），返回节点 + 解析后位置
   */
  private parseElement(xml: string, start: number): { node: XmlNode; nextPos: number } {
    const end = xml.indexOf(">", start);
    if (end === -1) throw new Error("XML 元素未闭合");
    const inner = xml.slice(start + 1, end);
    const isSelfClosing = inner.endsWith("/");
    const tagContent = isSelfClosing ? inner.slice(0, -1) : inner;
    const spaceIdx = tagContent.search(/\s/);
    const name = spaceIdx === -1 ? tagContent : tagContent.slice(0, spaceIdx);
    const attrsStr = spaceIdx === -1 ? "" : tagContent.slice(spaceIdx + 1);
    const attrs = this.parseAttrs(attrsStr);

    if (isSelfClosing) {
      return {
        node: { type: "element", name, attrs, rawStart: start, rawEnd: end + 1 },
        nextPos: end + 1,
      };
    }

    // 找匹配的 </name>
    const closeTag = `</${name}>`;
    const closeIdx = xml.indexOf(closeTag, end + 1);
    if (closeIdx === -1) {
      throw new Error(`XML 元素 <${name}> 未闭合（找不到 ${closeTag}）`);
    }
    const innerXml = xml.slice(end + 1, closeIdx);
    const children: XmlNode[] = [];
    let pos = 0;
    while (pos < innerXml.length) {
      const nextSpecial = this.findNextSpecial(innerXml, pos);
      if (nextSpecial === -1) {
        const text = innerXml.slice(pos);
        if (text.length > 0) children.push({ type: "text", value: text });
        break;
      }
      if (nextSpecial > pos) {
        children.push({ type: "text", value: innerXml.slice(pos, nextSpecial) });
      }
      pos = nextSpecial;
      if (innerXml.startsWith(COMMENT_START, pos)) {
        const cEnd = innerXml.indexOf(COMMENT_END, pos + COMMENT_START.length);
        if (cEnd === -1) throw new Error("嵌套注释未闭合");
        children.push({ type: "comment", value: innerXml.slice(pos + COMMENT_START.length, cEnd) });
        pos = cEnd + COMMENT_END.length;
      } else if (innerXml.startsWith(CDATA_START, pos)) {
        const cEnd = innerXml.indexOf(CDATA_END, pos + CDATA_START.length);
        if (cEnd === -1) throw new Error("嵌套 CDATA 未闭合");
        children.push({ type: "cdata", value: innerXml.slice(pos + CDATA_START.length, cEnd) });
        pos = cEnd + CDATA_END.length;
      } else {
        const { node, nextPos } = this.parseElement(innerXml, pos);
        children.push(node);
        pos = nextPos;
      }
    }

    return {
      node: {
        type: "element",
        name,
        attrs,
        children,
        rawStart: start,
        rawEnd: closeIdx + closeTag.length,
      },
      nextPos: closeIdx + closeTag.length,
    };
  }

  /**
   * 解析属性字符串 `Attr1="x" Attr2='y' Attr3="z"`
   */
  private parseAttrs(s: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      attrs[m[1]!] = m[3] ?? m[4] ?? "";
    }
    return attrs;
  }

  /** 转义属性值（& → &amp;，" → &quot;） */
  private escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  /** 找到第一个名为 name 的子元素 */
  private findElement(
    node: XmlNode | undefined,
    name: string,
  ): XmlNode | undefined {
    if (!node) return undefined;
    const children = node.children ?? [];
    return children.find(
      (c: XmlNode): c is XmlNode & { name: string } => c.type === "element" && c.name === name,
    );
  }

  /** 找 path1/path2 二级子元素的文本值 */
  private elementText(
    node: XmlNode | undefined,
    name1: string,
    name2?: string,
  ): string | undefined {
    if (!node) return undefined;
    const c1 = this.findElement(node, name1);
    if (!c1) return undefined;
    if (name2 === undefined) return this.collectText(c1).trim();
    const c2 = this.findElement(c1, name2);
    return c2 ? this.collectText(c2).trim() : undefined;
  }

  /** 找 bool 字段（"true"/"false" 字符串） */
  private elementBool(
    node: XmlNode | undefined,
    name1: string,
    name2?: string,
  ): boolean | undefined {
    const text = this.elementText(node, name1, name2);
    if (text === undefined) return undefined;
    return text.toLowerCase() === "true";
  }

  /** 收集 element 所有 text/cdata 子节点的 value */
  private collectText(node: XmlNode): string {
    if (node.type === "text" || node.type === "cdata") return node.value ?? "";
    const textChildren = (node.children ?? []).filter(
      (c: XmlNode) => c.type === "text" || c.type === "cdata",
    ) as Array<XmlNode & { value: string }>;
    return textChildren.map((c) => c.value ?? "").join("");
  }

  /** 解析 int 或 fallback 默认值 */
  private parseIntOr(
    node: XmlNode | undefined,
    name1: string,
    name2: string | undefined,
    fallback: number,
  ): number {
    const text = this.elementText(node, name1, name2);
    if (text === undefined) return fallback;
    const n = parseInt(text, 10);
    return isNaN(n) ? fallback : n;
  }

  /** 构造一个纯文本子元素 */
  private textElement(name: string, value: string): XmlNode {
    return {
      type: "element",
      name,
      children: [{ type: "text", value }],
    };
  }

  /** 设置子元素文本值（创建或更新；name2 未指定时操作直接子元素） */
  private setElementText(
    node: XmlNode,
    name1: string,
    name2: string | undefined,
    value: string,
  ): void {
    if (name2 === undefined) {
      const existing = this.findElement(node, name1);
      if (existing) {
        existing.children = [{ type: "text", value }];
      } else {
        node.children = [...(node.children ?? []), this.textElement(name1, value)];
      }
      return;
    }
    const parent = this.findElement(node, name1);
    if (parent) {
      const existing = this.findElement(parent, name2);
      if (existing) {
        existing.children = [{ type: "text", value }];
      } else {
        parent.children = [
          ...(parent.children ?? []),
          this.textElement(name2, value),
        ];
      }
    } else {
      // 创建父元素 + 子元素
      node.children = [
        ...(node.children ?? []),
        {
          type: "element",
          name: name1,
          children: [this.textElement(name2, value)],
        },
      ];
    }
  }

  /** 设置 bool 字段（true→"True"，false→"False"） */
  private setElementBool(
    node: XmlNode,
    name1: string,
    name2: string | undefined,
    value: boolean,
  ): void {
    this.setElementText(node, name1, name2, value ? "True" : "False");
  }
}