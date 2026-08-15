# PTY 写入行末必须是 LF（\n）

向 U3DS 持久终端（node-pty 起 bash 中转）写入命令时，行末必须用 LF（\n）而非 CR（\r）。

- U3-SDK `-ThreadedConsole` 的 `ThreadedConsoleInputOutput.consoleMain` 用 `Console.ReadLine()`，以 LF 为行终止符
- `\r` 在终端模式变化后不触发行结束 → ReadLine 阻塞 → 命令到 U3DS 但不执行
- 涉及命令：`Save`、`Shutdown`、`/rocket`、启动命令、`exit`
- GSM3 用 `\r` 能工作是因为直接 spawn 目标进程（无 bash 中转层）

真源：U3-SDK `ThreadedConsoleInputOutput.cs`（Console.ReadLine LF 终止）。
