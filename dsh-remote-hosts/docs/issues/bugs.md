# 需要修复的问题

记录日期：2026-11-11。核对环境：dsh 0.2.2-rc.1（macOS 桌面版），插件提交 `42de6ed`。

每条都写明了依据是“实测”还是“读代码”。状态取值：待处理 / 已修复 / 部分修复。

| 编号 | 问题 | 状态 |
|---|---|---|
| B1 | 同步失败时界面只显示“HTTP 200” | 待处理 |
| B2 | Esc 返回本地会话不生效 | 待处理 |
| B3 | 同步接口没有访问校验 | 待处理 |
| B4 | 本地代理替任何来访者带上登录态 | 待处理 |
| B5 | `sync.sh` 对 `- insert:` 条目的处理不确定 | 待处理 |
| B6 | `sync.sh` 在没有找到 key 时计数输出两行 | 待处理 |

## B1 同步失败时界面只显示“HTTP 200”

- 位置：`client.js` 的 `sync()`，`index.js` 的 `execFile` 回调，`bin/sync.sh`。
- 现象：同步失败后，按钮旁边只出现“同步失败：HTTP 200”，看不出原因。
- 原因：
  - 浏览器端只读 `payload.stderr` 和 `payload.error`。Host 端从不填 `error`，而脚本的大部分提示写在 stdout。
  - 超时被杀时 `error.code` 不是数字，Host 端返回 `code: 0`，同样没有说明。
- 依据（实测，模拟 Host 端返回再套用浏览器端的表达式）：

  | 失败情形 | 界面文字 |
  |---|---|
  | 缺少 patch 文件（提示在 stdout，退出码 1） | 同步失败：HTTP 200 |
  | 重启后 `is-active` 输出 `failed`（stdout，退出码 3） | 同步失败：HTTP 200 |
  | 脚本超时被杀 | 同步失败：HTTP 200 |
  | ssh 连接失败（stderr，退出码 255） | 能正常显示 ssh 的报错 |

- 修法：Host 端统一生成一条 `error` 文字（超时、退出码、stderr 或 stdout 的最后几行）；脚本的错误提示改写到 stderr。

## B2 Esc 返回本地会话不生效

- 位置：`client.js` 的 `RemoteView` 里的 `useEffect`。
- 现象：远程视图打开时按 Esc 没有反应。
- 原因：`onKey` 定义了，但没有 `addEventListener`。
- 依据：读代码。
- 已知限制：远程页面在跨源 iframe 里，焦点在 iframe 内时按键不会传到外层。这是浏览器的行为，修复后 Esc 只在焦点位于外层（顶栏、侧边栏）时有效。

## B3 同步接口没有访问校验

- 位置：`index.js` 的 `/remote-hosts/sync`。
- 现象：这个接口会把本地配置和 API key 推到远端并重启远端服务，但不校验调用方。
- 依据：
  - 实测：对桌面端 Host 端口发不带 cookie 的 GET，以及带 `Origin: https://example.com` 的 GET，都直接到达了插件的处理函数（返回 405 `POST only`）。
  - 读代码：处理函数不检查 `Origin`、`Host`、`content-type`。平台文档写明 web server 本身不做认证和来源策略，由注册路由的插件自己负责。
  - POST 没有实测，因为会真的重启远端。
- 影响：浏览器里的任意网页可以用不触发预检的“简单请求”调用它；本机任意进程也可以。
- 修法：校验 `Host` 是回环地址、拒绝外来 `Origin` 和跨站请求、要求 `content-type: application/json`。

## B4 本地代理替任何来访者带上登录态

- 位置：仓库外的 `~/Documents/deepseek-harness/default-workspace/dsh-remote-proxy.mjs`（监听 `127.0.0.1:27994`）。
- 现象：代理给每个请求都附上远端的登录 cookie，并把 `Origin` 改写成上游地址，WebSocket 也一样。
- 依据：读代码，没有实际验证。
- 影响：本机浏览器里的任意网页都可能通过这个端口操作远端 dsh，远端自己的来源检查被代理绕过。
- 修法：把代理收进插件（见 `features.md` 的 F2），并在代理里校验 `Host`、`Origin` 和 `Sec-Fetch-Site`。

## B5 `sync.sh` 对 `- insert:` 条目的处理不确定

- 位置：`bin/sync.sh` 的 awk 过滤。
- 现象：过滤只认 `- id:` 开头的条目，其他顶层条目的去留取决于它在文件里的位置。
- 依据（实测，样例输入）：
  - 第一个 `- id:` 之前的 `- insert:` 被丢弃。
  - 紧跟在 `ui-settings-account` 之后的 `- insert:` 被当成它的一部分一起丢弃。
  - 跟在其他 `- id:` 之后的 `- insert:` 会被保留。
- 影响：当前的 desktop patch 里没有 `- insert:`，所以还没有触发。
- 修法：按顶层条目切分。`- insert:` 引用的是本机安装的插件，远端通常没有装，带过去可能让远端服务起不来，所以统一跳过，并在输出里写明跳过了几条。

## B6 `sync.sh` 在没有找到 key 时计数输出两行

- 位置：`bin/sync.sh` 的 `keys:` 一行。
- 现象：`grep -c` 没有匹配时会输出 `0` 并返回非零，后面的 `|| echo 0` 又输出一个 `0`。
- 依据：实测，输出为 `0` 换行 `0`。
- 修法：去掉多余的 `|| echo 0`。
