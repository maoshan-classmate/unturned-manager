import { describe, it, expect } from "vitest";
import { RocketConfigXmlParser } from "../src/modules/ldm/RocketConfigXmlParser.js";

const parser = new RocketConfigXmlParser();

describe("RocketConfigXmlParser", () => {
  describe("parseRocketConfig / serializeRocketConfig（结构化字段）", () => {
    it("注释保留：原文含 `<!-- comment -->`，序列化后保留", () => {
      const xml = `<?xml version="1.0"?>
<RocketConfiguration>
  <!-- 用户配置：保持 60 帧 -->
  <LanguageCode>en</LanguageCode>
  <MaxFrames>60</MaxFrames>
</RocketConfiguration>`;
      const { fields } = parser.parseRocketConfig(xml);
      const newXml = parser.serializeRocketConfig(
        { ...fields, maxFrames: 120 },
        xml,
      );
      expect(newXml).toContain("<!-- 用户配置：保持 60 帧 -->");
    });

    it("属性顺序保留：原文 <Tag Attr1='x' Attr2='y'>，序列化后顺序不变", () => {
      const xml = `<RocketConfiguration Attr1="x" Attr2="y" Attr3="z"><LanguageCode>en</LanguageCode></RocketConfiguration>`;
      const { fields } = parser.parseRocketConfig(xml);
      const newXml = parser.serializeRocketConfig(fields, xml);
      const match = newXml.match(/<RocketConfiguration[^>]*>/);
      expect(match?.[0]).toBe('<RocketConfiguration Attr1="x" Attr2="y" Attr3="z">');
    });

    it("CDATA 保留：原文 `<![CDATA[...]]>` 序列化后原样", () => {
      const xml = `<RocketConfiguration><Description><![CDATA[Some <raw> data]]></Description><LanguageCode>en</LanguageCode></RocketConfiguration>`;
      const tree = parser.parseGeneric(xml);
      const newXml = parser.serializeGeneric(tree);
      expect(newXml).toContain("<![CDATA[Some <raw> data]]>");
    });

    it("嵌套保留：3 层嵌套结构，序列化后结构一致", () => {
      const xml = `<RocketConfiguration><Group><Sub><Item>1</Item></Sub></Group><LanguageCode>en</LanguageCode></RocketConfiguration>`;
      const tree = parser.parseGeneric(xml);
      const newXml = parser.serializeGeneric(tree);
      expect(newXml).toContain("<Group><Sub><Item>1</Item></Sub></Group>");
    });

    it("未知键保留：原文含 `<UnknownKey>foo</UnknownKey>` 不在 fields 中，序列化后保留", () => {
      const xml = `<RocketConfiguration><LanguageCode>en</LanguageCode><UnknownKey>keep-me</UnknownKey></RocketConfiguration>`;
      const { fields } = parser.parseRocketConfig(xml);
      const newXml = parser.serializeRocketConfig(fields, xml);
      expect(newXml).toContain("<UnknownKey>keep-me</UnknownKey>");
    });

    it("文本节点保留：`<Tag>text content</Tag>` 中间文本不丢", () => {
      const xml = `<RocketConfiguration><Description>this is text content</Description><LanguageCode>en</LanguageCode></RocketConfiguration>`;
      const tree = parser.parseGeneric(xml);
      const newXml = parser.serializeGeneric(tree);
      expect(newXml).toContain("this is text content");
    });

    it("字段合并：改 LanguageCode，其他字段未改", () => {
      const xml = `<RocketConfiguration>
  <LanguageCode>en</LanguageCode>
  <MaxFrames>60</MaxFrames>
  <AutomaticShutdown>
    <Enabled>False</Enabled>
    <Interval>86400</Interval>
  </AutomaticShutdown>
  <WebPermissions>
    <Enabled>True</Enabled>
    <Url>https://example.com</Url>
    <Interval>180</Interval>
  </WebPermissions>
</RocketConfiguration>`;
      const { fields } = parser.parseRocketConfig(xml);
      const newXml = parser.serializeRocketConfig(
        { ...fields, languageCode: "zh-CN" },
        xml,
      );
      expect(newXml).toContain("<LanguageCode>zh-CN</LanguageCode>");
      expect(newXml).toContain("<MaxFrames>60</MaxFrames>");
      expect(newXml).toContain("<Interval>86400</Interval>");
    });

    it("Round-trip：parseRocketConfig → serializeRocketConfig → parseRocketConfig = 等价", () => {
      const xml = `<RocketConfiguration>
  <LanguageCode>en</LanguageCode>
  <MaxFrames>60</MaxFrames>
  <AutomaticShutdown>
    <Enabled>False</Enabled>
    <Interval>86400</Interval>
  </AutomaticShutdown>
  <WebPermissions>
    <Enabled>True</Enabled>
    <Url>https://example.com</Url>
    <Interval>180</Interval>
  </WebPermissions>
</RocketConfiguration>`;
      const { fields: f1, raw: r1 } = parser.parseRocketConfig(xml);
      const newXml = parser.serializeRocketConfig(f1, r1);
      const { fields: f2 } = parser.parseRocketConfig(newXml);
      expect(f2).toEqual(f1);
    });
  });

  describe("parsePermissionsConfig / serializePermissionsConfig（树形）", () => {
    it("基本 2 组（default + vip）解析正确", () => {
      const xml = `<?xml version="1.0"?>
<RocketPermissions>
  <DefaultGroup>default</DefaultGroup>
  <Groups>
    <Group>
      <Id>default</Id>
      <DisplayName>Player</DisplayName>
      <Color>white</Color>
      <Priority>100</Priority>
      <Permissions>
        <Permission>rocket.kits</Permission>
      </Permissions>
    </Group>
    <Group>
      <Id>vip</Id>
      <DisplayName>VIP</DisplayName>
      <Color>yellow</Color>
      <ParentGroup>default</ParentGroup>
      <Priority>50</Priority>
      <Permissions>
        <Permission>rocket.warp</Permission>
      </Permissions>
    </Group>
  </Groups>
</RocketPermissions>`;
      const { fields } = parser.parsePermissionsConfig(xml);
      expect(fields.defaultGroup).toBe("default");
      expect(fields.groups.length).toBe(2);
      expect(fields.groups[0]?.id).toBe("default");
      expect(fields.groups[1]?.parentGroup).toBe("default");
      expect(fields.groups[1]?.color).toBe("yellow");
    });

    // ─── Phase 5 §4.1：未知子元素 + 未知属性保留 ───

    it("未知子元素 <Notes> 保留（不在 7 个已知字段中）", () => {
      const xml = `<?xml version="1.0"?>
<RocketPermissions>
  <DefaultGroup>default</DefaultGroup>
  <Groups>
    <Group>
      <Id>default</Id>
      <DisplayName>Player</DisplayName>
      <Color>white</Color>
      <Priority>100</Priority>
      <Notes>原始注释：默认组</Notes>
    </Group>
  </Groups>
</RocketPermissions>`;
      const fields = parser.parsePermissionsConfig(xml).fields;
      const modified = parser.serializePermissionsConfig(fields, xml);
      expect(modified).toContain("<Notes>原始注释：默认组</Notes>");
    });

    it("未知属性 IsHidden=\"true\" 保留", () => {
      const xml = `<?xml version="1.0"?>
<RocketPermissions>
  <Groups>
    <Group IsHidden="true" CustomFlag="legacy">
      <Id>default</Id>
      <DisplayName>Player</DisplayName>
      <Color>white</Color>
      <Priority>100</Priority>
    </Group>
  </Groups>
</RocketPermissions>`;
      const fields = parser.parsePermissionsConfig(xml).fields;
      const modified = parser.serializePermissionsConfig(fields, xml);
      expect(modified).toContain('IsHidden="true"');
      expect(modified).toContain('CustomFlag="legacy"');
    });

    it("改已知字段（color）+ 未知键同时保留", () => {
      const xml = `<?xml version="1.0"?>
<RocketPermissions>
  <Groups>
    <Group>
      <Id>vip</Id>
      <DisplayName>VIP</DisplayName>
      <Color>white</Color>
      <Priority>50</Priority>
      <Notes>VIP 备注</Notes>
    </Group>
  </Groups>
</RocketPermissions>`;
      const fields = parser.parsePermissionsConfig(xml).fields;
      // 改 color
      const modified = parser.serializePermissionsConfig(
        { ...fields, groups: [{ ...fields.groups[0], color: "yellow" }] },
        xml,
      );
      // 已知字段更新生效
      expect(modified).toContain("<Color>yellow</Color>");
      // 未知子元素保留
      expect(modified).toContain("<Notes>VIP 备注</Notes>");
      // 其他已知字段保留
      expect(modified).toContain("<Priority>50</Priority>");
    });
  });

  describe("parseRocketUnturnedConfig / serializeRocketUnturnedConfig（9 字段）", () => {
    const SAMPLE = `<?xml version="1.0"?>
<RocketConfiguration>
  <AutomaticSave>
    <Enabled>true</Enabled>
    <Interval>1800</Interval>
  </AutomaticSave>
  <CharacterNameValidation>false</CharacterNameValidation>
  <CharacterNameValidationRule>([\\x00-\\AA]|[\\w_\\ \\.\\+\\-])+</CharacterNameValidationRule>
  <LogSuspiciousPlayerMovement>true</LogSuspiciousPlayerMovement>
  <EnableItemBlacklist>false</EnableItemBlacklist>
  <EnableItemSpawnLimit>false</EnableItemSpawnLimit>
  <MaxSpawnAmount>10</MaxSpawnAmount>
  <EnableVehicleBlacklist>false</EnableVehicleBlacklist>
</RocketConfiguration>`;

    it("解析 9 字段完整", () => {
      const { fields } = parser.parseRocketUnturnedConfig(SAMPLE);
      expect(fields.automaticSaveEnabled).toBe(true);
      expect(fields.automaticSaveInterval).toBe(1800);
      expect(fields.characterNameValidation).toBe(false);
      expect(fields.enableVehicleBlacklist).toBe(false);
      expect(fields.maxSpawnAmount).toBe(10);
    });

    it("字段合并：改 automaticSaveInterval + 未知键保留（P0-2 回归）", () => {
      // ★ P0-2 回归：之前 serializeRocketUnturnedConfig 用 findElement 找根元素永远找不到，
      //   任何字段修改都不写回（返回原文）。修复后 root = tree，字段合并生效。
      const modified = parser.serializeRocketUnturnedConfig(
        { ...parser.parseRocketUnturnedConfig(SAMPLE).fields, automaticSaveInterval: 600 },
        SAMPLE,
      );
      // 修改生效
      expect(modified).toContain("<Interval>600</Interval>");
      // 未改字段保留（Enabled 仍是 true——setElementBool 输出 .NET PascalCase True/False）
      expect(modified).toContain("<Enabled>True</Enabled>");
      // 原 XML 结构未破坏（根元素还在）
      expect(modified).toContain("<RocketConfiguration>");
      // round-trip：再解析得到修改后的字段
      const reparsed = parser.parseRocketUnturnedConfig(modified);
      expect(reparsed.fields.automaticSaveInterval).toBe(600);
      expect(reparsed.fields.automaticSaveEnabled).toBe(true);
    });

    it("注释保留 + 修改字段并存", () => {
      const xml = `<?xml version="1.0"?>
<RocketConfiguration>
  <!-- 自动存档设置 -->
  <AutomaticSave>
    <Enabled>true</Enabled>
    <Interval>1800</Interval>
  </AutomaticSave>
</RocketConfiguration>`;
      const modified = parser.serializeRocketUnturnedConfig(
        { ...parser.parseRocketUnturnedConfig(xml).fields, automaticSaveEnabled: false },
        xml,
      );
      expect(modified).toContain("<!-- 自动存档设置 -->");
      expect(modified).toContain("<Enabled>False</Enabled>");
    });
  });
});