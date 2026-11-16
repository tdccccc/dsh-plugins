import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../client.js', import.meta.url));
const source = readFileSync(file, 'utf8');

// The dictionaries are plain objects in the module source; parsing them keeps
// the test free of the browser module loader.
const dictionary = (name) => {
  const start = source.indexOf('const ' + name + ' = {');
  assert.ok(start >= 0, name + ' dictionary exists');
  const end = source.indexOf('\n    };', start);
  assert.ok(end > start, name + ' dictionary ends');
  const keys = new Set();
  for (const match of source.slice(start, end).matchAll(/^      ([A-Za-z0-9]+):/gm)) keys.add(match[1]);
  return keys;
};

test('EN and ZH expose the same keys', () => {
  const en = dictionary('EN');
  const zh = dictionary('ZH');
  assert.equal(en.size, zh.size);
  for (const key of en) assert.ok(zh.has(key), 'ZH is missing ' + key);
  for (const key of zh) assert.ok(en.has(key), 'EN is missing ' + key);
});

test('Escape closes the actions menu before leaving the remote view', () => {
  const start = source.indexOf('const onKey = (event) =>');
  assert.ok(start > 0, 'the remote view has a key handler');
  const end = source.indexOf('window.addEventListener', start);
  assert.ok(end > start, 'the key handler ends before the listeners are bound');
  const body = source.slice(start, end);
  const guard = body.indexOf('menuOpenRef.current');
  const back = body.indexOf('backToLocal()');
  assert.ok(guard > 0, 'the handler checks whether the menu is open');
  assert.ok(back > guard, 'the menu check runs before backToLocal');
});

test('every literal translate() key is defined', () => {
  const en = dictionary('EN');
  const used = new Set();
  for (const match of source.matchAll(/translate\('([A-Za-z0-9]+)'/g)) used.add(match[1]);
  // These keys are passed through a variable for the failure message.
  used.add('syncFailed');
  used.add('updateFailed');
  used.add('serviceFailed');
  for (const key of used) assert.ok(en.has(key), 'missing locale key: ' + key);
});

test('the browser half registers and applies with the platform context', async () => {
  const registrations = [];
  globalThis.window = {
    __ModuleLoader__: { load(definition) { registrations.push(definition); } },
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  globalThis.fetch = async () => { throw new Error('offline'); };
  const react = {
    createElement() {},
    useSyncExternalStore() {},
    useCallback(fn) { return fn; },
    useEffect() {},
    useRef() {},
    useState() {},
    useReducer() {},
  };
  const requireMock = (name) => {
    if (name === 'react') return react;
    throw new Error('unexpected module: ' + name);
  };

  await import(file);
  assert.equal(registrations.length, 1);
  const api = registrations[0].factory(requireMock);
  assert.equal(api.name, 'dsh-remote-hosts');
  assert.equal(typeof api.apply, 'function');

  const registered = [];
  const ctx = {
    locale: {
      register(ns, language, dict) { registered.push({ ns, language, size: Object.keys(dict).length }); return () => {}; },
      bind() { return (key) => key; },
    },
    effect(fn) { const disposal = fn(); if (typeof disposal === 'function') disposal(); },
    slots: { inject: () => () => {}, register: () => () => {} },
    layout: { selectPanel() {} },
    inject() {},
  };
  api.apply(ctx);
  assert.deepEqual(registered.map((entry) => entry.language).sort(), ['en', 'zh', 'zh-CN']);
  for (const entry of registered) {
    assert.equal(entry.ns, 'remoteHosts');
    assert.equal(entry.size, dictionary('EN').size);
  }
});
