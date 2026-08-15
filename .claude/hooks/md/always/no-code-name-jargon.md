# 禁止代码名+中文描述

> 内容来源：CLAUDE.md §2 铁律 #1。
> 本文件由 UserPromptSubmit hook 永久注入到每轮对话上下文。

## 总原则

所有输出内容——终端输出、文档输出、架构设计输出、工作流输出、测试输出、任务清单输出——严令禁止「代码名+中文」或「行内术语」的描述方式，人类开发者难以理解。

## 反面示例

```
让 `installU3DS` / `updateU3DS` / `reinstall` / `checkUpdate` / `downloadWorkshopItem` 全部异步
用户没填 startCommand 时，detectStartScript 自动生成 `./ServerHelper.sh +InternetServer/<id> -ThreadedConsole`
```

## 正面示例

```
让 U3DS 相关操作和下载创意工坊模组的操作全部异步
用户没填开始命令时，检测启动脚本自动生成以下内容：`./ServerHelper.sh +InternetServer/<id> -ThreadedConsole`
```

## 适用范围

- 终端输出（Claude 给用户看的命令结果摘要）
- 文档输出（架构设计、Sprint 总结、规范说明）
- 工作流输出（Sprint 规划、任务清单、commit message 草稿）
- 测试输出（测试计划、用例描述、覆盖说明）
- 任务清单输出（TodoWrite / TaskCreate 的 subject + description）