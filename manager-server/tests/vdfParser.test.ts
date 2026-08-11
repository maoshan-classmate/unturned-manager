import { describe, it, expect } from 'vitest';
import {
  parseVdf,
  serializeVdf,
  VdfParseError,
  VdfSerializeError,
} from '../src/modules/workshop/VdfParser.js';

describe('VdfParser · parseVdf', () => {
  it('解析简单键值对', () => {
    const text = `"AppWorkshop"
{
    "appid"        "304930"
}`;
    expect(parseVdf(text)).toEqual({
      AppWorkshop: { appid: '304930' },
    });
  });

  it('解析嵌套对象（3 层）', () => {
    const text = `"AppWorkshop"
{
    "appid"        "304930"
    "WorkshopItemsInstalled"
    {
        "1753134636"
        {
            "timeupdated"        "1722612345"
            "size"                "12345678"
            "manifest"            "4567890123456789"
        }
    }
}`;
    expect(parseVdf(text)).toEqual({
      AppWorkshop: {
        appid: '304930',
        WorkshopItemsInstalled: {
          '1753134636': {
            timeupdated: '1722612345',
            size: '12345678',
            manifest: '4567890123456789',
          },
        },
      },
    });
  });

  it('处理转义引号', () => {
    const text = `"root"
{
    "key"        "val\\"ue\\\\test"
}`;
    expect(parseVdf(text)).toEqual({
      root: { key: 'val"ue\\test' },
    });
  });

  it('跳过 // 行注释', () => {
    const text = `"root"
// 这是注释
{
    "key"        "value"  // 行尾注释
}`;
    expect(parseVdf(text)).toEqual({
      root: { key: 'value' },
    });
  });

  it('跳过 /* */ 块注释', () => {
    const text = `"root"
/* 块注释
   多行 */
{
    "key"        "value"
}`;
    expect(parseVdf(text)).toEqual({
      root: { key: 'value' },
    });
  });

  it('处理空对象', () => {
    const text = `"root"
{
    "empty"        {}
    "key"        "value"
}`;
    expect(parseVdf(text)).toEqual({
      root: {
        empty: {},
        key: 'value',
      },
    });
  });

  it('处理真实 acf fixture（SteamCMD 实际输出格式）', () => {
    const text = `"AppWorkshop"
{
	"appid"		"304930"
	"WorkshopItemsInstalled"
	{
		"1753134636"
		{
			"timeupdated"		"1722612345"
			"size"				"12345678"
			"manifest"			"4567890123456789"
		}
		"1234567890"
		{
			"timeupdated"		"1722612789"
			"size"				"9876543"
			"manifest"			"9876543210987654"
		}
	}
}`;
    const parsed = parseVdf(text);
    expect(parsed).toEqual({
      AppWorkshop: {
        appid: '304930',
        WorkshopItemsInstalled: {
          '1753134636': {
            timeupdated: '1722612345',
            size: '12345678',
            manifest: '4567890123456789',
          },
          '1234567890': {
            timeupdated: '1722612789',
            size: '9876543',
            manifest: '9876543210987654',
          },
        },
      },
    });
  });

  it('未闭合引号抛 VdfParseError', () => {
    const text = `"root"
{
    "key        "value"
}`;
    expect(() => parseVdf(text)).toThrow(VdfParseError);
  });

  it('未闭合大括号抛 VdfParseError', () => {
    const text = `"root"
{
    "key"        "value"
`;
    expect(() => parseVdf(text)).toThrow(VdfParseError);
  });

  it('根 key 后缺 { 抛 VdfParseError', () => {
    const text = `"root"
"orphan"
`;
    expect(() => parseVdf(text)).toThrow(VdfParseError);
  });
});

describe('VdfParser · serializeVdf', () => {
  it('序列化后 parseVdf 还原（往返一致）', () => {
    const original = {
      AppWorkshop: {
        appid: '304930',
        WorkshopItemsInstalled: {
          '1753134636': {
            timeupdated: '1722612345',
            size: '12345678',
            manifest: '4567890123456789',
          },
        },
      },
    };
    const text = serializeVdf(original);
    const parsed = parseVdf(text);
    expect(parsed).toEqual(original);
  });

  it('转义键/值中的引号和反斜杠', () => {
    const obj = {
      root: {
        'key with "quote"': 'value with \\ backslash',
      },
    };
    const text = serializeVdf(obj);
    expect(text).toContain('\\"quote\\"');
    expect(text).toContain('\\\\');
    // 往返
    expect(parseVdf(text)).toEqual(obj);
  });

  it('根对象多个 key 抛 VdfSerializeError', () => {
    expect(() => serializeVdf({ a: {}, b: {} })).toThrow(VdfSerializeError);
  });

  it('根对象零个 key 抛 VdfSerializeError', () => {
    expect(() => serializeVdf({})).toThrow(VdfSerializeError);
  });

  it('空对象子块', () => {
    const text = serializeVdf({ root: { empty: {} } });
    expect(text).toContain('"empty"');
    expect(text).toContain('{');
    expect(parseVdf(text)).toEqual({ root: { empty: {} } });
  });
});
