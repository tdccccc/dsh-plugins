// Browser half: left-sidebar rows open a remote view inset to the right of the
// sidebar. Returning to the conversation goes through ctx.layout.selectPanel(null),
// so the previous session comes back instead of a placeholder.
window.__ModuleLoader__.load({
  id: 'dsh-remote-hosts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'remoteHosts';
    const PLUGIN_ID = 'dsh-remote-hosts';
    // Every route lives under /api/: the platform requires a live browser
    // session there, which the plain web server does not.
    const STATUS_ROUTE = '/api/remote-hosts/status';
    const SYNC_ROUTE = '/api/remote-hosts/sync';
    const UPDATE_ROUTE = '/api/remote-hosts/update';
    const RECONNECT_ROUTE = '/api/remote-hosts/reconnect';
    const PROBE_ROUTE = '/api/remote-hosts/probe';
    const SERVICE_ROUTE = '/api/remote-hosts/service';
    const LOGS_ROUTE = '/api/remote-hosts/logs';
    const PROVISION_ROUTE = '/api/remote-hosts/provision';
    const ACTIVATE_ROUTE = '/api/remote-hosts/activate';
    // The Host refuses a restart/stop while the remote wrote session files in
    // its window; the browser turns that code into a second confirmation.
    const ACTIVE_SESSION_CODE = 'active-sessions';
    const LAST_HOST_KEY = 'dsh-remote-hosts:last-host';
    const OPEN_KEY = 'dsh-remote-hosts:open';
    const readStore = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
    const writeStore = (key, value) => { try { window.localStorage.setItem(key, value); } catch {} };

    const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;
    const SERVICE_KINDS = ['systemd-user', 'launchd-user', 'command', 'external'];
    const UNIT_PATTERN = /^[A-Za-z0-9@._:-]{1,128}$/;
    const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
    const CHANNEL_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;

    const EN = {
      back: '← Local conversation',
      sync: 'Sync settings',
      syncCopy: 'Sync without restart',
      syncPreview: 'Preview',
      syncBusy: 'Working…',
      syncing: 'Syncing…',
      syncingRestart: 'Syncing and restarting…',
      syncingPreview: 'Previewing…',
      syncFailed: 'Sync failed: {detail}',
      synced: 'Synced to {host}; the remote service restarted',
      syncedNoRestart: 'Copied to {host}; restart the remote service to apply',
      previewDone: 'Preview finished; see the log below',
      reload: 'Reload',
      external: 'Open in browser',
      logShow: 'Show sync log',
      logHide: 'Hide log',
      log: 'Log',
      logEmpty: 'No output yet',
      logWaiting: 'Waiting for output…',
      overlay: 'Remote view',
      httpStatus: 'HTTP {status}',
      online: 'Online',
      connecting: 'Connecting…',
      offline: 'Offline',
      externalState: 'External',
      dormant: 'Dormant',
      statusUnavailable: 'Status unavailable',
      retryConnect: 'Retry',
      reconnectFailed: 'Reconnect failed: {detail}',
      switchTitle: 'Switch to this host (⌘/Ctrl+{n})',
      shortcutSwitch: 'Switch to remote host {n}',
      confirmRestart: 'Sync settings to {host} and restart the remote dsh-web?\n\nRestarting interrupts sessions running on the remote.',
      update: 'Update dsh',
      open: 'Open',
      moveUp: 'Move up',
      moveDown: 'Move down',
      showInSidebar: 'Show in the left sidebar',
      pinTitle: 'Show in the left sidebar (saved with this host; the platform hover pin is memory-only)',
      showAll: 'Show all in sidebar',
      allShown: 'All hosts are marked for the sidebar; save to apply.',
      hiddenBadge: 'hidden',
      newServer: 'New server',
      serversTitle: 'Remote servers',
      serversSubtitle: 'Each card is one remote dsh web endpoint. SSH-managed hosts also get sync, update and service actions.',
      connectionMode: 'Connection type',
      modeSsh: 'SSH-managed',
      modeUrl: 'Direct URL',
      advanced: 'Advanced settings',
      idOptional: 'ID (optional)',
      notConfigured: 'Not configured',
      updateTitle: 'Install this app\'s dsh version on the host and restart the remote dsh-web',
      updating: 'Updating dsh…',
      updateFailed: 'Update failed: {detail}',
      updated: 'dsh on {host} is now {version}',
      updatedLatest: 'dsh on {host} is up to date',
      updateAvailable: 'Update available',
      updateAvailableTitle: 'Remote dsh {current} is older than {target}',
      more: 'More actions',
      probe: 'Check remote',
      restartService: 'Restart remote service',
      startService: 'Start remote service',
      stopService: 'Stop remote service',
      confirmServiceStart: 'Start dsh-web on {host}?',
      confirmServiceStop: 'Stop dsh-web on {host}?\n\nSessions running on the remote are interrupted.',
      startingService: 'Starting remote service…',
      stoppingService: 'Stopping remote service…',
      serviceStarted: 'Remote service on {host} started',
      serviceStopped: 'Remote service on {host} stopped',
      showLogs: 'Show remote log',
      loadingLogs: 'Reading remote log…',
      logsFailed: 'Could not read the remote log: {detail}',
      confirmServiceRestart: 'Restart dsh-web on {host}?\n\nSessions running on the remote are interrupted.',
      confirmActiveSessions: '{host} has {count} remote session(s) active in the last {minutes} minutes.{ids}\n\nContinuing interrupts them. Run anyway?',
      activeSessionsIds: '\n\nSessions: {ids}',
      activeSessionsBlocked: 'Stopped: {host} has {count} active remote session(s), nothing was changed.',
      restartingService: 'Restarting remote service…',
      serviceFailed: 'Service action failed: {detail}',
      serviceDone: 'Remote service on {host} restarted',
      probeUnavailable: 'remote check failed',
      confirmUpdate: 'Update dsh on {host}{to} and restart the remote dsh-web?\n\nThe update downloads packages and restarts the service, interrupting sessions running on the remote.',
      toVersion: ' to {version}',
      summary: 'Remote servers shown in the sidebar.',
      intro: 'Servers shown in the sidebar and the overlay switcher. The same list authorizes sync, update and service requests, so keep ids stable.',
      id: 'ID',
      label: 'Label',
      url: 'URL',
      sshHost: 'SSH host',
      remotePort: 'Remote port',
      localPort: 'Local port',
      remoteLog: 'Remote log',
      idPlaceholder: 'gpu-1',
      labelPlaceholder: 'GPU box',
      urlPlaceholder: 'http://127.0.0.1:27994/ (optional with SSH host)',
      sshHostPlaceholder: 'user@host',
      remotePortPlaceholder: '27993',
      localPortPlaceholder: '0 (auto)',
      remoteLogPlaceholder: '~/.dsh/web-27993.log',
      serviceKind: 'Service kind',
      serviceKindAuto: 'auto (systemd-user)',
      serviceUnit: 'Service unit',
      serviceUnitPlaceholder: 'dsh-web',
      profile: 'Remote profile',
      profilePlaceholder: 'web',
      badServiceKind: 'Unknown service kind.',
      badUnit: 'Service unit may contain letters, digits, @ . _ : - only.',
      badProfile: 'Profile name may contain letters, digits, . _ - only.',
      updateChannel: 'Update target',
      updateChannelPlaceholder: 'app version',
      badChannel: 'Update target may contain letters, digits, . _ + - only.',
      bundles: 'Provision bundles',
      bundlesPlaceholder: 'dsh-context@0.78.0 … (optional)',
      badBundles: 'Bundle specs may contain letters, digits, @ / . _ : + - only.',
      provision: 'Provision host',
      confirmProvision: 'Install Node, dsh, the dsh-web unit and profile bundles on {host}? The remote service restarts.',
      provisioning: 'Provisioning remote host…',
      provisionDone: '{host} provisioned',
      provisionFailed: 'Provisioning failed: {detail}',
      needsTarget: 'Every server needs a URL or an SSH host.',
      badPort: 'Ports must be numbers: remote 1-65535, local 0-65535.',
      switchHost: 'Switch host',
      noServers: 'No servers configured yet. Add one in the plugin settings.',
      add: 'Add server',
      remove: 'Remove',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard changes',
      saved: 'Saved.',
      saveFailed: 'Could not save:',
      test: 'Test connection',
      testing: 'Testing…',
      testTitle: 'Probe the saved configuration of this host',
      testSavedOnly: 'Save this host before testing it.',
      testManagedOnly: 'Only SSH-managed hosts can be tested.',
      testFailed: 'Test failed: {detail}',
      serviceUp: 'service active',
      serviceDown: 'service {state}',
      serviceUnknown: 'service unknown',
      portUnreachable: 'port not answering',
      loading: 'Loading settings…',
      retry: 'Retry',
      empty: 'No servers configured yet.',
      hint: 'Rows with an SSH host are fully managed: the plugin owns the tunnel and auth proxy, reads the login token from the remote log, and can sync settings or update dsh there. A URL is required only for hosts opened directly. Ports default to 27993 remote and 0 local (auto); the remote log defaults to ~/.dsh/web-<port>.log. The switch keeps a configured host out of the left sidebar, and the arrows change its sidebar order.',
      row: 'Row',
      idRequired: 'Every server needs an id.',
      badId: 'Use letters, digits, and dashes, up to 63 characters.',
      duplicateId: 'Duplicate id:',
      badUrl: 'The URL must start with http:// or https://.',
    };

    const ZH = {
      back: '← 本地会话',
      sync: '同步配置',
      syncCopy: '只同步不重启',
      syncPreview: '预览',
      syncBusy: '处理中…',
      syncing: '同步中…',
      syncingRestart: '同步并重启中…',
      syncingPreview: '预览中…',
      syncFailed: '同步失败：{detail}',
      synced: '已同步到 {host}，远程服务已重启',
      syncedNoRestart: '已同步到 {host}（未重启），远端重启后生效',
      previewDone: '预览完成，见下方日志',
      reload: '刷新',
      external: '外部打开',
      logShow: '显示同步日志',
      logHide: '收起日志',
      log: '日志',
      logEmpty: '暂无日志',
      logWaiting: '等待输出…',
      overlay: '远程视图',
      httpStatus: 'HTTP {status}',
      online: '在线',
      connecting: '连接中…',
      offline: '离线',
      externalState: '外部地址',
      dormant: '休眠',
      statusUnavailable: '状态不可用',
      retryConnect: '重试',
      reconnectFailed: '重连失败：{detail}',
      switchTitle: '切换到此主机（⌘/Ctrl+{n}）',
      shortcutSwitch: '切换到远程主机 {n}',
      confirmRestart: '同步配置到 {host} 并重启远端 dsh-web？\n\n重启会中断远端正在运行的会话。',
      update: '更新 dsh',
      open: '打开',
      moveUp: '上移',
      moveDown: '下移',
      showInSidebar: '在左侧栏显示',
      pinTitle: '在左侧栏显示（随主机保存；平台悬停取消固定只存在于内存）',
      showAll: '全部显示在侧边栏',
      allShown: '已把全部主机标记为显示，保存后生效。',
      hiddenBadge: '已隐藏',
      newServer: '新服务器',
      serversTitle: '远程服务器',
      serversSubtitle: '每张卡片是一个远程 dsh web 端点；SSH 托管的主机还支持同步、更新和服务操作。',
      connectionMode: '连接方式',
      modeSsh: 'SSH 托管',
      modeUrl: 'URL 直连',
      advanced: '高级设置',
      idOptional: 'ID（可选，自动生成）',
      notConfigured: '未配置',
      updateTitle: '把本机应用使用的 dsh 版本装到该主机，并重启远端 dsh-web',
      updating: '更新 dsh 中…',
      updateFailed: '更新失败：{detail}',
      updated: '{host} 上的 dsh 已是 {version}',
      updatedLatest: '{host} 上的 dsh 已是最新版本',
      updateAvailable: '可更新',
      updateAvailableTitle: '远端 dsh {current} 落后于 {target}',
      more: '更多操作',
      probe: '检测远端',
      restartService: '重启远端服务',
      startService: '启动远端服务',
      stopService: '停止远端服务',
      confirmServiceStart: '启动 {host} 上的 dsh-web？',
      confirmServiceStop: '停止 {host} 上的 dsh-web？\n\n会中断远端正在运行的会话。',
      startingService: '启动远端服务中…',
      stoppingService: '停止远端服务中…',
      serviceStarted: '{host} 上的远端服务已启动',
      serviceStopped: '{host} 上的远端服务已停止',
      showLogs: '查看远端日志',
      loadingLogs: '读取远端日志中…',
      logsFailed: '读取远端日志失败：{detail}',
      confirmServiceRestart: '重启 {host} 上的 dsh-web？\n\n会中断远端正在运行的会话。',
      confirmActiveSessions: '{host} 最近 {minutes} 分钟内有 {count} 个活跃会话。{ids}\n\n继续会中断这些会话，仍要执行吗？',
      activeSessionsIds: '\n\n会话：{ids}',
      activeSessionsBlocked: '已停止：{host} 还有 {count} 个活跃会话，未做任何改动。',
      restartingService: '重启远端服务中…',
      serviceFailed: '服务操作失败：{detail}',
      serviceDone: '{host} 上的远端服务已重启',
      probeUnavailable: '远端检测失败',
      confirmUpdate: '更新 {host} 上的 dsh{to} 并重启远端 dsh-web？\n\n更新会下载依赖并重启服务，中断远端正在运行的会话。',
      toVersion: ' 到 {version}',
      summary: '侧边栏中的远程服务器。',
      intro: '显示在侧边栏和浮层切换器中的服务器。同一份列表也决定同步、更新和服务接口允许的主机，请保持 id 稳定。',
      id: 'ID',
      label: '名称',
      url: '地址',
      sshHost: 'SSH 主机',
      remotePort: '远端端口',
      localPort: '本地端口',
      remoteLog: '远端日志',
      idPlaceholder: 'gpu-1',
      labelPlaceholder: 'GPU box',
      urlPlaceholder: 'http://127.0.0.1:27994/（有 SSH 主机时可留空）',
      sshHostPlaceholder: 'user@host',
      remotePortPlaceholder: '27993',
      localPortPlaceholder: '0（自动）',
      remoteLogPlaceholder: '~/.dsh/web-27993.log',
      serviceKind: '服务类型',
      serviceKindAuto: '自动（systemd-user）',
      serviceUnit: '服务单元',
      serviceUnitPlaceholder: 'dsh-web',
      profile: '远端 profile',
      profilePlaceholder: 'web',
      badServiceKind: '未知的服务类型。',
      badUnit: '服务单元只能包含字母、数字和 @ . _ : -。',
      badProfile: 'profile 名只能包含字母、数字和 . _ -。',
      updateChannel: '更新目标',
      updateChannelPlaceholder: '跟随本机',
      badChannel: '更新目标只能包含字母、数字和 . _ + -。',
      bundles: '部署时安装的 bundles',
      bundlesPlaceholder: 'dsh-context@0.78.0 …（可选）',
      badBundles: 'bundle 规格只能包含字母、数字和 @ / . _ : + -。',
      provision: '一键部署主机',
      confirmProvision: '在 {host} 上安装 Node、dsh、dsh-web 服务和 profile bundles？远端服务会重启。',
      provisioning: '正在部署远端主机…',
      provisionDone: '{host} 部署完成',
      provisionFailed: '部署失败：{detail}',
      needsTarget: '每台服务器至少需要地址或 SSH 主机。',
      badPort: '端口必须是数字：远端 1-65535，本地 0-65535。',
      switchHost: '切换主机',
      noServers: '尚未配置服务器，请在插件设置中添加。',
      add: '添加服务器',
      remove: '删除',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      saved: '已保存。',
      saveFailed: '保存失败：',
      test: '测试连接',
      testing: '测试中…',
      testTitle: '检测该主机已保存的配置',
      testSavedOnly: '先保存该主机再测试。',
      testManagedOnly: '只有 SSH 托管的主机可以测试。',
      testFailed: '测试失败：{detail}',
      serviceUp: '服务运行中',
      serviceDown: '服务 {state}',
      serviceUnknown: '服务状态未知',
      portUnreachable: '端口无响应',
      loading: '正在加载设置…',
      retry: '重试',
      empty: '尚未配置服务器。',
      hint: '填写 SSH 主机的行由插件完全管理：自动建立隧道和鉴权代理、从远端日志读取登录 token，并可同步配置或更新 dsh。只有直接打开的地址才必须填 URL。远端端口默认 27993，本地端口 0 表示自动，远端日志默认 ~/.dsh/web-<port>.log。开关控制是否显示在左侧栏，上下箭头调整侧边栏顺序。',
      row: '行',
      idRequired: '每台服务器都需要一个 id。',
      badId: '只能使用字母、数字和连字符，最多 63 个字符。',
      duplicateId: 'id 重复：',
      badUrl: '地址必须以 http:// 或 https:// 开头。',
    };

    const parseHttpUrl = (value) => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return null;
      try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
      } catch {
        return null;
      }
    };

    const readServer = (value) => {
      if (!value || typeof value !== 'object') return null;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      if (!ID_PATTERN.test(id)) return null;
      // A managed host has no fixed address: the plugin picks a proxy port at
      // runtime, so the url is optional there.
      const managed = value.managed === true;
      const url = parseHttpUrl(value.url) || '';
      if (!url && !managed && !value.sshHost) return null;
      const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : id;
      const sshHost = typeof value.sshHost === 'string' ? value.sshHost.trim() : '';
      const sidebar = value.sidebar !== false;
      return sshHost ? { id, label, url, sshHost, managed, sidebar } : { id, label, url, managed, sidebar };
    };

    // The Host half is authoritative; this copy is what the sidebar rendered
    // while the request is in flight.
    const normalizeServers = (value) => {
      const rows = Array.isArray(value) ? value : [];
      const servers = [];
      const seen = new Set();
      for (const row of rows) {
        const server = readServer(row);
        if (!server || seen.has(server.id)) continue;
        seen.add(server.id);
        servers.push(server);
      }
      return servers;
    };

    const sameServers = (left, right) =>
      left.length === right.length && left.every((server, index) => {
        const other = right[index];
        return server.id === other.id && server.label === other.label && server.url === other.url
          && (server.sidebar !== false) === (other.sidebar !== false);
      });

    const sameServerIds = (left, right) =>
      left.length === right.length && left.every((server, index) => server.id === right[index].id);

    const useSource = (source) => {
      const subscribe = React.useCallback((listener) => source.subscribe(listener), [source]);
      const snapshot = React.useCallback(() => source.getSnapshot(), [source]);
      return React.useSyncExternalStore(subscribe, snapshot, snapshot);
    };

    const useTranslate = (locale) => {
      useSource(locale);
      return locale.bind(NS);
    };

    const listeners = new Set();
    let state = {
      visited: new Set(),
      reload: {},
      inset: 280,
      servers: normalizeServers([]),
      // Version of the desktop app's own dsh, sent by the Host half; the update
      // confirmation names it, and an empty value means the host falls back to
      // the latest published release.
      localVersion: '',
      // id -> { managed, state, error, proxyUrl, updatedAt }; kept apart from the
      // server rows so a state poll never re-registers the sidebar slots.
      status: {},
    };
    const setState = (next) => { state = next; listeners.forEach((fn) => fn()); };
    const useStore = () => {
      const [, force] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
      return state;
    };

    const measureInset = () => {
      try {
        const nav = document.querySelector('nav');
        const rect = nav && nav.getBoundingClientRect ? nav.getBoundingClientRect() : null;
        // The sidebar can collapse to a rail or disappear: follow its real edge.
        if (rect && rect.left < 40) {
          // The nav is the panel list and stops at the sidebar's inline padding.
          // The macOS collapse toggle is right-aligned in that strip, so the
          // overlay has to start at the column's border box, not the nav's edge,
          // or its opaque frame covers the padding under the toggle.
          const column = nav.parentElement && nav.parentElement.getBoundingClientRect
            ? nav.parentElement.getBoundingClientRect()
            : null;
          const right = column && column.right > rect.right ? column.right : rect.right;
          return Math.max(0, Math.round(right));
        }
      } catch {}
      return 0;
    };

    const reload = (id) => setState({ ...state, reload: { ...state.reload, [id]: (state.reload[id] || 0) + 1 } });

    const icon = (server) =>
      h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        'data-remote-host': server.id,
      },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 9, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M5 14h6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 11.5, cy: 8, r: 1.2, fill: 'currentColor' })
      );

    // Form rows are strings end to end, even for the numeric fields, so editing
    // cannot turn a port into NaN between keystrokes. Host-side toServer() owns
    // the numbers and their defaults.
    const textOf = (value) => (value === undefined || value === null ? '' : String(value));
    const copyServer = (value) => {
      const row = value && typeof value === 'object' ? value : {};
      return {
        id: textOf(row.id),
        label: textOf(row.label),
        url: textOf(row.url),
        sshHost: textOf(row.sshHost),
        remotePort: textOf(row.remotePort),
        localPort: textOf(row.localPort),
        remoteLog: textOf(row.remoteLog),
        serviceKind: textOf(row.serviceKind),
        serviceUnit: textOf(row.serviceUnit),
        profile: textOf(row.profile),
        updateChannel: textOf(row.updateChannel),
        bundles: textOf(row.bundles),
        sidebar: row.sidebar !== false,
        // Draft-only: the mode picks which side is saved, while both address
        // fields stay in the draft so a misclick does not erase a typed value.
        mode: row.sshHost ? 'ssh' : 'url',
      };
    };
    // Derive a stable panel id from a human label/host when the user leaves the
    // advanced ID field empty, so the simple form has one less required field.
    const slugOf = (value) => String(value === undefined || value === null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
    const pinIcon = (filled) => h('svg', {
      width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none',
    },
      h('path', {
        d: 'M10.4 1.9 14.1 5.6l-1.9.5-2 2 .2 2.2-1.2 1.2-4.9-4.9 1.2-1.2 2.2.2 2-2z',
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
      }),
      h('path', { d: 'M4.6 11.4 2 14', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })
    );
    // One line of tool/probe output for inline status text.
    const flatText = (value) => String(value || '').trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join(' / ');

    const parsePort = (value, min, max) => {
      const text = String(value === undefined || value === null ? '' : value).trim();
      if (!text) return null;
      if (!/^[0-9]+$/.test(text)) return NaN;
      const number = Number(text);
      return number >= min && number <= max ? number : NaN;
    };

    // Native Plugins page form. It edits the Host Config through the settings
    // service, so the same list drives the sidebar, the overlay, and sync.
    function createSettingsStore(ctx) {
      let snapshot = { servers: null, ns: null, revision: null, error: null, loaded: false };
      let alive = true;
      let pending = null;
      const listeners = new Set();
      const publish = (patch) => {
        if (!alive) return;
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) listener();
      };
      const errorText = (result) =>
        (result.error && (result.error.message || result.error.code)) || 'request failed';
      const accept = (row) => {
        const values = row && row.value && Array.isArray(row.value.servers) ? row.value.servers : [];
        publish({
          servers: values.map(copyServer),
          ns: row.ns,
          revision: row.revision,
          error: null,
          loaded: true,
        });
      };
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        refresh() {
          if (pending) return pending;
          pending = (async () => {
            try {
              const result = await ctx.remote.settings.describe();
              if (!result.ok) throw new Error(errorText(result));
              const rows = result.value && Array.isArray(result.value.namespaces) ? result.value.namespaces : [];
              const row = rows.find((entry) => entry.ns === PLUGIN_ID) ||
                rows.find((entry) => String(entry.ns).split(':').pop() === PLUGIN_ID);
              if (!row) throw new Error(PLUGIN_ID + ' settings namespace is not mounted.');
              accept(row);
            } catch (error) {
              publish({ error: String(error && error.message ? error.message : error), loaded: true });
            } finally {
              pending = null;
            }
          })();
          return pending;
        },
        async save(servers, expectedRevision) {
          if (!snapshot.ns) throw new Error('Settings are unavailable.');
          const result = await ctx.remote.settings.update(snapshot.ns, { servers }, expectedRevision);
          if (!result.ok) throw new Error(errorText(result));
          accept(result.value);
        },
        dispose() {
          alive = false;
          listeners.clear();
        },
      };
    }

    function validateDraft(draft, t) {
      const values = [];
      const ids = new Set();
      // An id typed into the advanced field wins over every derived id, even
      // one further down the list: only a derived id is allowed to step aside.
      const explicitIds = new Set();
      for (const row of draft) {
        const explicit = typeof row.id === 'string' ? row.id.trim() : '';
        if (explicit) explicitIds.add(explicit);
      }
      const uniqueId = (base, used) => {
        let id = base.slice(0, 63);
        let suffix = 2;
        while (used.has(id)) {
          const tail = '-' + suffix;
          id = base.slice(0, 63 - tail.length) + tail;
          suffix += 1;
        }
        return id;
      };
      draft.forEach((row, index) => {
        const mode = row.mode === 'ssh' ? 'ssh' : 'url';
        const sshHost = row.sshHost.trim();
        const rawUrl = row.url.trim();
        if (!row.id.trim() && !row.label.trim() && !rawUrl && !sshHost) return;
        const where = t('row') + ' ' + (index + 1) + ': ';
        // ID is an implementation detail for most users: derive it from the
        // name, the active target, or the URL host. A derived collision gets a
        // -2/-3 suffix instead of an error; the saved draft then shows the
        // final value in the advanced field.
        let id = row.id.trim();
        if (!id) {
          let urlHost = '';
          try { if (rawUrl) urlHost = new URL(rawUrl).hostname; } catch {}
          const base = slugOf(row.label) || slugOf(mode === 'ssh' ? sshHost : urlHost);
          if (!base) throw new Error(where + t('idRequired'));
          id = uniqueId(base, new Set([...ids, ...explicitIds]));
        }
        if (!ID_PATTERN.test(id)) throw new Error(where + t('badId'));
        if (ids.has(id)) throw new Error(where + t('duplicateId') + ' ' + id);
        ids.add(id);
        const label = row.label.trim() || id;
        // Only the selected side is saved. The other side stays in the draft
        // until the next save rebuilds it, so switching back and forth does
        // not lose a typed address.
        if (mode === 'url') {
          const url = rawUrl ? parseHttpUrl(rawUrl) : '';
          if (rawUrl && !url) throw new Error(where + t('badUrl'));
          if (!url) throw new Error(where + t('needsTarget'));
          const value = { id, label, url };
          if (row.sidebar === false) value.sidebar = false;
          values.push(value);
          return;
        }
        if (!sshHost) throw new Error(where + t('needsTarget'));
        const remotePort = parsePort(row.remotePort, 1, 65535);
        const localPort = parsePort(row.localPort, 0, 65535);
        if (Number.isNaN(remotePort) || Number.isNaN(localPort)) throw new Error(where + t('badPort'));
        const serviceKind = row.serviceKind.trim();
        if (serviceKind && !SERVICE_KINDS.includes(serviceKind)) throw new Error(where + t('badServiceKind'));
        const serviceUnit = row.serviceUnit.trim();
        if (serviceUnit && !UNIT_PATTERN.test(serviceUnit)) throw new Error(where + t('badUnit'));
        const profile = row.profile.trim();
        if (profile && !PROFILE_PATTERN.test(profile)) throw new Error(where + t('badProfile'));
        const updateChannel = row.updateChannel.trim();
        if (updateChannel && !CHANNEL_PATTERN.test(updateChannel)) throw new Error(where + t('badChannel'));
        const bundles = row.bundles.trim();
        if (bundles) {
          for (const spec of bundles.split(/\s+/)) {
            if (!/^[A-Za-z0-9@/._:+-]+$/.test(spec)) throw new Error(where + t('badBundles'));
          }
        }
        const value = { id, label, url: '', sshHost };
        if (remotePort !== null) value.remotePort = remotePort;
        if (localPort !== null) value.localPort = localPort;
        if (row.remoteLog.trim()) value.remoteLog = row.remoteLog.trim();
        if (serviceKind) value.serviceKind = serviceKind;
        if (serviceUnit) value.serviceUnit = serviceUnit;
        if (profile) value.profile = profile;
        if (updateChannel) value.updateChannel = updateChannel;
        if (bundles) value.bundles = bundles;
        if (row.sidebar === false) value.sidebar = false;
        values.push(value);
      });
      return values;
    }

    function SettingsForm({ ctx, store, view, onSaved, onOpen }) {
      const t = useTranslate(ctx.locale);
      const snapshot = useSource(store);
      const [draft, setDraft] = React.useState(null);
      const [revision, setRevision] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [failed, setFailed] = React.useState(false);
      // id -> { busy, at, info, update, error } from the last 测试连接 on that card.
      const [tests, setTests] = React.useState({});
      // id -> update state from the Host's cached probe, fetched once per save.
      const [updates, setUpdates] = React.useState({});
      const alive = React.useRef(true);
      const nextKey = React.useRef(0);

      const makeRow = (server) => {
        nextKey.current += 1;
        return { ...copyServer(server), key: nextKey.current };
      };

      React.useEffect(() => {
        alive.current = true;
        store.refresh();
        return () => { alive.current = false; };
      }, [store]);

      React.useEffect(() => {
        if (draft !== null || !snapshot.loaded || snapshot.servers === null) return;
        setDraft(snapshot.servers.map(makeRow));
        setRevision(snapshot.revision);
      }, [draft, snapshot.loaded, snapshot.servers, snapshot.revision]);

      // Seed update badges from the probes the Host already has. This reads the
      // status payload only; it opens no SSH and starts no tunnel.
      React.useEffect(() => {
        let live = true;
        fetch(STATUS_ROUTE, { cache: 'no-store' })
          .then((response) => response.json())
          .then((payload) => {
            if (!live || !payload || !Array.isArray(payload.servers)) return;
            const next = {};
            for (const row of payload.servers) {
              if (row && row.id && row.update && row.update.available) next[row.id] = row.update;
            }
            setUpdates(next);
          })
          .catch(() => {});
        return () => { live = false; };
      }, [snapshot.revision]);

      if (view === 'summary') return t('summary');

      const patchRow = (index, key, value) => {
        setDraft((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
        setNotice('');
      };
      // The platform's hover unpin is not visible to the plugin, so this only
      // restores the plugin's own persistent sidebar field.
      const showAll = () => {
        setDraft((current) => current.map((row) => ({ ...row, sidebar: true })));
        setFailed(false);
        setNotice(t('allShown'));
      };
      const addRow = () => {
        setDraft((current) => [...current, makeRow({ id: '', label: '', url: '', sshHost: '' })]);
        setNotice('');
      };
      const removeRow = (index) => {
        const removed = draft && draft[index];
        if (removed && removed.id.trim()) {
          setTests((current) => {
            const next = { ...current };
            delete next[removed.id.trim()];
            return next;
          });
        }
        setDraft((current) => current.filter((_, i) => i !== index));
        setNotice('');
      };
      const moveRow = (index, delta) => {
        setDraft((current) => {
          const target = index + delta;
          if (target < 0 || target >= current.length) return current;
          const next = current.slice();
          const [row] = next.splice(index, 1);
          next.splice(target, 0, row);
          return next;
        });
        setNotice('');
      };
      const openRow = (index) => {
        const row = draft && draft[index];
        if (!row || !row.id.trim()) return;
        if (typeof onOpen === 'function') onOpen(row.id.trim());
      };
      // One labelled text input; labels are visible instead of relying on
      // placeholders so an empty advanced field still reads as a field.
      const textField = (index, row, key, label, options = {}) => h('label', {
        className: 'rh-field' + (options.wide ? ' rh-wide' : ''),
        key,
      },
        h('span', null, label),
        h('input', {
          type: 'text', value: row[key], placeholder: options.placeholder, 'aria-label': label,
          title: label, spellCheck: false, disabled: busy,
          inputMode: options.numeric ? 'numeric' : undefined,
          onChange: (event) => patchRow(index, key, event.target.value),
        }));
      const serviceKindField = (index, row) => h('label', { className: 'rh-field', key: 'serviceKind' },
        h('span', null, t('serviceKind')),
        h('select', {
          value: row.serviceKind, 'aria-label': t('serviceKind'), title: t('serviceKind'),
          disabled: busy || !row.sshHost.trim(),
          onChange: (event) => patchRow(index, 'serviceKind', event.target.value),
        },
          h('option', { value: '' }, t('serviceKindAuto')),
          ...SERVICE_KINDS.map((kind) => h('option', { key: kind, value: kind }, kind))
        ));

      // The simple form asks only for a name plus an SSH host or a URL; the
      // mode switch decides which of the two target shapes the host uses.
      const modeOf = (row) => (row.mode === 'ssh' ? 'ssh' : 'url');
      // The draft keeps both address fields; switching only changes which one
      // is shown and which one a save writes.
      const setMode = (index, mode) => {
        patchRow(index, 'mode', mode);
      };
      const summaryOf = (row) => {
        if (modeOf(row) === 'ssh') {
          const host = row.sshHost.trim();
          return host
            ? 'ssh · ' + host + ' · :' + (row.remotePort.trim() || '27993')
            : 'ssh · ' + t('notConfigured');
        }
        return row.url.trim() || t('notConfigured');
      };
      // The probe route reads the saved config, so a card can only be tested
      // after it has an id the Host knows. This is the same forced probe the
      // overlay uses, without opening the overlay or the tunnel.
      const savedIds = new Set((snapshot.servers || []).map((server) => server.id));
      const testHost = async (row) => {
        const id = row.id.trim();
        if (!id) return;
        setTests((current) => ({ ...current, [id]: { busy: true, info: null, error: '' } }));
        try {
          const response = await fetch(PROBE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ host: id, force: true }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok !== true) {
            throw new Error(payload.error || t('httpStatus', { status: response.status }));
          }
          if (!alive.current) return;
          setTests((current) => ({
            ...current,
            [id]: {
              busy: false,
              at: Number(payload.at) || Date.now(),
              info: payload.info || null,
              update: payload.update && typeof payload.update === 'object' ? payload.update : null,
              error: '',
            },
          }));
        } catch (error) {
          if (!alive.current) return;
          setTests((current) => ({
            ...current,
            [id]: { busy: false, info: null, update: null, error: flatText(error && error.message ? error.message : error) },
          }));
        }
      };
      const testTone = (result) => {
        if (!result || result.busy) return '';
        if (result.error) return ' rh-bad';
        const http = result.info && result.info.port && result.info.port.http;
        return http && http !== '000' ? ' rh-ok' : ' rh-warn';
      };
      const testSummary = (result) => {
        if (!result || result.busy) return '';
        if (result.error) return t('testFailed', { detail: result.error });
        const info = result.info;
        if (!info) return '';
        const version = info.dsh && info.dsh.version ? 'dsh ' + info.dsh.version : '';
        const state = info.service && info.service.state;
        const service = state === 'active' || state === 'running'
          ? t('serviceUp')
          : state && state !== 'unknown' ? t('serviceDown', { state }) : t('serviceUnknown');
        const http = info.port && info.port.http;
        const port = http && http !== '000' ? 'HTTP ' + http : t('portUnreachable');
        return [version, service, port].filter(Boolean).join(' · ');
      };
      const testRow = (row) => {
        const id = row.id.trim();
        const saved = savedIds.has(id);
        const result = tests[id] || null;
        const canTest = Boolean(id && saved && row.sshHost.trim());
        const summary = testSummary(result);
        // A fresh test wins over the cached status result, including when it
        // says the host is already current.
        const update = result ? (result.update || null) : (updates[id] || null);
        return h('div', { className: 'rh-testrow', key: 'test' },
          h('button', {
            type: 'button',
            className: 'rh-test-btn',
            disabled: busy || !canTest || Boolean(result && result.busy),
            title: !row.sshHost.trim()
              ? t('testManagedOnly')
              : saved ? t('testTitle') : t('testSavedOnly'),
            onClick: () => { if (canTest) testHost(row); },
          }, result && result.busy ? t('testing') : t('test')),
          summary
            ? h('span', { className: 'rh-test-state' + testTone(result), title: summary }, summary)
            : null,
          update && update.available
            ? h('span', {
              className: 'rh-update-badge',
              title: t('updateAvailableTitle', { current: update.current || '', target: update.target || '' }),
            }, '↑ ' + t('updateAvailable'))
            : null);
      };
      const discard = async () => {
        setNotice('');
        setFailed(false);
        await store.refresh();
        if (!alive.current) return;
        const current = store.getSnapshot();
        setDraft((current.servers || []).map(makeRow));
        setRevision(current.revision);
        setTests({});
      };
      const save = async (event) => {
        event.preventDefault();
        if (!draft || busy) return;
        setBusy(true);
        setNotice('');
        setFailed(false);
        try {
          const values = validateDraft(draft, t);
          await store.save(values, revision);
          if (!alive.current) return;
          setDraft(values.map(makeRow));
          setRevision(store.getSnapshot().revision);
          setTests({});
          setNotice(t('saved'));
          if (typeof onSaved === 'function') onSaved();
        } catch (error) {
          if (!alive.current) return;
          setFailed(true);
          setNotice(t('saveFailed') + ' ' + (error && error.message ? error.message : String(error)));
        } finally {
          if (alive.current) setBusy(false);
        }
      };

      if (draft === null) {
        return h('div', { className: 'dsh-remote-hosts-settings' },
          h('style', null, SETTINGS_CSS),
          h('p', { role: snapshot.error ? 'alert' : 'status' }, snapshot.error || t('loading')),
          h('button', { type: 'button', onClick: () => store.refresh() }, t('retry')));
      }

      return h('form', { className: 'dsh-remote-hosts-settings', onSubmit: save },
        h('style', null, SETTINGS_CSS),
        h('div', { className: 'rh-head' },
          h('div', { className: 'rh-head-copy' },
            h('h2', { className: 'rh-title' }, t('serversTitle')),
            h('p', { className: 'rh-sub' }, t('serversSubtitle'))),
          h('div', { className: 'rh-head-actions' },
            h('button', {
              type: 'button', className: 'rh-soft', disabled: busy || draft.length === 0,
              onClick: showAll,
            }, t('showAll')),
            h('button', { type: 'button', className: 'rh-add', disabled: busy, onClick: addRow }, '+ ' + t('add')))),
        snapshot.error ? h('p', { role: 'alert' }, snapshot.error) : null,
        draft.length === 0
          ? h('div', { className: 'rh-empty-card' },
            h('p', null, t('empty')),
            h('button', { type: 'button', className: 'rh-add', disabled: busy, onClick: addRow }, '+ ' + t('add')))
          : null,
        ...draft.map((row, index) => {
          const mode = modeOf(row);
          return h('div', { className: 'rh-card', key: row.key },
            h('div', { className: 'rh-card-head' },
              h('span', { className: 'rh-avatar', 'aria-hidden': 'true' }, (row.label.trim() || row.id.trim() || '?').slice(0, 1).toUpperCase()),
              h('div', { className: 'rh-card-id' },
                h('span', { className: 'rh-card-title' }, row.label.trim() || row.id.trim() || t('newServer')),
                h('span', { className: 'rh-card-sub' }, summaryOf(row))),
              h('div', { className: 'rh-card-actions' },
                h('button', {
                  type: 'button',
                  className: 'rh-icon' + (row.sidebar !== false ? ' rh-on' : ''),
                  disabled: busy, title: t('pinTitle'), 'aria-label': t('showInSidebar'),
                  'aria-pressed': row.sidebar !== false,
                  onClick: () => patchRow(index, 'sidebar', row.sidebar === false),
                }, pinIcon(row.sidebar !== false)),
                h('button', {
                  type: 'button', className: 'rh-icon', disabled: busy || !row.id.trim(),
                  title: t('open'), 'aria-label': t('open'), onClick: () => openRow(index),
                }, '↗'),
                h('button', {
                  type: 'button', className: 'rh-icon', disabled: busy || index === 0,
                  title: t('moveUp'), 'aria-label': t('moveUp'), onClick: () => moveRow(index, -1),
                }, '↑'),
                h('button', {
                  type: 'button', className: 'rh-icon', disabled: busy || index === draft.length - 1,
                  title: t('moveDown'), 'aria-label': t('moveDown'), onClick: () => moveRow(index, 1),
                }, '↓'),
                h('button', {
                  type: 'button', className: 'rh-icon rh-danger', disabled: busy,
                  title: t('remove'), 'aria-label': t('remove'), onClick: () => removeRow(index),
                }, '×')))
            ,
            h('div', { className: 'rh-segment', role: 'group', 'aria-label': t('connectionMode') },
              h('button', {
                type: 'button', className: mode === 'ssh' ? 'rh-seg-on' : '', disabled: busy,
                onClick: () => setMode(index, 'ssh'),
              }, t('modeSsh')),
              h('button', {
                type: 'button', className: mode === 'url' ? 'rh-seg-on' : '', disabled: busy,
                onClick: () => setMode(index, 'url'),
              }, t('modeUrl'))),
            mode === 'ssh'
              ? h('div', { className: 'rh-primary-fields' },
                textField(index, row, 'label', t('label'), { placeholder: t('labelPlaceholder') }),
                textField(index, row, 'sshHost', t('sshHost'), { placeholder: t('sshHostPlaceholder') }),
                textField(index, row, 'remotePort', t('remotePort'), { placeholder: t('remotePortPlaceholder'), numeric: true }))
              : h('div', { className: 'rh-primary-fields' },
                textField(index, row, 'label', t('label'), { placeholder: t('labelPlaceholder') }),
                textField(index, row, 'url', t('url'), { placeholder: t('urlPlaceholder') })),
            mode === 'ssh' ? testRow(row) : null,
            h('details', { className: 'rh-adv' },
              h('summary', null, t('advanced')),
              h('div', { className: 'rh-fields' },
                textField(index, row, 'id', t('idOptional'), { placeholder: t('idPlaceholder') }),
                mode === 'ssh' ? textField(index, row, 'localPort', t('localPort'), { placeholder: t('localPortPlaceholder'), numeric: true }) : null,
                mode === 'ssh' ? textField(index, row, 'remoteLog', t('remoteLog'), { placeholder: t('remoteLogPlaceholder') }) : null,
                mode === 'ssh' ? textField(index, row, 'bundles', t('bundles'), { placeholder: t('bundlesPlaceholder') }) : null),
              mode === 'ssh'
                ? h('div', { className: 'rh-fields' },
                  serviceKindField(index, row),
                  textField(index, row, 'serviceUnit', t('serviceUnit'), { placeholder: t('serviceUnitPlaceholder') }),
                  textField(index, row, 'profile', t('profile'), { placeholder: t('profilePlaceholder') }),
                  textField(index, row, 'updateChannel', t('updateChannel'), { placeholder: t('updateChannelPlaceholder') }))
                : null)
          );
        }),
        h('div', { className: 'rh-actions' },
          h('span', { className: 'rh-spacer' }),
          h('button', { type: 'submit', className: 'rh-save', disabled: busy }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', disabled: busy, onClick: discard }, t('discard'))),
        notice ? h('p', { role: failed ? 'alert' : 'status', 'data-error': failed ? 'true' : undefined }, notice) : null,
        h('small', { className: 'rh-hint' }, t('hint')));
    }

    const SETTINGS_CSS = `
/* The Plugins page centers its details at 960px and stretches each section to
   that column. A narrower form would sit left-aligned inside it and leave an
   uneven gap on the right, so match the column instead of capping the width. */
.dsh-remote-hosts-settings{box-sizing:border-box;width:100%;max-width:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.55}
.dsh-remote-hosts-settings p,.dsh-remote-hosts-settings small{color:var(--dsw-alias-label-secondary)}
.dsh-remote-hosts-settings .rh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
.dsh-remote-hosts-settings .rh-head-copy{min-width:0}
.dsh-remote-hosts-settings .rh-title{margin:0;font-size:15px;font-weight:600}
.dsh-remote-hosts-settings .rh-sub{margin:3px 0 0;font-size:12px}
.dsh-remote-hosts-settings .rh-add{flex:0 0 auto;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:transparent;font-weight:500;cursor:pointer}
.dsh-remote-hosts-settings .rh-add:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings .rh-empty-card{margin:12px 0;padding:22px;border:1px dashed var(--dsw-alias-border-l1);border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.dsh-remote-hosts-settings .rh-card{margin:10px 0;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease}
.dsh-remote-hosts-settings .rh-card:hover{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1))}
.dsh-remote-hosts-settings .rh-card-head{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-remote-hosts-settings .rh-avatar{flex:0 0 auto;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);font-size:13px;font-weight:600}
.dsh-remote-hosts-settings .rh-card-id{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-remote-hosts-settings .rh-card-title{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-remote-hosts-settings .rh-card-sub{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-remote-hosts-settings .rh-card-actions{flex:0 0 auto;display:flex;gap:2px;align-items:center}
.dsh-remote-hosts-settings .rh-segment{display:inline-flex;padding:2px;margin-top:12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings .rh-segment button{padding:4px 12px;border:0;border-radius:7px;background:transparent;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-remote-hosts-settings .rh-segment button.rh-seg-on{background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dsh-remote-hosts-settings .rh-primary-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
.dsh-remote-hosts-settings .rh-testrow{display:flex;align-items:center;gap:8px;margin-top:10px;min-width:0}
.dsh-remote-hosts-settings .rh-test-btn{padding:4px 10px;font-size:12px}
.dsh-remote-hosts-settings .rh-test-state{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-remote-hosts-settings .rh-test-state::before{content:'';flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:currentColor}
.dsh-remote-hosts-settings .rh-test-state.rh-ok{color:var(--dsw-alias-state-success-primary,#2f9e44)}
.dsh-remote-hosts-settings .rh-test-state.rh-warn{color:var(--dsw-alias-state-warning-primary,#f08c00)}
.dsh-remote-hosts-settings .rh-test-state.rh-bad{color:var(--dsw-alias-state-error-primary,#d9534f)}
.dsh-remote-hosts-settings .rh-update-badge{flex:0 0 auto;padding:1px 7px;border:1px solid currentColor;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--dsw-alias-state-warning-primary,#f08c00)}
.dsh-remote-hosts-settings .rh-adv{margin-top:12px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1)}
.dsh-remote-hosts-settings .rh-adv>summary{list-style:none;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);user-select:none}
.dsh-remote-hosts-settings .rh-adv>summary::-webkit-details-marker{display:none}
.dsh-remote-hosts-settings .rh-adv>summary::before{content:'▸';display:inline-block;width:14px}
.dsh-remote-hosts-settings .rh-adv[open]>summary::before{content:'▾'}
.dsh-remote-hosts-settings .rh-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px}
.dsh-remote-hosts-settings .rh-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-remote-hosts-settings .rh-field>span{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-remote-hosts-settings select,.dsh-remote-hosts-settings input:not([type=checkbox]){box-sizing:border-box;min-width:0;width:100%;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;font:inherit;font-size:13px;color:inherit}
.dsh-remote-hosts-settings button{padding:6px 12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;font:inherit;color:inherit}
.dsh-remote-hosts-settings button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings button:disabled{opacity:.5;cursor:default}
.dsh-remote-hosts-settings :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-remote-hosts-settings .rh-icon{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;line-height:1;font-size:13px;opacity:.55}
.dsh-remote-hosts-settings .rh-icon:hover:not(:disabled){opacity:1;background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings .rh-icon.rh-on{opacity:1;color:var(--dsw-alias-brand-primary)}
.dsh-remote-hosts-settings .rh-icon.rh-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
/* brand-primary flips to a near-white chip in the dark theme, so the label
   must flip with it; the token pair keeps both themes readable. */
.dsh-remote-hosts-settings .rh-save{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}
.dsh-remote-hosts-settings .rh-save:hover:not(:disabled){opacity:.92;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary))}
.dsh-remote-hosts-settings .rh-actions{display:flex;gap:8px;align-items:center;margin-top:16px}
.dsh-remote-hosts-settings .rh-spacer{flex:1}
.dsh-remote-hosts-settings .rh-head-actions{display:flex;gap:8px;flex:0 0 auto;align-items:flex-start}
.dsh-remote-hosts-settings .rh-soft{flex:0 0 auto;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);color:inherit;background:transparent;font-weight:500;cursor:pointer}
.dsh-remote-hosts-settings .rh-soft:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings .rh-hint{display:block;margin-top:10px;font-size:11.5px}
.dsh-remote-hosts-settings [data-error=true]{color:var(--dsw-alias-state-error-primary)}
@media(max-width:720px){.dsh-remote-hosts-settings .rh-primary-fields{grid-template-columns:1fr 1fr}.dsh-remote-hosts-settings .rh-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-remote-hosts-settings .rh-head{flex-direction:column}}
`;

    function apply(ctx) {
      for (const [language, dict] of [['en', EN], ['zh', ZH], ['zh-CN', ZH]]) {
        ctx.effect(() => ctx.locale.register(NS, language, dict));
      }

      let disposed = false;
      let requestId = 0;
      let serverDisposers = [];
      ctx.effect(() => () => { disposed = true; });

      const openServer = (id) => {
        try { ctx.layout.selectPanel('remote-hosts/' + id); } catch {}
      };
      const backToLocal = () => {
        writeStore(OPEN_KEY, '0');
        try { ctx.layout.selectPanel(null); } catch {}
      };

      // Every managed host stays dormant until the browser says it is opening
      // it; active:false releases the host it left to the idle timer instead of
      // dropping its warm connection at once.
      const activateHost = (id, active) => {
        if (typeof fetch !== 'function') return Promise.resolve();
        return fetch(ACTIVATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ host: id, active }),
        }).catch(() => {});
      };

      const RemoteView = (props) => {
        const s = useStore();
        const translate = useTranslate(ctx.locale);
        const servers = s.servers;
        // The layout store owns the selection; null is the conversation. The
        // overlay follows it instead of inferring selection from the DOM.
        const panelInfo = props.usePanelInfo;
        const selected = typeof panelInfo === 'function' ? panelInfo((info) => info.activePanelId) : null;
        const active = servers.find((server) => selected === 'remote-hosts/' + server.id) || null;
        const [syncState, setSyncState] = React.useState({ busy: false, text: '', error: false });
        const [log, setLog] = React.useState({ open: false, lines: [] });
        const [probe, setProbe] = React.useState({ id: '', at: 0, info: null, error: '' });
        const [menuOpen, setMenuOpen] = React.useState(false);
        const logRef = React.useRef(null);
        const abortRef = React.useRef(null);
        const menuRef = React.useRef(null);
        const menuOpenRef = React.useRef(false);
        const lastToggle = React.useRef(0);

        // The global keydown listener is bound once per host and would otherwise
        // read the menu flag from the render that opened the host. Keep the state
        // and its ref in step so Escape sees the menu that is open right now.
        const setMenu = (open) => {
          menuOpenRef.current = open;
          setMenuOpen(open);
        };

        React.useEffect(() => {
          const box = logRef.current;
          if (box) box.scrollTop = box.scrollHeight;
        }, [log.open, log.lines]);

        React.useEffect(() => () => {
          if (abortRef.current) abortRef.current.abort();
        }, []);

        // The dropdown closes on any mousedown outside it; Escape is handled by
        // the same document listener for keyboard users.
        React.useEffect(() => {
          if (!menuOpen) return undefined;
          const close = (event) => {
            if (menuRef.current && menuRef.current.contains(event.target)) return;
            setMenu(false);
          };
          document.addEventListener('mousedown', close, true);
          return () => document.removeEventListener('mousedown', close, true);
        }, [menuOpen]);

        const flat = (value) => String(value || '').trim().split('\n').filter((line) => line.trim()).slice(-3).join(' / ');

        // The Host streams one NDJSON event per line of output, then a done
        // event carrying the same readable summary a single answer used to.
        const streamAction = async (route, body, controller) => {
          const recent = { stdout: [], stderr: [] };
          const appendLog = (stream, text) => {
            const name = stream === 'stderr' ? 'stderr' : 'stdout';
            recent[name].push(text);
            if (recent[name].length > 3) recent[name].shift();
            setLog((prev) => ({
              ...prev,
              lines: (prev.lines.length >= 400 ? prev.lines.slice(-399) : prev.lines).concat([{ stream: name, text }]),
            }));
          };
          const consume = (text) => {
            let event;
            try { event = JSON.parse(text); } catch { return null; }
            if (!event || typeof event !== 'object') return null;
            if (event.type === 'line') appendLog(event.stream, String(event.text == null ? '' : event.text));
            return event.type === 'done' ? event : null;
          };
          const tailOf = (stream) => recent[stream].join('\n');

          setLog({ open: true, lines: [] });
          const response = await fetch(route, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          let done = null;
          if (response.ok && /application\/x-ndjson/i.test(response.headers.get('content-type') || '')) {
            if (!response.body || !response.body.getReader) throw new Error('response has no readable log stream');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              buffer += decoder.decode(chunk.value, { stream: true });
              let index;
              while ((index = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (line.trim()) done = consume(line) || done;
              }
            }
            buffer += decoder.decode();
            if (buffer.trim()) done = consume(buffer) || done;
          } else {
            // Policy refusals and older hosts answer with one JSON document.
            const payload = await response.json().catch(() => ({}));
            for (const stream of ['stdout', 'stderr']) {
              const text = String(payload[stream] || '');
              if (text) text.trimEnd().split('\n').forEach((value) => appendLog(stream, value));
            }
            done = {
              ok: response.ok && payload.ok === true,
              code: payload.code,
              error: payload.error || payload.stderr || payload.stdout || '',
            };
          }
          if (!done || !response.ok || !done.ok) {
            return {
              ok: false,
              code: done && done.code ? String(done.code) : '',
              sessions: done && done.sessions && typeof done.sessions === 'object' ? done.sessions : null,
              detail: flat((done && done.error) || tailOf('stderr') || tailOf('stdout') || translate('httpStatus', { status: response.status })),
            };
          }
          return { ok: true, code: '', sessions: null };
        };

        // Shared busy state and abort wiring; the caller writes the success
        // text and decides what to reload afterwards.
        const runAction = async (route, body, pending, failure, success) => {
          setSyncState({ busy: true, error: false, text: pending });
          const controller = new AbortController();
          abortRef.current = controller;
          try {
            const result = await streamAction(route, body, controller);
            // The guard answer is not a failure yet: the second confirmation
            // decides, so leave the status line alone instead of flashing an
            // error.
            if (result.code === ACTIVE_SESSION_CODE) {
              setSyncState({ busy: false, error: false, text: '' });
            } else {
              setSyncState({
                busy: false,
                error: !result.ok,
                text: result.ok ? success : translate(failure, { detail: result.detail }),
              });
            }
            return result;
          } catch (err) {
            if (controller.signal.aborted) return { ok: false, code: '', sessions: null, detail: '' };
            const detail = flat(err && err.message ? err.message : String(err));
            setSyncState({ busy: false, error: true, text: translate(failure, { detail }) });
            return { ok: false, code: '', sessions: null, detail };
          } finally {
            if (abortRef.current === controller) abortRef.current = null;
          }
        };

        // Restart-like actions run unforced first. A refusal carrying the
        // session summary asks a second time and only then resends with force,
        // so the default path stays one click when the remote is idle.
        const runGuarded = async (server, route, body, pending, failure, success) => {
          const first = await runAction(route, body, pending, failure, success);
          if (first.ok || first.code !== ACTIVE_SESSION_CODE) return first;
          const sessions = first.sessions || {};
          const count = Number(sessions.active) || 0;
          const minutes = Number(sessions.window) || 0;
          const ids = Array.isArray(sessions.ids) && sessions.ids.length
            ? translate('activeSessionsIds', { ids: sessions.ids.join(', ') })
            : '';
          if (typeof window.confirm !== 'function'
            || !window.confirm(translate('confirmActiveSessions', { host: server.label, count, minutes, ids }))) {
            setSyncState({ busy: false, error: false, text: translate('activeSessionsBlocked', { host: server.label, count }) });
            return first;
          }
          return runAction(route, { ...body, force: true }, pending, failure, success);
        };

        const sync = async (server, options) => {
          const restart = options.restart === true;
          const dryRun = options.dryRun === true;
          // Restarting drops whatever the remote is running; ask first.
          if (restart && typeof window.confirm === 'function'
            && !window.confirm(translate('confirmRestart', { host: server.label }))) return;
          const result = await runGuarded(
            server,
            SYNC_ROUTE,
            { host: server.id, restart, dryRun },
            dryRun ? translate('syncingPreview') : restart ? translate('syncingRestart') : translate('syncing'),
            'syncFailed',
            dryRun
              ? translate('previewDone')
              : restart
                ? translate('synced', { host: server.label })
                : translate('syncedNoRestart', { host: server.label }),
          );
          if (!result.ok) return;
          if (restart && !dryRun) {
            reload(server.id);
            readProbe(server, true);
          }
          pollStatus().catch(() => {});
        };

        // Install this app's dsh version on the host. The script restarts the
        // remote unit and waits for it to answer, so the frame can reload at
        // once; the proxy re-reads the new launch token on the first 401.
        const update = async (server) => {
          const to = s.localVersion ? translate('toVersion', { version: s.localVersion }) : '';
          if (typeof window.confirm === 'function'
            && !window.confirm(translate('confirmUpdate', { host: server.label, to }))) return;
          const result = await runGuarded(
            server,
            UPDATE_ROUTE,
            { host: server.id, restart: true },
            translate('updating'),
            'updateFailed',
            s.localVersion
              ? translate('updated', { host: server.label, version: s.localVersion })
              : translate('updatedLatest', { host: server.label }),
          );
          if (!result.ok) return;
          reload(server.id);
          pollStatus().catch(() => {});
          readProbe(server, true);
        };

        // First-time setup: Node, dsh, launchers, the systemd unit, optional
        // profile bundles, then a settings sync. The script is idempotent, so the
        // same action also repairs a half-provisioned host.
        const provision = async (server) => {
          if (typeof window.confirm === 'function'
            && !window.confirm(translate('confirmProvision', { host: server.label }))) return;
          const result = await runGuarded(
            server,
            PROVISION_ROUTE,
            { host: server.id, sync: true },
            translate('provisioning'),
            'provisionFailed',
            translate('provisionDone', { host: server.label }),
          );
          if (!result.ok) return;
          reload(server.id);
          pollStatus().catch(() => {});
          readProbe(server, true);
        };

        // Read the remote service/version summary. A probe error stays in the
        // probe line instead of replacing the last sync/update message.
        const readProbe = async (server, force) => {
          try {
            const response = await fetch(PROBE_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ host: server.id, force: force === true }),
            });
            const payload = await response.json().catch(() => ({}));
            const ok = response.ok && payload.ok === true;
            const next = {
              id: server.id,
              at: Number(payload.at) || Date.now(),
              info: ok ? payload.info || null : null,
              error: ok ? '' : flat(payload.error || translate('httpStatus', { status: response.status })),
            };
            setProbe(next);
            return next;
          } catch (err) {
            const next = { id: server.id, at: Date.now(), info: null, error: flat(err && err.message ? err.message : String(err)) };
            setProbe(next);
            return next;
          }
        };

        // Start/stop/restart the remote unit through the same streaming channel
        // as sync. Restart and stop drop whatever the remote is running, so ask
        // first; a started or restarted service also reloads the frame.
        const runService = async (server, action) => {
          const confirmKey = action === 'start' ? 'confirmServiceStart' : action === 'stop' ? 'confirmServiceStop' : 'confirmServiceRestart';
          const pendingKey = action === 'start' ? 'startingService' : action === 'stop' ? 'stoppingService' : 'restartingService';
          const doneKey = action === 'start' ? 'serviceStarted' : action === 'stop' ? 'serviceStopped' : 'serviceDone';
          if (typeof window.confirm === 'function'
            && !window.confirm(translate(confirmKey, { host: server.label }))) return;
          const result = await runGuarded(
            server,
            SERVICE_ROUTE,
            { host: server.id, action },
            translate(pendingKey),
            'serviceFailed',
            translate(doneKey, { host: server.label }),
          );
          if (!result.ok) return;
          if (action !== 'stop') reload(server.id);
          pollStatus().catch(() => {});
          readProbe(server, true);
        };

        // Log tail is a one-shot read; it lands in the same panel as the
        // streaming action output.
        const showLogs = async (server) => {
          setSyncState({ busy: true, error: false, text: translate('loadingLogs') });
          try {
            const response = await fetch(LOGS_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ host: server.id, lines: 200 }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.ok !== true) throw new Error(payload.error || translate('httpStatus', { status: response.status }));
            const lines = String(payload.text || '').replace(/\s+$/, '').split('\n');
            setLog({ open: true, lines: lines.slice(-400).map((text) => ({ stream: 'stdout', text })) });
            setSyncState({ busy: false, error: false, text: '' });
          } catch (err) {
            setSyncState({ busy: false, error: true, text: translate('logsFailed', { detail: flat(err && err.message ? err.message : String(err)) }) });
          }
        };

        const retry = async (server) => {
          setSyncState({ busy: true, error: false, text: translate('connecting') });
          try {
            const response = await fetch(RECONNECT_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ host: server.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || translate('httpStatus', { status: response.status }));
            setSyncState({ busy: false, error: false, text: '' });
            pollStatus().catch(() => {});
          } catch (err) {
            setSyncState({ busy: false, error: true, text: translate('reconnectFailed', { detail: err && err.message ? err.message : String(err) }) });
          }
        };

        const activeId = active ? active.id : null;
        React.useEffect(() => {
          if (!active) return undefined;
          // The remote page lives in a cross-origin iframe, so this only fires
          // while focus is still in the outer shell.
          const onKey = (event) => {
            if (event.key !== 'Escape') return;
            // An open actions menu owns Escape: close the menu and stay on the
            // remote page instead of jumping back from under the menu.
            if (menuOpenRef.current) {
              event.preventDefault();
              event.stopPropagation();
              setMenu(false);
              return;
            }
            backToLocal();
          };
          // A click on our own sidebar row toggles back: the shell re-selects the
          // panel during the same gesture, so switch back after it ran.
          const onRowClick = (event) => {
            if (!event.isTrusted || event.detail === 0) return;
            if (!isRowFor(event.target, active.id)) return;
            const now = Date.now();
            if (now - lastToggle.current < 500) return;
            lastToggle.current = now;
            console.info('[dsh-remote-hosts] toggling back to conversation');
            setTimeout(backToLocal, 0);
          };
          const visited = new Set(state.visited);
          visited.add(active.id);
          const inset = measureInset();
          if (inset !== state.inset || !state.visited.has(active.id)) setState({ ...state, visited, inset });
          // Remember the host that is on screen, so a reload can reopen it.
          writeStore(LAST_HOST_KEY, active.id);
          writeStore(OPEN_KEY, '1');
          pollStatus().catch(() => {});
          // Opening the host is what starts its tunnel; poll again once the
          // Host has begun connecting so the placeholder leaves "dormant".
          activateHost(active.id, true).then(() => { pollStatus().catch(() => {}); });
          const resync = () => {
            const next = measureInset();
            if (next !== state.inset) setState({ ...state, inset: next });
          };
          const timer = setInterval(() => { pollStatus().catch(() => {}); }, 3000);
          let observer = null;
          const nav = document.querySelector('nav');
          if (nav && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(resync);
            observer.observe(nav);
          }
          window.addEventListener('resize', resync);
          window.addEventListener('keydown', onKey);
          document.addEventListener('click', onRowClick, true);
          return () => {
            if (observer) observer.disconnect();
            clearInterval(timer);
            window.removeEventListener('resize', resync);
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('click', onRowClick, true);
            activateHost(active.id, false);
          };
        }, [activeId]);

        // Probe once when a host is opened, unless the Host already returned a
        // fresh cached summary in the status payload.
        React.useEffect(() => {
          if (!active) return;
          const cached = s.status[active.id] && s.status[active.id].probe;
          if (cached && cached.at && Date.now() - cached.at < 60000) setProbe({ id: active.id, ...cached });
          else readProbe(active, false).catch(() => {});
          setMenu(false);
        }, [activeId]);

        const entryFor = (server) => s.status[server.id] || null;
        const frameSrc = (server) => {
          const entry = entryFor(server);
          return (entry && entry.proxyUrl) || server.url || '';
        };
        const stateOf = (server) => {
          const entry = entryFor(server);
          if (!entry) return server.managed === true ? 'connecting' : 'external';
          return entry.state || 'external';
        };
        const dotColor = (state) => state === 'online'
          ? 'var(--dsw-alias-state-success-primary, #2f9e44)'
          : state === 'connecting'
            ? 'var(--dsw-alias-state-warning-primary, #f08c00)'
            : state === 'offline'
              ? 'var(--dsw-alias-state-error-primary, #d9534f)'
              : 'rgba(128,128,128,0.6)';
        const stateLabel = (server) => {
          const state = stateOf(server);
          if (state === 'online') return translate('online');
          if (state === 'connecting') return translate('connecting');
          if (state === 'offline') return translate('offline');
          if (state === 'dormant') return translate('dormant');
          if (state === 'external') return '';
          return translate('statusUnavailable');
        };
        // The Host adds this from the last probe; no probe means no badge.
        const updateFor = (server) => {
          const entry = entryFor(server);
          return entry && entry.update && entry.update.available ? entry.update : null;
        };
        const barStyle = (off) => ({
          cursor: off ? 'default' : 'pointer', font: 'inherit', border: 0,
          borderRadius: '8px', padding: '4px 10px', background: 'transparent',
          color: 'inherit', opacity: off ? 0.4 : 0.7,
        });

        // A Host reload forgets every activation. Wake the host that is on
        // screen again instead of leaving it dormant until the user switches
        // away and back.
        const dormantActive = !!(active && entryFor(active) && entryFor(active).state === 'dormant');
        React.useEffect(() => {
          if (!dormantActive || !active) return;
          activateHost(active.id, true).then(() => { pollStatus().catch(() => {}); });
        }, [activeId, dormantActive]);
        const disabled = syncState.busy || !active;
        // Only a host this plugin owns has an ssh target to update.
        const managed = !!(active && (active.managed === true || (entryFor(active) && entryFor(active).managed === true)));
        const activeEntry = active ? entryFor(active) : null;
        const activeUpdate = activeEntry && activeEntry.update && activeEntry.update.available ? activeEntry.update : null;
        const probeEntry = active
          ? (probe.id === active.id ? probe : (activeEntry && activeEntry.probe) || null)
          : null;
        const probeInfo = probeEntry && probeEntry.info;
        const probeText = probeInfo
          ? [
            probeInfo.dsh && probeInfo.dsh.version ? 'dsh ' + probeInfo.dsh.version : '',
            probeInfo.service && probeInfo.service.state ? probeInfo.service.state : '',
          ].filter(Boolean).join(' · ')
          : (probeEntry && probeEntry.error ? translate('probeUnavailable') : '');
        const serviceKnown = !!(probeInfo && probeInfo.service && typeof probeInfo.service.active === 'boolean');
        const serviceActive = serviceKnown && probeInfo.service.active === true;
        const menuItem = (label, run, off) => h('button', {
          key: label, type: 'button', role: 'menuitem', disabled: off === true,
          onClick: () => { setMenu(false); if (off !== true) run(); },
          style: {
            textAlign: 'left', cursor: off === true ? 'default' : 'pointer', border: 0,
            borderRadius: '6px', padding: '6px 10px', background: 'transparent',
            color: 'inherit', font: 'inherit', opacity: off === true ? 0.45 : 0.9,
          },
        }, label);

        return h('div', {
          style: {
            position: 'fixed', top: 0, right: 0, bottom: 0, left: s.inset + 'px',
            zIndex: 2000,
            display: active ? 'flex' : 'none',
            flexDirection: 'column',
            color: 'inherit',
          },
        },
          h('div', {
            // The chrome row covers the window's top band on macOS; the platform
            // turns this mark into the drag region.
            'data-window-drag': true,
            style: {
              display: 'flex', alignItems: 'center', columnGap: '6px', rowGap: '4px',
              flexWrap: 'wrap', minHeight: '40px',
              // Keep the controls clear of the traffic lights while the sidebar
              // is collapsed; the frame publishes the band on macOS.
              padding: '4px 10px 4px calc(10px + var(--dsh-frame-leading-clearance, 0px))',
              flex: '0 0 auto',
              borderBottom: '1px solid var(--dsh-border, rgba(128,128,128,0.25))',
              background: 'transparent', color: 'inherit', fontSize: '13px',
            },
          },
            h('button', {
              type: 'button',
              onClick: backToLocal,
              style: {
                cursor: 'pointer', border: '1px solid currentColor',
                borderRadius: '8px', padding: '4px 10px', background: 'transparent',
                color: 'inherit', font: 'inherit', opacity: 0.8,
              },
            }, translate('back')),
            servers.length === 0
              ? h('span', { style: { fontSize: '12px', opacity: 0.65 } }, translate('noServers'))
              : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
                h('span', {
                  style: {
                    display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                    background: dotColor(stateOf(active || servers[0])), flex: '0 0 auto',
                  },
                }),
                h('select', {
                  value: active ? active.id : '',
                  onChange: (event) => { if (event.target.value) openServer(event.target.value); },
                  title: translate('switchHost'),
                  'aria-label': translate('switchHost'),
                  style: {
                    cursor: 'pointer', font: 'inherit', fontSize: '13px',
                    border: '1px solid rgba(128,128,128,0.35)', borderRadius: '8px',
                    padding: '4px 8px', background: 'transparent', color: 'inherit',
                    maxWidth: '240px',
                  },
                },
                  ...servers.map((server) => h('option', {
                    key: server.id,
                    value: server.id,
                  }, server.label
                    + (stateLabel(server) ? ' · ' + stateLabel(server) : '')
                    + (updateFor(server) ? ' · ' + translate('updateAvailable') : '')))
                )
              ),
            activeUpdate
              ? h('span', {
                title: translate('updateAvailableTitle', { current: activeUpdate.current, target: activeUpdate.target }),
                style: {
                  fontSize: '11px', padding: '1px 7px', borderRadius: '999px',
                  border: '1px solid currentColor', whiteSpace: 'nowrap',
                  color: 'var(--dsw-alias-state-warning-primary, #f08c00)',
                },
              }, '↑ ' + translate('updateAvailable'))
              : null,
            h('button', {
              type: 'button',
              disabled,
              onClick: () => active && sync(active, { restart: true }),
              title: translate('sync'),
              style: barStyle(disabled),
            }, syncState.busy ? translate('syncBusy') : translate('sync')),
            managed
              ? h('button', {
                type: 'button',
                disabled: syncState.busy,
                onClick: () => active && update(active),
                title: translate('updateTitle'),
                style: barStyle(syncState.busy),
              }, translate('update'))
              : null,
            h('span', {
              ref: menuRef,
              style: { position: 'relative', display: 'inline-flex' },
            },
              h('button', {
                type: 'button',
                disabled: !active,
                onClick: () => setMenu(!menuOpenRef.current),
                title: translate('more'),
                'aria-label': translate('more'),
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen ? 'true' : 'false',
                style: barStyle(!active),
              }, '⋯'),
              menuOpen
                ? h('div', {
                  role: 'menu',
                  style: {
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
                    minWidth: '210px', display: 'flex', flexDirection: 'column', gap: '2px',
                    padding: '4px', color: 'inherit',
                    background: 'var(--dsw-alias-bg-layer-1, #fff)',
                    border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
                    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  },
                },
                  menuItem(translate('syncCopy'), () => sync(active, { restart: false }), disabled),
                  menuItem(translate('syncPreview'), () => sync(active, { restart: false, dryRun: true }), disabled),
                  menuItem(translate('probe'), () => readProbe(active, true), !managed || syncState.busy),
                  menuItem(translate('provision'), () => provision(active), !managed || syncState.busy),
                  menuItem(translate('restartService'), () => runService(active, 'restart'), !managed || syncState.busy),
                  serviceKnown && !serviceActive
                    ? menuItem(translate('startService'), () => runService(active, 'start'), !managed || syncState.busy)
                    : null,
                  serviceKnown && serviceActive
                    ? menuItem(translate('stopService'), () => runService(active, 'stop'), !managed || syncState.busy)
                    : null,
                  menuItem(translate('showLogs'), () => showLogs(active), !managed || syncState.busy),
                  menuItem(translate('reload'), () => reload(active.id), !active),
                  menuItem(translate('external'), () => window.open(frameSrc(active), '_blank', 'noopener'), !active)
                )
                : null
            ),
            syncState.text
              ? h('span', {
                style: { fontSize: '12px', opacity: 0.7, color: syncState.error ? 'var(--dsw-alias-state-error-primary, #d9534f)' : 'inherit' },
              }, syncState.text)
              : null,
            probeText
              ? h('span', {
                title: probeEntry && probeEntry.error ? probeEntry.error : undefined,
                style: { fontSize: '11px', opacity: 0.65, whiteSpace: 'nowrap' },
              }, probeText)
              : null,
            h('span', { style: { flex: 1 } }),
            log.open || log.lines.length
              ? h('button', {
                type: 'button',
                onClick: () => setLog((prev) => ({ ...prev, open: !prev.open })),
                title: log.open ? translate('logHide') : translate('logShow'),
                style: barStyle(false),
              }, log.open ? translate('logHide') : translate('log'))
              : null
          ),
          log.open
            ? h('div', {
              ref: logRef,
              role: 'log',
              'aria-label': translate('log'),
              style: {
                flex: '0 0 auto', maxHeight: '160px', overflowY: 'auto',
                padding: '6px 12px', fontSize: '11.5px', lineHeight: 1.55,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25))',
                background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))',
              },
            }, log.lines.length
              ? log.lines.map((entry, index) => h('div', {
                key: index,
                style: {
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: entry.stream === 'stderr'
                    ? 'var(--dsw-alias-state-error-primary, #d9534f)'
                    : 'var(--dsw-alias-label-secondary, inherit)',
                },
              }, entry.text || ' '))
              : h('div', { style: { opacity: 0.6 } }, syncState.busy ? translate('logWaiting') : translate('logEmpty')))
            : null,
          ...servers.filter((server) => s.visited.has(server.id) || (active && active.id === server.id)).map((server) => {
            const visible = active && active.id === server.id;
            const entry = entryFor(server);
            const managed = (entry && entry.managed === true) || server.managed === true;
            const state = stateOf(server);
            if (managed && state !== 'online') {
              return h('div', {
                key: server.id + ':panel',
                style: {
                  flex: 1, display: visible ? 'flex' : 'none', minHeight: 0,
                  alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                  gap: '10px', padding: '24px', textAlign: 'center',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                },
              },
                h('div', { style: { fontSize: '13px' } },
                  state === 'connecting' ? translate('connecting') : state === 'dormant' ? translate('dormant') : translate('offline')),
                state === 'offline' && entry && entry.error
                  ? h('div', {
                    style: {
                      fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d9534f)',
                      maxWidth: '560px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    },
                  }, entry.error)
                  : null,
                h('button', {
                  type: 'button',
                  disabled: syncState.busy,
                  onClick: () => retry(server),
                  style: {
                    cursor: syncState.busy ? 'default' : 'pointer', font: 'inherit',
                    border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
                    borderRadius: '8px', padding: '5px 12px',
                    background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit',
                    opacity: syncState.busy ? 0.5 : 1,
                  },
                }, translate('retryConnect'))
              );
            }
            return h('iframe', {
              key: server.id + ':' + (s.reload[server.id] || 0),
              src: frameSrc(server) || 'about:blank',
              title: server.label,
              // The desktop keyboard bridge forwards native input from a focused
              // iframe only when the frame carries one of its preview/browser
              // markers and its name matches the focused frame, so host
              // shortcuts keep working while the remote page has focus.
              name: 'remote-hosts-' + server.id,
              'data-html-preview': true,
              // The remote app copies file paths through navigator.clipboard, and a
              // cross-origin frame only gets that API when the host delegates it.
              allow: 'clipboard-write',
              style: {
                flex: 1, width: '100%', border: 0,
                background: 'var(--dsw-alias-bg-layer-1)', minHeight: 0,
                display: visible ? 'block' : 'none',
              },
            });
          })
        );
      };

      // The row's own click handler belongs to the shell and swallows clicks on the
      // icon, so the toggle is observed in the capture phase, before the shell
      // selects the panel. The row is identified by the marker on our own icon,
      // never by its text.
      const isRowFor = (target, id) => {
        const selector = '[data-remote-host="' + id + '"]';
        let el = target;
        for (let depth = 0; depth < 6 && el; depth += 1, el = el.parentElement) {
          if (!el.querySelector || !el.querySelector(selector)) continue;
          // Only accept a row-sized container, never the whole navigation column.
          const box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          if (box && box.height > 0 && box.height < 80) return true;
        }
        return false;
      };

      const installServers = (servers) => {
        if (disposed) return;
        for (const dispose of serverDisposers) {
          try { dispose(); } catch (error) { console.error('[dsh-remote-hosts] could not dispose a server registration', error); }
        }
        serverDisposers = [];
        servers.forEach((server, index) => {
          const panelId = 'remote-hosts/' + server.id;
          // The row can be hidden from the sidebar without losing the panel:
          // selectPanel() validates the keyed main entry, so a host toggled off
          // in the settings is still reachable from there and the overlay switcher.
          if (server.sidebar !== false) {
            serverDisposers.push(ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                { name: 'sidebar.panellist', id: panelId, order: 30 + index, label: () => server.label },
                () => icon(server)
              )));
          }
          serverDisposers.push(ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: panelId }, () => null)));
        });
      };

      const setStatus = (rows, localVersion) => {
        const next = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          if (!row || typeof row.id !== 'string') continue;
          next[row.id] = {
            managed: row.managed === true,
            state: typeof row.state === 'string' ? row.state : 'external',
            error: typeof row.error === 'string' ? row.error : '',
            proxyUrl: typeof row.proxyUrl === 'string' ? row.proxyUrl : '',
            probe: row.probe && typeof row.probe === 'object'
              ? { at: Number(row.probe.at) || 0, info: row.probe.info || null, error: typeof row.probe.error === 'string' ? row.probe.error : '' }
              : null,
            update: row.update && typeof row.update === 'object'
              ? {
                current: typeof row.update.current === 'string' ? row.update.current : '',
                target: typeof row.update.target === 'string' ? row.update.target : '',
                available: row.update.available === true,
              }
              : null,
            updatedAt: Number(row.updatedAt) || 0,
          };
        }
        const version = typeof localVersion === 'string' ? localVersion : state.localVersion;
        setState({ ...state, status: next, localVersion: version });
      };

      const setServers = (input) => {
        const next = normalizeServers(input);
        if (sameServers(state.servers, next)) return;
        // A visibility flip does not change ids, but the sidebar slot itself has
        // to be registered or disposed; labels and URLs can stay in place so an
        // open view survives an unrelated settings save.
        const visibilityChanged = state.servers.length === next.length
          && state.servers.some((server, index) => (server.sidebar !== false) !== (next[index].sidebar !== false));
        if (sameServerIds(state.servers, next)) {
          next.forEach((server, index) => Object.assign(state.servers[index], server));
          setState({ ...state, servers: state.servers.slice() });
          if (visibilityChanged) installServers(state.servers.slice());
          return;
        }
        setState({ ...state, servers: next });
        installServers(next);
      };

      const pollStatus = async () => {
        if (disposed || typeof fetch !== 'function') return undefined;
        const request = ++requestId;
        const response = await fetch(STATUS_ROUTE, { cache: 'no-store', headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (disposed || request !== requestId) return;
        const rows = payload && Array.isArray(payload.servers) ? payload.servers : null;
        if (!rows) throw new Error('unexpected status payload');
        setServers(rows);
        setStatus(rows, payload && payload.localVersion);
      };

      // The fallback rows are installed synchronously so the sidebar never waits
      // for the fetch; SlotRegistry.inject also waits for declarations, so the
      // later re-registration is safe when the fetched list differs.
      installServers(state.servers);
      pollStatus().catch((error) => {
        // Keep the built-in fallback when the Host half is unavailable; the
        // remote view still opens the default server.
        console.warn('[dsh-remote-hosts] status unavailable; using the built-in fallback', error);
      });

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'remote-hosts-view', order: 90, label: () => ctx.locale.bind(NS)('overlay') }, RemoteView));

      // Cmd/Ctrl+1..9 opens a host; the same shortcut on the host that is
      // already on screen returns to the conversation. It goes through the
      // platform registry instead of a raw keydown listener because the
      // desktop keyboard bridge only forwards input from a focused iframe for
      // registered commands; a DOM listener never sees those keys.
      ctx.inject(['shortcuts'], (shortcutCtx) => {
        shortcutCtx.effect(() => {
          const disposers = [];
          for (let index = 0; index < 9; index += 1) {
            const digit = String(index + 1);
            const binding = { code: 'Digit' + digit, modifiers: ['primary'] };
            try {
              disposers.push(shortcutCtx.shortcuts.register({
                id: 'remote-hosts.switch-' + digit,
                label: () => shortcutCtx.locale.bind(NS)('shortcutSwitch', { n: digit }),
                aliases: ['remote host ' + digit, 'switch host ' + digit],
                defaults: {
                  'desktop:macos': binding,
                  'desktop:windows': binding,
                  'desktop:linux': binding,
                },
                regions: ['page', 'editable', 'terminal'],
                modals: [],
                resolve: () => {
                  const server = state.servers[index];
                  if (!server) return { status: 'pass' };
                  const panelInfo = ctx.layout && ctx.layout.panelInfo;
                  const selected = panelInfo && typeof panelInfo.getSnapshot === 'function'
                    ? panelInfo.getSnapshot().activePanelId
                    : null;
                  return {
                    status: 'handled',
                    run: () => {
                      if (selected === 'remote-hosts/' + server.id) backToLocal();
                      else openServer(server.id);
                    },
                  };
                },
              }));
            } catch (error) {
              console.warn('[dsh-remote-hosts] could not register the host shortcut', error);
            }
          }
          return () => disposers.forEach((dispose) => dispose());
        }, 'remote-hosts: host shortcuts');
      });

      // Reopen the host that was on screen when the page last unloaded, unless
      // the user left through the back button.
      if (readStore(OPEN_KEY) === '1') {
        const last = readStore(LAST_HOST_KEY);
        if (last) setTimeout(() => { if (!disposed) openServer(last); }, 800);
      }

      if (typeof ctx.inject === 'function') {
        ctx.inject(['remote', 'remote.settings'], (remoteCtx) => {
          const store = createSettingsStore(remoteCtx);
          remoteCtx.effect(() => () => store.dispose(), 'dsh-remote-hosts: settings store');
          const Settings = (props) => h(SettingsForm, {
            ctx: remoteCtx,
            store,
            view: props && props.view,
            onOpen: (id) => openServer(id),
            onSaved: () => { pollStatus().catch(() => {}); },
          });
          for (const [name, key] of [
            ['plugins.row.config', PLUGIN_ID + '#' + PLUGIN_ID],
            ['plugins.bundle.config', PLUGIN_ID],
          ]) {
            remoteCtx.slots.inject(name, () => remoteCtx.slots.register({ name, key }, Settings));
          }
        });
      }
    }

    return { name: 'dsh-remote-hosts', inject: ['slots', 'layout', 'locale'], apply };
  },
});
