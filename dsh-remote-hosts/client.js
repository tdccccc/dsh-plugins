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
    const RECONNECT_ROUTE = '/api/remote-hosts/reconnect';
    const LAST_HOST_KEY = 'dsh-remote-hosts:last-host';
    const OPEN_KEY = 'dsh-remote-hosts:open';
    const readStore = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
    const writeStore = (key, value) => { try { window.localStorage.setItem(key, value); } catch {} };

    // Used until /api/remote-hosts/status answers, and whenever it fails.
    const FALLBACK_SERVERS = [
      { id: 'a100-146', label: 'A100-146', url: 'http://127.0.0.1:27994/' },
    ];

    const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

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
      statusUnavailable: 'Status unavailable',
      retryConnect: 'Retry',
      reconnectFailed: 'Reconnect failed: {detail}',
      switchTitle: 'Switch to this host (⌘/Ctrl+{n})',
      shortcutSwitch: 'Switch to remote host {n}',
      confirmRestart: 'Sync settings to {host} and restart the remote dsh-web?\n\nRestarting interrupts sessions running on the remote.',
      summary: 'Remote servers shown in the sidebar.',
      intro: 'Servers shown in the sidebar. The same list authorizes the sync route, so keep ids stable.',
      id: 'ID',
      label: 'Label',
      url: 'URL',
      idPlaceholder: 'a100-146',
      labelPlaceholder: 'A100-146',
      urlPlaceholder: 'http://127.0.0.1:27994/',
      add: 'Add server',
      remove: 'Remove',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard changes',
      saved: 'Saved.',
      saveFailed: 'Could not save:',
      loading: 'Loading settings…',
      retry: 'Retry',
      empty: 'No servers configured; the built-in default server is used.',
      hint: 'An empty list uses the built-in default. Ids must be unique and contain only letters, digits, and dashes. URLs must start with http:// or https://. sshHost is preserved; set it in the profile patch when the SSH host differs from the id.',
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
      statusUnavailable: '状态不可用',
      retryConnect: '重试',
      reconnectFailed: '重连失败：{detail}',
      switchTitle: '切换到此主机（⌘/Ctrl+{n}）',
      shortcutSwitch: '切换到远程主机 {n}',
      confirmRestart: '同步配置到 {host} 并重启远端 dsh-web？\n\n重启会中断远端正在运行的会话。',
      summary: '侧边栏中的远程服务器。',
      intro: '显示在侧边栏的服务器。同一份列表也决定同步接口允许的主机，请保持 id 稳定。',
      id: 'ID',
      label: '名称',
      url: '地址',
      idPlaceholder: 'a100-146',
      labelPlaceholder: 'A100-146',
      urlPlaceholder: 'http://127.0.0.1:27994/',
      add: '添加服务器',
      remove: '删除',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      saved: '已保存。',
      saveFailed: '保存失败：',
      loading: '正在加载设置…',
      retry: '重试',
      empty: '尚未配置服务器，将使用内置的默认服务器。',
      hint: '列表为空时使用内置默认服务器。id 必须唯一，只能包含字母、数字和连字符。地址必须以 http:// 或 https:// 开头。sshHost 会被保留；当 SSH 主机与 id 不同时，请在 profile patch 中设置。',
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
      return sshHost ? { id, label, url, sshHost, managed } : { id, label, url, managed };
    };

    // The Host half is authoritative; this copy only guards the fallback and
    // the list rendered while the request is in flight.
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
      return servers.length ? servers : FALLBACK_SERVERS.map((server) => ({ ...server }));
    };

    const sameServers = (left, right) =>
      left.length === right.length && left.every((server, index) => {
        const other = right[index];
        return server.id === other.id && server.label === other.label && server.url === other.url;
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
      servers: normalizeServers(FALLBACK_SERVERS),
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

    const copyServer = (value) => {
      const row = value && typeof value === 'object' ? value : {};
      return {
        id: typeof row.id === 'string' ? row.id : '',
        label: typeof row.label === 'string' ? row.label : '',
        url: typeof row.url === 'string' ? row.url : '',
        sshHost: typeof row.sshHost === 'string' ? row.sshHost : '',
      };
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
      draft.forEach((row, index) => {
        if (!row.id.trim() && !row.label.trim() && !row.url.trim() && !row.sshHost.trim()) return;
        const where = t('row') + ' ' + (index + 1) + ': ';
        const id = row.id.trim();
        if (!id) throw new Error(where + t('idRequired'));
        if (!ID_PATTERN.test(id)) throw new Error(where + t('badId'));
        if (ids.has(id)) throw new Error(where + t('duplicateId') + ' ' + id);
        ids.add(id);
        const url = parseHttpUrl(row.url);
        if (!url) throw new Error(where + t('badUrl'));
        const label = row.label.trim() || id;
        const sshHost = row.sshHost.trim();
        values.push(sshHost ? { id, label, url, sshHost } : { id, label, url });
      });
      return values;
    }

    function SettingsForm({ ctx, store, view, onSaved }) {
      const t = useTranslate(ctx.locale);
      const snapshot = useSource(store);
      const [draft, setDraft] = React.useState(null);
      const [revision, setRevision] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [failed, setFailed] = React.useState(false);
      const alive = React.useRef(true);
      const nextKey = React.useRef(0);

      const makeRow = (server) => {
        nextKey.current += 1;
        return {
          key: nextKey.current,
          id: typeof server.id === 'string' ? server.id : '',
          label: typeof server.label === 'string' ? server.label : '',
          url: typeof server.url === 'string' ? server.url : '',
          sshHost: typeof server.sshHost === 'string' ? server.sshHost : '',
        };
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

      if (view === 'summary') return t('summary');

      const patchRow = (index, key, value) => {
        setDraft((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
        setNotice('');
      };
      const addRow = () => {
        setDraft((current) => [...current, makeRow({ id: '', label: '', url: '', sshHost: '' })]);
        setNotice('');
      };
      const removeRow = (index) => {
        setDraft((current) => current.filter((_, i) => i !== index));
        setNotice('');
      };
      const discard = async () => {
        setNotice('');
        setFailed(false);
        await store.refresh();
        if (!alive.current) return;
        const current = store.getSnapshot();
        setDraft((current.servers || []).map(makeRow));
        setRevision(current.revision);
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
        h('p', null, t('intro')),
        snapshot.error ? h('p', { role: 'alert' }, snapshot.error) : null,
        h('div', { className: 'rh-grid rh-head' },
          h('span', null, t('id')),
          h('span', null, t('label')),
          h('span', null, t('url')),
          h('span', null, '')),
        ...draft.map((row, index) => h('div', { className: 'rh-grid', key: row.key },
          h('input', {
            type: 'text', value: row.id, placeholder: t('idPlaceholder'), 'aria-label': t('id'),
            spellCheck: false, disabled: busy,
            onChange: (event) => patchRow(index, 'id', event.target.value),
          }),
          h('input', {
            type: 'text', value: row.label, placeholder: t('labelPlaceholder'), 'aria-label': t('label'),
            disabled: busy,
            onChange: (event) => patchRow(index, 'label', event.target.value),
          }),
          h('input', {
            type: 'text', value: row.url, placeholder: t('urlPlaceholder'), 'aria-label': t('url'),
            spellCheck: false, disabled: busy,
            onChange: (event) => patchRow(index, 'url', event.target.value),
          }),
          h('button', {
            type: 'button', className: 'rh-remove', disabled: busy,
            title: t('remove'), 'aria-label': t('remove'),
            onClick: () => removeRow(index),
          }, '×')
        )),
        draft.length === 0 ? h('p', { className: 'rh-empty' }, t('empty')) : null,
        h('div', { className: 'rh-actions' },
          h('button', { type: 'button', disabled: busy, onClick: addRow }, t('add')),
          h('span', { className: 'rh-spacer' }),
          h('button', { type: 'submit', disabled: busy }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', disabled: busy, onClick: discard }, t('discard'))),
        notice ? h('p', { role: failed ? 'alert' : 'status', 'data-error': failed ? 'true' : undefined }, notice) : null,
        h('small', null, t('hint')));
    }

    const SETTINGS_CSS = `
.dsh-remote-hosts-settings{max-width:760px;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6}
.dsh-remote-hosts-settings p,.dsh-remote-hosts-settings small{color:var(--dsw-alias-label-secondary)}
.dsh-remote-hosts-settings .rh-grid{display:grid;grid-template-columns:minmax(110px,1fr) minmax(110px,1fr) minmax(190px,2fr) auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-remote-hosts-settings .rh-head{padding-top:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-remote-hosts-settings input{box-sizing:border-box;min-width:0;width:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;font:inherit;color:inherit}
.dsh-remote-hosts-settings button{padding:6px 12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;font:inherit;color:inherit}
.dsh-remote-hosts-settings button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-remote-hosts-settings button:disabled{opacity:.5;cursor:default}
.dsh-remote-hosts-settings :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-remote-hosts-settings .rh-remove{width:32px;padding:6px 0;line-height:1}
.dsh-remote-hosts-settings .rh-actions{display:flex;gap:8px;align-items:center;margin-top:14px}
.dsh-remote-hosts-settings .rh-spacer{flex:1}
.dsh-remote-hosts-settings .rh-empty{margin:10px 0 0;font-size:12px}
.dsh-remote-hosts-settings [data-error=true]{color:var(--dsw-alias-state-error-primary)}
@media(max-width:640px){.dsh-remote-hosts-settings .rh-grid{grid-template-columns:1fr 1fr}.dsh-remote-hosts-settings .rh-grid input:nth-child(3){grid-column:1/-1}.dsh-remote-hosts-settings .rh-remove{grid-column:2;justify-self:end}}
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
        const logRef = React.useRef(null);
        const abortRef = React.useRef(null);
        const lastToggle = React.useRef(0);

        React.useEffect(() => {
          const box = logRef.current;
          if (box) box.scrollTop = box.scrollHeight;
        }, [log.open, log.lines]);

        React.useEffect(() => () => {
          if (abortRef.current) abortRef.current.abort();
        }, []);

        const sync = async (server, options) => {
          const restart = options.restart === true;
          const dryRun = options.dryRun === true;
          // Restarting drops whatever the remote is running; ask first.
          if (restart && typeof window.confirm === 'function'
            && !window.confirm(translate('confirmRestart', { host: server.label }))) return;

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
          // The host streams one NDJSON event per line of output, then a done event.
          const consume = (text) => {
            let event;
            try { event = JSON.parse(text); } catch { return null; }
            if (!event || typeof event !== 'object') return null;
            if (event.type === 'line') appendLog(event.stream, String(event.text == null ? '' : event.text));
            return event.type === 'done' ? event : null;
          };
          const tailOf = (stream) => recent[stream].join('\n');
          const flat = (value) => String(value || '').trim().split('\n').filter((line) => line.trim()).slice(-3).join(' / ');

          setLog({ open: true, lines: [] });
          setSyncState({
            busy: true,
            error: false,
            text: dryRun ? translate('syncingPreview') : restart ? translate('syncingRestart') : translate('syncing'),
          });
          const controller = new AbortController();
          abortRef.current = controller;
          try {
            const response = await fetch(SYNC_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ host: server.id, restart, dryRun }),
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
              const detail = flat((done && done.error) || tailOf('stderr') || tailOf('stdout') || translate('httpStatus', { status: response.status }));
              setSyncState({ busy: false, error: true, text: translate('syncFailed', { detail }) });
              return;
            }
            setSyncState({
              busy: false,
              error: false,
              text: dryRun
                ? translate('previewDone')
                : restart
                  ? translate('synced', { host: server.label })
                  : translate('syncedNoRestart', { host: server.label }),
            });
            if (restart && !dryRun) reload(server.id);
            pollStatus().catch(() => {});
          } catch (err) {
            if (controller.signal.aborted) return;
            setSyncState({ busy: false, error: true, text: translate('syncFailed', { detail: flat(err && err.message ? err.message : String(err)) }) });
          } finally {
            if (abortRef.current === controller) abortRef.current = null;
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
          const onKey = (event) => { if (event.key === 'Escape') backToLocal(); };
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
          };
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
          if (state === 'external') return '';
          return translate('statusUnavailable');
        };
        const barStyle = (off) => ({
          cursor: off ? 'default' : 'pointer', font: 'inherit', border: 0,
          borderRadius: '8px', padding: '4px 10px', background: 'transparent',
          color: 'inherit', opacity: off ? 0.4 : 0.7,
        });
        const disabled = syncState.busy || !active;

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
            ...servers.map((server, index) =>
              h('button', {
                key: server.id,
                type: 'button',
                onClick: () => openServer(server.id),
                title: translate('switchTitle', { n: index + 1 }),
                style: {
                  cursor: 'pointer', font: 'inherit', border: 0, borderRadius: '8px',
                  padding: '4px 10px',
                  background: active && active.id === server.id ? 'rgba(128,128,128,0.18)' : 'transparent',
                  color: 'inherit',
                  opacity: active && active.id === server.id ? 1 : 0.65,
                },
              },
                h('span', {
                  style: {
                    display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                    marginRight: '6px', background: dotColor(stateOf(server)), verticalAlign: 'middle',
                  },
                }),
                server.label,
                stateLabel(server)
                  ? h('span', { style: { marginLeft: '6px', fontSize: '11px', opacity: 0.6 } }, stateLabel(server))
                  : null
              )
            ),
            h('button', {
              type: 'button',
              disabled,
              onClick: () => active && sync(active, { restart: true }),
              title: translate('sync'),
              style: barStyle(disabled),
            }, syncState.busy ? translate('syncBusy') : translate('sync')),
            h('button', {
              type: 'button',
              disabled,
              onClick: () => active && sync(active, { restart: false }),
              title: translate('syncCopy'),
              style: barStyle(disabled),
            }, translate('syncCopy')),
            h('button', {
              type: 'button',
              disabled,
              onClick: () => active && sync(active, { restart: false, dryRun: true }),
              title: translate('syncPreview'),
              style: barStyle(disabled),
            }, translate('syncPreview')),
            syncState.text
              ? h('span', {
                style: { fontSize: '12px', opacity: 0.7, color: syncState.error ? 'var(--dsw-alias-state-error-primary, #d9534f)' : 'inherit' },
              }, syncState.text)
              : null,
            h('span', { style: { flex: 1 } }),
            log.open || log.lines.length
              ? h('button', {
                type: 'button',
                onClick: () => setLog((prev) => ({ ...prev, open: !prev.open })),
                title: log.open ? translate('logHide') : translate('logShow'),
                style: barStyle(false),
              }, log.open ? translate('logHide') : translate('log'))
              : null,
            h('button', {
              type: 'button',
              onClick: () => active && reload(active.id),
              style: { cursor: 'pointer', background: 'transparent', border: 0, color: 'inherit', font: 'inherit', opacity: 0.7 },
            }, translate('reload')),
            h('button', {
              type: 'button',
              disabled: !active,
              onClick: () => { if (active) window.open(frameSrc(active), '_blank', 'noopener'); },
              style: barStyle(!active),
            }, translate('external'))
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
                h('div', { style: { fontSize: '13px' } }, state === 'connecting' ? translate('connecting') : translate('offline')),
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
          serverDisposers.push(ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: panelId, order: 30 + index, label: () => server.label },
              () => icon(server)
            )));
          // The keyed main entry is what selectPanel() validates; the overlay
          // reads the selection from the layout store, so it renders nothing.
          serverDisposers.push(ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: panelId }, () => null)));
        });
      };

      const setStatus = (rows) => {
        const next = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          if (!row || typeof row.id !== 'string') continue;
          next[row.id] = {
            managed: row.managed === true,
            state: typeof row.state === 'string' ? row.state : 'external',
            error: typeof row.error === 'string' ? row.error : '',
            proxyUrl: typeof row.proxyUrl === 'string' ? row.proxyUrl : '',
            updatedAt: Number(row.updatedAt) || 0,
          };
        }
        setState({ ...state, status: next });
      };

      const setServers = (input) => {
        const next = normalizeServers(input);
        if (sameServers(state.servers, next)) return;
        if (sameServerIds(state.servers, next)) {
          // Same rows in the same order: update labels and URLs in place so an
          // open view is not unmounted just because a setting changed.
          next.forEach((server, index) => Object.assign(state.servers[index], server));
          setState({ ...state, servers: state.servers.slice() });
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
        setStatus(rows);
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
