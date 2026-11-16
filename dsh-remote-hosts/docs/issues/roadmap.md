# 改进路线图

记录日期：2026-11-16。核对环境：dsh 0.2.2-rc.3（macOS 桌面版），插件 0.6.2（提交 `f996666`），CI 通过。

状态取值：待处理 / 进行中 / 已完成 / 已放弃。

此前的 `bugs.md`、`features.md`、`improvements.md` 已全部完成，剩余项并入本文件后删除：
B1/B2/B4/B5/B6、F1–F5、O1–O10 已处理；B3 的“接口来源校验”剩余部分收进 P2-17。

| 编号 | 优先级 | 内容 | 状态 |
|---|---|---|---|
| P0-1 | P0 | 菜单打开时按 Esc 会直接退回会话 | 已完成 |
| P0-2 | P0 | 重启/更新/停止前没有远端活跃会话保护 | 已完成 |
| P0-3 | P0 | 所有托管主机在插件加载时就建立隧道和代理 | 已完成 |
| P0-4 | P0 | 平台悬停 unpin 与插件“侧边栏显示”是两套机制 | 已完成 |
| P0-5 | P0 | 公开仓库/历史文档中的个人信息处置 | 已完成 |
| P1-6 | P1 | 设置卡片缺少“测试连接”和状态徽标 | 已完成 |
| P1-7 | P1 | 切换 SSH/URL 模式会清空另一边的值 | 已完成 |
| P1-8 | P1 | 自动 ID 冲突时直接报错 | 已完成 |
| P1-9 | P1 | 主机多时缺少搜索、拖拽排序、分组 | 已完成 |
| P1-10 | P1 | 远端日志只能一次性 tail，不能跟随 | 已完成 |
| P1-11 | P1 | 没有“可更新”提示 | 已完成 |
| P2-12 | P2 | 同步内容写死（源 profile、key 列表、文件集合） | 已完成 |
| P2-13 | P2 | 更新只支持 npm 全局安装 | 已完成 |
| P2-14 | P2 | 同一主机多个实例各开一条 ssh | 待处理 |
| P2-15 | P2 | SSH 参数不可配置 | 已完成 |
| P2-16 | P2 | 登录 token 的日志格式不可配置 | 已完成 |
| P2-17 | P2 | `/api` 路由缺少来源二次校验（原 B3 剩余项） | 已完成 |
| P2-18 | P2 | 同一主机的更新/重启动作没有互斥 | 已完成 |
| P3-19 | P3 | `client.js` 过大，缺设置热更新的行为测试 | 待处理 |
| P3-20 | P3 | 缺假 ssh 的脚本端到端测试 | 待处理 |
| P3-21 | P3 | CI 只有 Ubuntu/Node 24，缺 LICENSE/CHANGELOG/截图 | 待处理 |

## P0：稳定性与安全

### P0-1 菜单打开时按 Esc 会直接退回会话

- 现状：远程视图的全局 keydown 处理无条件调用 `backToLocal()`，操作菜单展开时按 Esc 会退出远程视图而不是关闭菜单。
- 依据：`client.js` 的 RemoteView `onKey`（`if (event.key === 'Escape') backToLocal()`）。
- 做法：keydown 先判断 `menuOpen`；展开时只关闭菜单并阻止事件，未展开时才返回会话。
- 验收：菜单展开时 Esc 只关菜单；菜单关闭后 Esc 仍返回会话。

### P0-2 重启/更新/停止前没有远端活跃会话保护

- 现状：确认框只提示“会中断远端会话”，无法判断远端是否真的在跑任务。`bin/remote.sh probe` 已经返回 `sessions`（最近 10 分钟内有写入的会话数/最新 mtime/id 摘要），但 Host 路由和 UI 都没有使用它；`bin/update.sh`、`bin/sync.sh --restart`、`service restart|stop` 仍直接执行。
- 做法：
  - 复用 probe 已有的 `sessions` 字段，把检测窗口做成参数（默认 10 分钟）。
  - Host 在执行会重启/停止服务的动作前检查该字段；活跃时返回可识别的错误码与摘要，UI 用二次确认提供“仍然执行”。
  - 空闲时不增加额外操作，保持一步完成。
- 验收：远端空闲时一键更新/重启；有活跃会话时默认拦截并显示原因，明确选择后才继续。

### P0-3 所有托管主机在插件加载时就建立隧道和代理

- 现状：`reconcile()` 对每个 `sshHost` 行调用 `link.start()`，插件加载就产生 N 条 ssh 和 N 个本地代理端口，主机多时浪费连接、端口和电量。
- 依据：`index.js` 的 `reconcile()` / `ServerLink.start()`；`lib/tunnel.js` 每条连接一个 ssh 进程。
- 做法：
  - `ServerLink` 增加 activated 状态与 `activate()` / `deactivate()`；客户端打开该主机时调用 `POST /api/remote-hosts/activate`。
  - 未被激活的主机在 status 里显示为 dormant（不显示离线错误），打开后才显示 connecting。
  - 空闲 TTL（默认 10 分钟，可配）后停止隧道/代理；正在显示的 frame 所在主机不停止。
- 验收：启动后只有被访问过的主机建立连接；关闭一段时间后进程消失；再次打开能自动重连。

### P0-4 平台悬停 unpin 与插件“侧边栏显示”是两套机制

- 现状：平台 sidebar 的 pin 状态是内存态（panel-pins.ts），重启复位；插件的 `sidebar` 配置是持久的。用户点错悬停 unpin 后，可能会以为设置开关失效。
- 做法：设置页 hint、README 和错误提示里说明两者区别；设置卡片提供“恢复全部侧边栏显示”的快捷操作或提示；平台 pin 无法被插件读取/控制的部分写进文档。
- 验收：文档与 UI 文案能解释两个 pin 的来源和复位行为。

### P0-5 公开仓库/历史文档中的个人信息处置

- 现状：仓库为 public；旧 `docs/issues` 已删除，但 README/提交历史里仍可能有本机路径、SSH 别名、LaunchAgent 名称等。
- 做法：全仓 grep 个人路径/主机别名/邮箱；决定仓库 private 或重写历史；以后文档只写占位符（user@host、/path/to）。
- 验收：仓库内不再有可识别的本机路径和主机别名；如保持 public，README 的安装示例使用占位符。
- 处置：工作区已清理——主机别名改为 `user@host`/`gpu-1`，README、脚本注释与设置占位符不再出现真实别名；全仓 grep 无本机路径、邮箱或 LaunchAgent 名。提交历史仍含旧文档中的本机路径、旧别名和作者邮箱，但历史中没有密钥或 token；决定保持 public、不重写历史（重写会更换全部提交哈希，也无法清除 fork/缓存），如以后介意可转 private。

## P1：配置与使用体验

### P1-6 设置卡片缺少“测试连接”和状态徽标

- 做法：卡片增加“测试连接”动作，调用 `POST /api/remote-hosts/probe`，在卡片摘要行显示 dsh 版本、service 状态、端口 HTTP；失败显示原因（ssh/auth/端口）。
- 验收：保存配置后无需打开浮层即可确认远端可用，并看到版本。

### P1-7 切换 SSH/URL 模式会清空另一边的值

- 现状：模式切换通过清空 `sshHost` 或 `url` 实现，误点一次就要重填。
- 做法：草稿保留两套隐藏值，模式只决定提交哪一侧；或在切换时提示并允许撤销。
- 验收：SSH 与 URL 来回切换不丢已填内容。

### P1-8 自动 ID 冲突时直接报错

- 现状：ID 留空时从名称/主机派生；两个同名主机会报“id 重复”，必须展开高级设置修改。
- 做法：派生 ID 冲突时自动加 `-2`、`-3` 后缀并在高级设置里显示最终值。
- 验收：新增两个同名主机可直接保存。

### P1-9 主机多时缺少搜索、拖拽排序、分组

- 做法：设置页和浮层切换器支持按名称/主机过滤；卡片支持拖拽排序（保留上下箭头作为降级）；按 sshHost 分组。
- 验收：20 台以上仍能快速定位和调整顺序。

### P1-10 远端日志只能一次性 tail，不能跟随

- 做法：`/api/remote-hosts/logs` 增加 follow 模式（NDJSON 流），复用现有流式日志面板，提供“停止跟随”。
- 验收：日志面板能持续追加新行并正常停止。

### P1-11 没有“可更新”提示

- 做法：probe 返回远端 dsh 版本后，与本机版本或该行 `updateChannel` 解析出的目标版本比较，卡片/切换器显示 badge；不自动安装。
- 验收：打开主机或打开设置时能看出哪些主机落后。

## P2：通用性与兼容

### P2-12 同步内容写死

- 现状：`bin/sync.sh` 源 profile 固定 `desktop`，key 固定 `OPENCODE_GO_API_KEY`、`VPS_CC_API_KEY`，每次都推送 AGENTS.md 和 patch。
- 做法：配置增加 `syncSourceProfile`、`syncKeys`（逗号分隔或数组）、`syncAgents`/`syncPatch` 开关；脚本参数化，Host 下发。
- 验收：不写代码即可改同步来源和 key 集合。

### P2-13 更新只支持 npm 全局安装

- 现状：`bin/update.sh` 要求 service 的 Node 前缀下有 npm 全局 `@deepseek-ai/dsh`，否则报错退出。
- 做法：探测 pnpm 全局布局或 standalone 安装方式，按结果选择升级命令；无法识别时输出诊断并说明手工步骤。
- 验收：pnpm 安装的远端也能一键更新；未知布局给出可操作提示。

### P2-14 同一主机多个实例各开一条 ssh

- 做法：同一 sshHost 的多个端点复用一条 ssh 连接（ControlMaster/ControlPath 或单次 spawn 多 `-L`），连接数按主机而不是端点增长。
- 验收：一台主机配 3 个实例时只有一条 ssh 进程。

### P2-15 SSH 参数不可配置

- 做法：端点增加可选 `sshOptions`（跳板、IdentityFile、端口、超时）；只允许白名单参数并做转义，避免把配置变成任意命令。
- 验收：不依赖 `~/.ssh/config` 也能连上跳板/非默认端口。

### P2-16 登录 token 的日志格式不可配置

- 做法：增加 `tokenPattern`（正则）或 `tokenCommand`（白名单模板），替代 `lib/proxy.js` 里固定的 `token=[A-Za-z0-9_-]+`。
- 验收：remoteLog 格式变化时改配置即可恢复登录。

### P2-17 /api 路由缺少来源二次校验（原 B3 剩余项）

- 现状：所有路由位于 `/api/remote-hosts/`，依赖平台“需要活跃浏览器会话”的约束；处理函数本身不检查 Host/Origin/Sec-Fetch-Site/content-type。
- 做法：在路由入口统一校验：Host 必须是回环地址、拒绝外来 Origin、拒绝 cross-site 的 POST、要求 `application/json`；与代理层的 `checkRequest()` 保持同一套规则。
- 验收：本地 curl 带 cookie 仍可用；伪造 Origin/cross-site/text-plain 请求返回 4xx。

### P2-18 同一主机的更新/重启动作没有互斥

- 做法：Host 每个端点的动作加锁（in-flight Set）；同主机第二次动作返回“已有操作进行中”；客户端按钮在请求期间禁用。
- 验收：连点或两个窗口同时触发时只有一个动作执行。

## P3：工程质量

### P3-19 client.js 过大，缺设置热更新的行为测试

- 现状：`client.js` 约 1600 行，状态、视图和内联 CSS 混在一起；测试只覆盖模块加载与 locale 一致性。
- 做法：拆成 settings / overlay / store 模块；把“设置保存 → 侧边栏注册变化”抽成可测函数；补 node 测试。
- 验收：单文件明显变小；热更新路径有测试覆盖。

### P3-20 缺假 ssh 的脚本端到端测试

- 做法：在测试里把 `ssh` 替换成脚本 shim，模拟 probe 输出、service 成功/失败、日志 tail；覆盖 `bin/remote.sh`、`bin/update.sh`、`bin/sync.sh` 的主要分支。
- 验收：不依赖真实远端也能在 CI 跑通脚本主流程。

### P3-21 CI 只有 Ubuntu/Node 24，缺 LICENSE/CHANGELOG/截图

- 做法：加 Node 24/26 matrix 和 shellcheck；补 LICENSE、CHANGELOG；README 放 1–2 张界面截图；同步清理过时文档。
- 验收：CI 全绿；仓库首页有许可证、变更记录和可看的效果图。
