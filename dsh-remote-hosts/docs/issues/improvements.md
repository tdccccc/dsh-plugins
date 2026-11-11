# 可以优化的地方

记录日期：2026-11-11。核对环境：dsh 0.2.2-rc.1（macOS 桌面版），插件提交 `42de6ed`。

这些不是功能错误，但会让插件难维护或体验差。状态取值：待处理 / 已处理 / 部分处理。

| 编号 | 内容 | 状态 |
|---|---|---|
| O1 | 服务器列表写了三份 | 待处理 |
| O2 | 代理和 SSH 隧道不在仓库里 | 待处理 |
| O3 | 没有清理逻辑 | 待处理 |
| O4 | 侧边栏状态靠 DOM 猜 | 待处理 |
| O5 | macOS 侧边栏收起时顶栏被遮挡、窗口拖不动 | 待处理 |
| O6 | 同步体验 | 待处理 |
| O7 | iframe 背景写死白色 | 待处理 |
| O8 | 界面文字写死中文 | 待处理 |
| O9 | `package.json` 和 README 的过时内容 | 待处理 |
| O10 | 桌面 profile 的 lockfile 指向旧路径 | 待处理 |

## O1 服务器列表写了三份

- `client.js` 的 `SERVERS`、`index.js` 的 `HOSTS`、`servers.js` 各有一份。
- `servers.js` 没有任何地方引用（实测：全仓库搜索无引用）。
- 加一台主机要改两处代码，漏改一处就会出现“能打开但不能同步”。
- 建议：服务器列表放进插件配置，由 Host 端下发给浏览器端。见 `features.md` 的 F1。

## O2 代理和 SSH 隧道不在仓库里

- 它们在 `~/Documents/deepseek-harness/default-workspace/`，靠手动启动（实测：`ssh` 监听 27993，`node dsh-remote-proxy.mjs` 监听 27994）。
- 它们挂掉时 iframe 只是一片空白，插件不知道也不提示。
- 建议：见 `features.md` 的 F2 和 F3。

## O3 没有清理逻辑

- `client.js` 给 `document` 加的点击监听只加不删，插件重载后会叠加。
- 同类插件（如 `dsh-dragon-maid-pet`）都用 `ctx.effect(() => 清理函数)` 注册。
- 建议：所有监听和注册都通过 `ctx.effect` 管理。

## O4 侧边栏状态靠 DOM 猜

- 现在的做法：`querySelector('nav')` 量宽度、400ms 轮询、从点击目标向上遍历 6 层找自己的图标。
- 平台给 `shell.overlay` 的组件传了 `usePanelInfo`，可以直接读 `activePanelId`（依据：布局包源码和 `dsh-dragon-maid-pet` 的用法）。
- 建议：选中状态改读 `usePanelInfo`。宽度仍需测量，因为平台没有公开侧边栏宽度，但可以去掉轮询里不必要的部分。

## O5 macOS 侧边栏收起时顶栏被遮挡、窗口拖不动

- 依据：布局包文档，没有实际看界面。
- 侧边栏收起后整列隐藏，左上角 160px（全屏时 84px）是红绿灯和控件区。插件顶栏的“← 本地会话”按钮会落在它下面。
- 平台提供 `--dsh-frame-leading-clearance` 让内容避让。
- 顶栏没有 `data-window-drag` 标记，覆盖在窗口顶带上之后这一段可能拖不动窗口。
- 建议：顶栏左内边距使用 `--dsh-frame-leading-clearance`，并给顶栏加 `data-window-drag`。

## O6 同步体验

- 一次请求最长阻塞 5 分钟，期间没有进度。
- 点击后直接重启远端服务，没有确认；重启会中断远端正在跑的会话。
- 重启完成后 iframe 不会自动刷新。
- 建议：见 `features.md` 的 F4。

## O7 iframe 背景写死白色

- `client.js` 里 iframe 的 `background: '#fff'`，深色主题下加载时会闪白。
- 建议：改用主题变量。

## O8 界面文字写死中文

- 顶栏的按钮和提示都是中文，而当前 locale 配置是 `en`。
- 建议：用平台的 `ctx.locale` 注册中英两套文案。

## O9 `package.json` 和 README 的过时内容

- `package.json` 的描述还写着“在右侧栏打开”，实际是覆盖在主区域。
- `dsh.client.inject` 里有 `@deepseek-ai/dsh-client-ui-sidebar-right`，代码里没有用到。
- README 的安装命令写的是仓库根目录 `/Users/tiandc/dsh`，插件实际在 `dsh-remote-hosts/` 子目录。

## O10 桌面 profile 的 lockfile 指向旧路径

- `~/.dsh/profiles/desktop/pnpm-lock.yaml` 里 `dsh-remote-hosts` 还指向 `Documents/deepseek-harness/default-workspace/dsh-remote-hosts`。
- `package.json` 和 `node_modules` 里的链接已经是新路径，所以现在能用。
- 这个文件在仓库外，下次在该 profile 里跑 `dsh plugin ... add` 时会被重写。记录在这里是为了出问题时知道往哪看。
