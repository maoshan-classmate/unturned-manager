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
  });
});