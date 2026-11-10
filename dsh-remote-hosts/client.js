// Browser half: left-sidebar rows open a remote view inset to the right of the
// sidebar. Returning to the conversation goes through ctx.layout.selectPanel(null),
// so the previous session comes back instead of a placeholder.
window.__ModuleLoader__.load({
  id: 'dsh-remote-hosts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SERVERS = [
      { id: 'a100-146', label: 'A100-146', url: 'http://127.0.0.1:27994/' },
    ];

    const listeners = new Set();
    let state = { active: null, visited: new Set(), reload: {}, inset: 280 };
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
        if (rect && rect.left < 40) return Math.max(0, Math.round(rect.right));
      } catch {}
      return 0;
    };

    const show = (id) => {
      const visited = new Set(state.visited); visited.add(id);
      setState({ ...state, active: id, visited, inset: measureInset() });
    };
    const hide = () => setState({ ...state, active: null });
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

    function apply(ctx) {
      const openServer = (id) => {
        try { ctx.layout.selectPanel('remote-hosts/' + id); } catch { show(id); }
      };
      const backToLocal = () => {
        try { ctx.layout.selectPanel(null); } catch { hide(); }
      };

      const RemoteView = () => {
        const s = useStore();
        const active = SERVERS.find((server) => server.id === s.active) || null;
        const [syncState, setSyncState] = React.useState({ busy: false, text: '', error: false });

        const sync = async (server) => {
          setSyncState({ busy: true, text: '同步中…', error: false });
          try {
            const response = await fetch('/remote-hosts/sync', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ host: server.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
              const detail = (payload.stderr || payload.error || ('HTTP ' + response.status)).trim().split('\n').slice(-2).join(' / ');
              setSyncState({ busy: false, text: '同步失败：' + detail, error: true });
            } else {
              setSyncState({ busy: false, text: '已同步到 ' + server.label + '，远程服务已重启', error: false });
            }
          } catch (err) {
            setSyncState({ busy: false, text: '同步失败：' + (err && err.message ? err.message : String(err)), error: true });
          }
        };

        React.useEffect(() => {
          if (!active) return undefined;
          const onKey = (event) => { if (event.key === 'Escape') backToLocal(); };
          const resync = () => {
            const inset = measureInset();
            if (inset !== state.inset) setState({ ...state, inset });
          };
          let observer = null;
          const nav = document.querySelector('nav');
          if (nav && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(resync);
            observer.observe(nav);
          }
          const timer = setInterval(resync, 400);
          window.addEventListener('resize', resync);
          return () => {
            if (observer) observer.disconnect();
            clearInterval(timer);
            window.removeEventListener('resize', resync);
          };
        }, [active && active.id]);

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
            style: {
              display: 'flex', alignItems: 'center', gap: '6px', height: '40px',
              padding: '0 10px', flex: '0 0 auto',
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
            }, '← 本地会话'),
            ...SERVERS.map((server) =>
              h('button', {
                key: server.id,
                type: 'button',
                onClick: () => openServer(server.id),
                style: {
                  cursor: 'pointer', font: 'inherit', border: 0, borderRadius: '8px',
                  padding: '4px 10px',
                  background: active && active.id === server.id ? 'rgba(128,128,128,0.18)' : 'transparent',
                  color: 'inherit',
                  opacity: active && active.id === server.id ? 1 : 0.65,
                },
              }, server.label)
            ),
            h('button', {
              type: 'button',
              disabled: syncState.busy || !active,
              onClick: () => active && sync(active),
              style: {
                cursor: syncState.busy ? 'default' : 'pointer', font: 'inherit', border: 0,
                borderRadius: '8px', padding: '4px 10px', background: 'transparent',
                color: 'inherit', opacity: syncState.busy ? 0.4 : 0.7,
              },
            }, syncState.busy ? '同步中…' : '同步配置'),
            syncState.text
              ? h('span', {
                style: { fontSize: '12px', opacity: 0.7, color: syncState.error ? '#d9534f' : 'inherit' },
              }, syncState.text)
              : null,
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              onClick: () => active && reload(active.id),
              style: { cursor: 'pointer', background: 'transparent', border: 0, color: 'inherit', font: 'inherit', opacity: 0.7 },
            }, '刷新')
          ),
          ...SERVERS.filter((server) => s.visited.has(server.id)).map((server) =>
            h('iframe', {
              key: server.id + ':' + (s.reload[server.id] || 0),
              src: server.url,
              title: server.label,
              // The remote app copies file paths through navigator.clipboard, and a
              // cross-origin frame only gets that API when the host delegates it.
              allow: 'clipboard-write',
              style: {
                flex: 1, width: '100%', border: 0, background: '#fff', minHeight: 0,
                display: active && active.id === server.id ? 'block' : 'none',
              },
            })
          )
        );
      };

      // The row's own click handler belongs to the shell and swallows clicks on the
      // icon, so the toggle is observed here, before the shell selects the panel.
      // The row is identified by the marker on our own icon, never by its text.
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

      SERVERS.forEach((server, index) => {
        const panelId = 'remote-hosts/' + server.id;
        let lastToggle = 0;
        const onDocumentClick = (event) => {
          if (state.active !== server.id) return;
          // Only a real user click, and only once per gesture.
          if (!event.isTrusted || event.detail === 0) return;
          if (!isRowFor(event.target, server.id)) return;
          const now = Date.now();
          if (now - lastToggle < 500) return;
          lastToggle = now;
          console.info('[dsh-remote-hosts] toggling back to conversation');
          setTimeout(() => { try { ctx.layout.selectPanel(null); } catch { hide(); } }, 0);
        };
        document.addEventListener('click', onDocumentClick, true);

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: panelId, order: 30 + index, label: () => server.label },
            () => icon(server)
          ));
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: panelId }, () => {
            React.useEffect(() => { show(server.id); return () => { hide(); }; }, []);
            return null;
          }));
      });

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'remote-hosts-view', order: 90, label: () => '远程视图' }, RemoteView));
    }

    return { name: 'dsh-remote-hosts', inject: ['slots', 'layout'], apply };
  },
});