# crypto.randomUUID HTTP 非安全上下文不可用

前端 `crypto.randomUUID()` 仅在 HTTPS 或 localhost 可用（安全上下文）；通过局域网 IP + HTTP 访问面板时 `crypto.randomUUID` 是 undefined → TypeError。

标准 fallback：`crypto.getRandomValues()` 手写 RFC 4122 v4 UUID（HTTP/HTTPS 均可用，CSPRNG 安全）。

已封装为 `generateUUID()`（manager-web/src/lib/utils.ts），用于 WebSocket 请求的 requestId 生成。
