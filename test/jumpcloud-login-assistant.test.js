const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const scriptPath = path.join(__dirname, '..', 'jumpcloud-login-assistant.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const emailForm = `<form method="post"><input name="email" type="email" required autocomplete="on">
  <input type="checkbox" checked><button type="submit" data-automation="loginButton">Continue</button></form>`;
const passwordForm = `<form method="post"><input type="email" readonly style="display:none">
  <input name="password" type="password" required autocomplete="on">
  <button type="button" aria-label="Toggle Password Visibility">Show</button>
  <button type="submit" data-automation="loginButton">Login</button></form>`;

function setup(t, options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(`<main>${options.html ?? emailForm}</main>`, {
    url: options.url ?? 'https://console.jumpcloud.com/login#/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  t.after(() => { window.close(); assert.deepEqual(errors, []); assert.deepEqual(sensitiveAccesses, []); });
  let now = 1_800_000_000_000;
  let focused = options.focused ?? true;
  let visible = options.visible ?? true;
  let sequence = 0;
  const timers = new Map();
  const menus = new Map();
  const values = options.values ?? new Map([['enabled', options.enabled ?? true]]);
  const originStorage = options.originStorage ?? new Map();
  const clicks = [];
  const sensitiveAccesses = [];
  const blocked = name => { sensitiveAccesses.push(name); throw new Error(`Forbidden access: ${name}`); };
  const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  for (const name of ['value', 'defaultValue']) {
    Object.defineProperty(window.HTMLInputElement.prototype, name, {
      configurable: true, get() { return blocked(name); }, set() { blocked(name); },
    });
  }
  const getAttribute = window.Element.prototype.getAttribute;
  window.Element.prototype.getAttribute = function (name) {
    if (name.toLowerCase() === 'value') return blocked('value attribute');
    return getAttribute.call(this, name);
  };
  for (const name of ['FormData', 'fetch', 'XMLHttpRequest', 'WebSocket']) window[name] = () => blocked(name);
  Object.defineProperty(window, 'sessionStorage', { get: () => blocked('sessionStorage') });
  Object.defineProperty(document, 'cookie', { get: () => blocked('cookie'), set: () => blocked('cookie') });
  window.navigator.sendBeacon = () => blocked('sendBeacon');
  Object.defineProperty(window.navigator, 'clipboard', { get: () => blocked('clipboard') });
  const attemptKey = 'chann.jumpcloud-login-assistant.attempts.v1';
  Object.defineProperty(window, 'localStorage', { value: {
    getItem(key) {
      assert.equal(key, attemptKey); // No access to JumpCloud's own stored account/session data.
      if (options.readFailure) throw new Error('storage unavailable');
      return originStorage.get(key) ?? null;
    },
    setItem(key, data) {
      assert.equal(key, attemptKey);
      if (options.writeFailure) throw new Error('storage unavailable');
      for (const [stage, at] of Object.entries(JSON.parse(data))) {
        assert.ok(['email', 'password'].includes(stage)); assert.equal(typeof at, 'number');
      }
      originStorage.set(key, data);
    },
  } });
  for (const [prototype, name] of [
    [window.Element.prototype, 'innerHTML'], [window.Element.prototype, 'outerHTML'],
    [window.Node.prototype, 'textContent'],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    Object.defineProperty(prototype, name, { ...descriptor, get() { return blocked(name); } });
  }
  for (const name of ['log', 'warn', 'error', 'info', 'debug']) window.console[name] = () => blocked(`console.${name}`);
  document.hasFocus = () => focused;
  Object.defineProperty(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
  // jsdom has no layout engine; preserve hidden styles/ancestors in the visibility fixture.
  window.Element.prototype.getClientRects = function () {
    return this.closest('[hidden], [inert], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]')
      ? [] : [{ width: 100, height: 30 }];
  };
  window.Date.now = () => now;
  window.setTimeout = (fn, delay = 0) => {
    const id = ++sequence; timers.set(id, { fn, due: now + delay }); return id;
  };
  window.setInterval = (fn, delay) => {
    const id = ++sequence; timers.set(id, { fn, due: now + delay, repeat: delay }); return id;
  };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.GM_getValue = (key, fallback) => {
    if (options.readFailure) throw new Error('storage unavailable');
    return structuredClone(values.has(key) ? values.get(key) : fallback);
  };
  window.GM_setValue = (key, data) => {
    if (options.writeFailure) throw new Error('storage unavailable');
    assert.equal(key, 'enabled');
    assert.equal(typeof data, 'boolean');
    values.set(key, structuredClone(data));
  };
  window.GM_registerMenuCommand = (name, fn) => menus.set(name, fn);
  if (!options.noLocks) window.navigator.locks = options.locks ?? { request: async (_name, _options, fn) => fn({}) };
  document.addEventListener('click', event => {
    if (!event.target.matches('[data-automation="loginButton"]')) return;
    event.preventDefault();
    clicks.push(document.querySelector('input[name="password"]') ? 'password' : 'email');
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const h = {
    window, document, clicks, menus, values, originStorage, sensitiveAccesses, timers,
    fill(name, data, emit = true) {
      const input = document.querySelector(`input[name="${name}"]`);
      nativeValue.set.call(input, data);
      if (emit) input.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    async advance(ms = 1500) {
      const target = now + ms;
      await flush();
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.repeat) timer.due += timer.repeat;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
    passwordStep() { document.querySelector('main').innerHTML = passwordForm; },
    async menu(suffix) {
      const entry = [...menus].find(([label]) => label.endsWith(suffix));
      assert.ok(entry, `Missing menu: ${suffix}`);
      await entry[1](); await flush();
    },
    activity(isActive) { focused = visible = isActive; document.dispatchEvent(new window.Event('visibilitychange')); },
    navigate(url) { window.history.pushState({}, '', url); window.dispatchEvent(new window.PopStateEvent('popstate')); },
  };
  window.eval(source);
  return h;
}

test('advances both login steps without reading or copying credentials', async t => {
  const h = setup(t);
  h.fill('email', 'fixture@example.test');
  await h.advance();
  assert.deepEqual(h.clicks, ['email']);
  h.passwordStep();
  h.fill('password', 'fixture-only-password');
  await h.advance();
  assert.deepEqual(h.clicks, ['email', 'password']);
  assert.deepEqual(h.sensitiveAccesses, []);
  await h.advance(600_000);
  assert.deepEqual(h.clicks, ['email', 'password']);
});

test('starts disabled and enables only through the manager menu', async t => {
  const h = setup(t, { enabled: false });
  h.fill('email', 'fixture@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []);
  await h.menu('자동 진행 켜기/끄기'); await h.advance();
  assert.deepEqual(h.clicks, ['email']);
  assert.equal(h.values.get('enabled'), true);
});

test('waits for required validity and stable autofill, including fills without events', async t => {
  const h = setup(t);
  await h.advance(); assert.deepEqual(h.clicks, []);
  h.fill('email', 'invalid'); await h.advance(); assert.deepEqual(h.clicks, []);
  h.fill('email', 'fixture@example.test', false);
  await h.advance(900); assert.deepEqual(h.clicks, []);
  await h.advance(1100); assert.deepEqual(h.clicks, ['email']);
});

for (const type of ['beforeinput', 'paste', 'compositionstart']) {
  test(`manual ${type} cancels automatic submission without inspecting event data`, async t => {
    const h = setup(t);
    const event = new h.window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'data', { get() { throw new Error('credential event read'); } });
    h.document.querySelector('input').dispatchEvent(event);
    h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []);
    await h.menu('다시 시도'); await h.advance();
    assert.deepEqual(h.clicks, ['email']);
  });
}

for (const options of [{ focused: false }, { visible: false }]) {
  test(`holds submission in inactive tabs: ${JSON.stringify(options)}`, async t => {
    const h = setup(t, options);
    h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []);
    h.activity(true); await h.advance(); assert.deepEqual(h.clicks, ['email']);
  });
}

for (const url of [
  'http://console.jumpcloud.com/login#/', 'https://console.jumpcloud.com.evil.test/login#/',
  'https://console.jumpcloud.com:444/login#/', 'https://console.jumpcloud.com/login-other',
  'https://console.jumpcloud.com/admin', 'https://console.jumpcloud.com/login#/reset',
  'https://console.jumpcloud.com/login?error=denied#/', 'https://console.jumpcloud.com/login?step=mfa#/',
  'https://console.jumpcloud.com/login?redirectTo=https://evil.test#/',
]) {
  test(`does not run on unapproved URL: ${url}`, async t => {
    const h = setup(t, { url }); h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []);
  });
}

for (const [label, html] of [
  ['multiple login forms', emailForm + emailForm],
  ['unrecognized button', emailForm.replace('data-automation="loginButton"', '')],
  ['external action', emailForm.replace('<form', '<form action="https://evil.test/"')],
  ['external submit override', emailForm.replace('<button', '<button formaction="https://evil.test/"')],
  ['GET form', emailForm.replace('method="post"', 'method="get"')],
  ['blank target', emailForm.replace('<form', '<form target="_blank"')],
  ['optional field', emailForm.replace(' required', '')],
  ['disabled button', emailForm.replace('<button', '<button disabled')],
  ['hidden form', emailForm.replace('<form', '<form hidden')],
  ['MFA input', emailForm.replace('</form>', '<input autocomplete="one-time-code" required></form>')],
  ['additional textarea', emailForm.replace('</form>', '<textarea></textarea></form>')],
  ['reset password field', passwordForm.replace('autocomplete="on"', 'autocomplete="new-password"')],
  ['second password', emailForm.replace('</form>', '<input name="password" type="password" required></form>')],
  ['disabled fieldset', emailForm.replace('<input name="email"', '<fieldset disabled><input name="email"').replace('</form>', '</fieldset></form>')],
  ['base URL override', '<base href="https://evil.test/">' + emailForm],
  ['novalidate', emailForm.replace('<form', '<form novalidate')],
  ['busy button', emailForm.replace('<button', '<button aria-busy="true"')],
  ['visible alert', emailForm + '<div role="alert">Authentication failed</div>'],
  ['JumpCloud alert', emailForm + '<div class="LoginAlert_loginAlert_fixture">Authentication failed</div>'],
]) {
  test(`holds unsafe or unsupported form: ${label}`, async t => {
    const h = setup(t, { html });
    if (h.document.querySelector('input[name="email"]')) h.fill('email', 'fixture@example.test');
    if (h.document.querySelector('input[name="password"]')) h.fill('password', 'fixture-only-password');
    await h.advance();
    assert.deepEqual(h.clicks, []);
  });
}

test('rechecks the candidate after its DOM is replaced or disabled', async t => {
  const h = setup(t);
  h.fill('email', 'fixture@example.test'); await h.advance(750);
  h.document.querySelector('main').innerHTML = emailForm;
  await h.advance(); assert.deepEqual(h.clicks, []);
  h.fill('email', 'fixture@example.test'); await h.advance(750);
  h.document.querySelector('button').disabled = true;
  await h.advance(); assert.deepEqual(h.clicks, []);
  h.document.querySelector('button').disabled = false;
  await h.advance(); assert.deepEqual(h.clicks, ['email']);
});

test('stays stopped after leaving the login route and returning', async t => {
  const h = setup(t);
  h.fill('email', 'fixture@example.test'); await h.advance(750);
  h.navigate('/login?step=mfa'); await h.advance();
  h.navigate('/login#/'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

for (const options of [{ noLocks: true }, { readFailure: true }, { writeFailure: true }]) {
  test(`fails closed when coordination is unavailable: ${JSON.stringify(options)}`, async t => {
    const h = setup(t, options); h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []);
  });
}

test('cooldown persists across reloads, but an email attempt permits the password step', async t => {
  const first = setup(t); first.fill('email', 'fixture@example.test'); await first.advance();
  const second = setup(t, { values: first.values, originStorage: first.originStorage });
  second.fill('email', 'fixture@example.test'); await second.advance();
  assert.deepEqual(second.clicks, []);
  const password = setup(t, { values: first.values, originStorage: first.originStorage, html: passwordForm, url: 'https://console.jumpcloud.com/login?step=password#/' });
  password.fill('password', 'fixture-only-password'); await password.advance();
  assert.deepEqual(password.clicks, ['password']);
  const reloaded = setup(t, { values: first.values, originStorage: first.originStorage });
  reloaded.fill('email', 'fixture@example.test'); await reloaded.advance();
  assert.deepEqual(reloaded.clicks, []);
  await reloaded.menu('다시 시도'); await reloaded.advance();
  assert.deepEqual(reloaded.clicks, ['email']);
});

test('two active contexts share one attempt under the origin lock', async t => {
  let held = false;
  const locks = { request: async (_name, _options, callback) => {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } };
  const values = new Map([['enabled', true]]);
  const originStorage = new Map();
  const first = setup(t, { values, locks, originStorage }); const second = setup(t, { values, locks, originStorage });
  first.fill('email', 'fixture@example.test'); second.fill('email', 'second@example.test');
  await Promise.all([first.advance(), second.advance()]);
  assert.equal(first.clicks.length + second.clicks.length, 1);
});

test('duplicate prevention does not rely on immediately synchronized GM caches', async t => {
  const originStorage = new Map();
  const first = setup(t, { originStorage }); const second = setup(t, { originStorage });
  first.fill('email', 'fixture@example.test'); await first.advance();
  second.fill('email', 'second@example.test'); await second.advance();
  assert.equal(first.clicks.length + second.clicks.length, 1);
});

test('stop, disable and Escape cancel pending work', async t => {
  for (const action of ['현재 페이지 중지', '자동 진행 켜기/끄기', 'escape']) {
    const h = setup(t); h.fill('email', 'fixture@example.test'); await h.advance(750);
    if (action === 'escape') h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    else await h.menu(action);
    await h.advance(); assert.deepEqual(h.clicks, []);
  }
});

test('manual submission prevents a later automatic duplicate', async t => {
  const h = setup(t); h.fill('email', 'fixture@example.test');
  h.document.querySelector('button').click(); await h.advance();
  assert.deepEqual(h.clicks, ['email']);
});

test('the execution expires and cannot submit when autofill arrives later', async t => {
  const h = setup(t); await h.advance(121_000);
  h.fill('email', 'fixture@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []);
  assert.equal(h.timers.size, 0);
});

test('a late MFA challenge cancels a pending lock callback before any click', async t => {
  let release;
  const locks = { request: (_name, _options, callback) => new Promise(resolve => {
    release = () => resolve(callback({}));
  }) };
  const h = setup(t, { locks }); h.fill('email', 'fixture@example.test'); await h.advance();
  const otp = h.document.createElement('input'); otp.autocomplete = 'one-time-code';
  h.document.body.append(otp);
  release(); await h.advance(0);
  assert.deepEqual(h.clicks, []);
});

test('retry handles storage rejection without an unhandled promise', async t => {
  const options = {};
  const h = setup(t, options);
  options.readFailure = true;
  await h.menu('다시 시도'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

for (const record of ['broken json', 'null', '[]', '{"email":"yesterday"}', '{"unexpected":1}']) {
  test(`invalid cooldown data fails closed: ${record}`, async t => {
    const originStorage = new Map([['chann.jumpcloud-login-assistant.attempts.v1', record]]);
    const h = setup(t, { originStorage }); h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []);
  });
}

test('hidden alerts and normal fieldset markup do not prevent login', async t => {
  const html = emailForm.replace('<input name="email"', '<fieldset><input name="email"')
    .replace('</form>', '</fieldset></form>') + '<div role="alert" hidden>Old message</div>';
  const h = setup(t, { html }); h.fill('email', 'fixture@example.test'); await h.advance();
  assert.deepEqual(h.clicks, ['email']);
});

test('new input events reset the stability window before submitting', async t => {
  const h = setup(t); h.fill('email', 'fixture@example.test'); await h.advance(750);
  h.fill('email', 'updated@example.test'); await h.advance(750);
  assert.deepEqual(h.clicks, []);
  await h.advance(750); assert.deepEqual(h.clicks, ['email']);
});

test('expired timestamps permit a new execution while future timestamps fail closed', async t => {
  for (const [at, expected] of [[1_799_999_399_999, ['email']], [1_800_000_100_000, []]]) {
    const originStorage = new Map([['chann.jumpcloud-login-assistant.attempts.v1', JSON.stringify({ password: at })]]);
    const h = setup(t, { originStorage }); h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, expected);
  }
});

test('a rejected old lock cannot stop a newly started execution', async t => {
  let rejectOld;
  let requests = 0;
  const locks = { request: (_name, _options, callback) => {
    if (++requests === 1) return new Promise((_resolve, reject) => { rejectOld = reject; });
    return Promise.resolve(callback({}));
  } };
  const h = setup(t, { locks }); h.fill('email', 'fixture@example.test'); await h.advance();
  await h.menu('다시 시도');
  rejectOld(new Error('old request failed')); await h.advance();
  assert.deepEqual(h.clicks, ['email']);
});
