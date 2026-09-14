const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('node:crypto');

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
  const dialogs = [];
  const attachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options); dialogs.push(root); return root;
  };
  Object.defineProperty(window, 'crypto', { value: options.crypto ?? webcrypto });
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.confirm = () => options.confirmDelete ?? true;
  const blocked = name => { sensitiveAccesses.push(name); throw new Error(`Forbidden access: ${name}`); };
  const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  for (const name of ['value', 'defaultValue']) {
    Object.defineProperty(window.HTMLInputElement.prototype, name, {
      configurable: true,
      get() { return options.allowCredentials && name === 'value' ? nativeValue.get.call(this) : blocked(name); },
      set(data) { if (options.allowCredentials && name === 'value') nativeValue.set.call(this, data); else blocked(name); },
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
    assert.ok(['enabled', 'vault'].includes(key));
    if (key === 'enabled') assert.equal(typeof data, 'boolean');
    else assert.deepEqual(Object.keys(data).sort(), ['ciphertext', 'iterations', 'iv', 'kdf', 'salt', 'v']);
    values.set(key, structuredClone(data));
  };
  window.GM_deleteValue = key => {
    assert.equal(key, 'vault'); if (options.deleteFailure) throw new Error('storage unavailable'); values.delete(key);
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
    window, document, clicks, menus, values, originStorage, sensitiveAccesses, timers, dialogs, options,
    get dialog() { return dialogs.at(-1); },
    readField(name) { return nativeValue.get.call(document.querySelector(`input[name="${name}"]`)); },
    async submitDialog(fields) {
      const root = this.dialog;
      for (const [name, data] of Object.entries(fields)) nativeValue.set.call(root.querySelector(`[name="${name}"]`), data);
      root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      const deadline = Date.now() + 5000;
      while (root.host.isConnected && root.querySelector('button[type="submit"]').disabled) {
        assert.ok(Date.now() < deadline, 'Vault operation timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await flush();
    },
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

const vaultInput = {
  email: 'vault-fixture@example.test', password: 'fixture-login-password',
  passphrase: 'fixture vault passphrase 2026', confirmation: 'fixture vault passphrase 2026',
};

async function configureVault(t, options = {}) {
  const h = setup(t, { ...options, allowCredentials: true });
  await h.menu('로그인 정보 설정');
  await h.submitDialog(vaultInput);
  assert.ok(h.values.get('vault'), 'Expected encrypted vault');
  return h;
}

async function decryptFixture(record, passphrase = vaultInput.passphrase) {
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(record.salt, 'base64'), iterations: 600000 }, material,
    { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const bytes = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(record.iv, 'base64'),
    additionalData: new TextEncoder().encode('chann.jumpcloud-login-assistant.vault.v1'), tagLength: 128 }, key, Buffer.from(record.ciphertext, 'base64'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

test('vault stores authenticated ciphertext in GM, with no plaintext or unlock key', async t => {
  const h = await configureVault(t);
  const record = h.values.get('vault');
  assert.equal(record.v, 1); assert.equal(record.kdf, 'PBKDF2-SHA256'); assert.equal(record.iterations, 600000);
  assert.equal(Buffer.from(record.salt, 'base64').length, 16);
  assert.equal(Buffer.from(record.iv, 'base64').length, 12);
  assert.deepEqual(await decryptFixture(record), { email: vaultInput.email, password: vaultInput.password });
  const persisted = JSON.stringify([...h.values, ...h.originStorage]);
  for (const data of Object.values(vaultInput)) assert.ok(!persisted.includes(data));
  assert.deepEqual(h.clicks, []);
  assert.equal(h.dialog.host.isConnected, false);
});

test('unlocked vault fills the configured account and password then locks after submission', async t => {
  const h = await configureVault(t);
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  await h.advance();
  assert.equal(h.readField('email'), vaultInput.email); assert.deepEqual(h.clicks, ['email']);
  h.passwordStep();
  h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.advance();
  assert.equal(h.readField('password'), vaultInput.password);
  assert.deepEqual(h.clicks, ['email', 'password']);
  await h.menu('다시 시도'); await h.advance();
  assert.deepEqual(h.clicks, ['email', 'password']);
});

test('a locked saved vault never submits browser-autofilled credentials', async t => {
  const stored = await configureVault(t);
  const h = setup(t, { values: stored.values, allowCredentials: true });
  h.fill('email', 'another@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

test('wrong passphrase or tampered ciphertext cannot unlock or change stored data', async t => {
  const h = await configureVault(t);
  const original = structuredClone(h.values.get('vault'));
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: 'incorrect fixture passphrase' });
  await h.advance(); assert.deepEqual(h.clicks, []); assert.deepEqual(h.values.get('vault'), original);
  const tampered = { ...original, ciphertext: (original.ciphertext[0] === 'A' ? 'B' : 'A') + original.ciphertext.slice(1) };
  h.values.set('vault', tampered);
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  await h.advance(); assert.deepEqual(h.clicks, []); assert.deepEqual(h.values.get('vault'), tampered);
});

test('vault refuses to fill a password for a different or missing account', async t => {
  const stored = await configureVault(t);
  for (const email of ['other@example.test', '']) {
    const h = setup(t, { values: stored.values, allowCredentials: true, html: passwordForm });
    h.document.querySelector('input[readonly]').value = email;
    await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase }); await h.advance();
    assert.equal(h.readField('password'), ''); assert.deepEqual(h.clicks, []);
  }
});

test('vault does not overwrite a different prefilled email', async t => {
  const h = await configureVault(t); h.fill('email', 'other@example.test');
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase }); await h.advance();
  assert.equal(h.readField('email'), 'other@example.test'); assert.deepEqual(h.clicks, []);
});

test('stop clears an injected password before submission and requires unlocking again', async t => {
  const h = await configureVault(t);
  h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  await h.advance(500); assert.equal(h.readField('password'), vaultInput.password);
  await h.menu('현재 페이지 중지'); assert.equal(h.readField('password'), '');
  await h.menu('다시 시도'); await h.advance(); assert.deepEqual(h.clicks, []);
});

test('vault setup rejects weak, mismatched, or reused unlock passwords', async t => {
  for (const change of [{ passphrase: 'short', confirmation: 'short' }, { confirmation: 'different' },
    { passphrase: vaultInput.password, confirmation: vaultInput.password }]) {
    const h = setup(t, { allowCredentials: true }); await h.menu('로그인 정보 설정');
    await h.submitDialog({ ...vaultInput, ...change });
    assert.equal(h.values.has('vault'), false); assert.deepEqual(h.clicks, []);
  }
});

test('replacing vault data uses fresh salt and IV and preserves the old record on failure', async t => {
  const h = await configureVault(t); const first = h.values.get('vault');
  await h.menu('로그인 정보 설정'); await h.submitDialog(vaultInput);
  const second = h.values.get('vault');
  assert.notEqual(first.salt, second.salt); assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await decryptFixture(second), { email: vaultInput.email, password: vaultInput.password });
  h.options.writeFailure = true;
  await h.menu('로그인 정보 설정'); await h.submitDialog(vaultInput);
  assert.deepEqual(h.values.get('vault'), second);
});

test('deleting the vault removes GM ciphertext and disables automatic login', async t => {
  const h = await configureVault(t); await h.menu('저장 정보 삭제');
  assert.equal(h.values.has('vault'), false); assert.equal(h.values.get('enabled'), false);
  await h.advance(); assert.deepEqual(h.clicks, []);
});

test('hiding the page locks the vault and wipes an unsubmitted injected password', async t => {
  const h = await configureVault(t); h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  assert.equal(h.readField('password'), vaultInput.password);
  h.activity(false); assert.equal(h.readField('password'), '');
  h.activity(true); await h.advance(); assert.deepEqual(h.clicks, []);
});

test('vault fills an empty password even while JumpCloud disables its login button', async t => {
  const h = await configureVault(t); h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  const button = h.document.querySelector('[data-automation="loginButton"]'); button.disabled = true;
  h.document.querySelector('input[name="password"]').addEventListener('input', () => { button.disabled = false; });
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  await h.advance(); assert.deepEqual(h.clicks, ['password']);
});

test('account changes during the stability window prevent password submission', async t => {
  const h = await configureVault(t); h.passwordStep(); const email = h.document.querySelector('input[readonly]'); email.value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  await h.advance(500); email.value = 'other@example.test';
  await h.advance(); assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), '');
});

test('locking preserves a password that the user replaced manually', async t => {
  const h = await configureVault(t); h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  h.fill('password', 'manual-fixture-password');
  await h.advance(); assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), 'manual-fixture-password');
});

test('cancelled deletion preserves ciphertext while failed deletion still disables login', async t => {
  const h = await configureVault(t); const original = h.values.get('vault');
  h.options.confirmDelete = false; await h.menu('저장 정보 삭제'); assert.deepEqual(h.values.get('vault'), original);
  h.options.confirmDelete = true; h.options.deleteFailure = true;
  await h.menu('저장 정보 삭제');
  assert.deepEqual(h.values.get('vault'), original); assert.equal(h.values.get('enabled'), false);
});

for (const change of [{ v: 2 }, { iterations: 1 }, { iterations: 1e12 }, { iv: 'invalid' }, { salt: 'A'.repeat(10000) }]) {
  test(`invalid vault metadata fails closed before deriving a key: ${Object.keys(change)[0]}=${String(Object.values(change)[0]).slice(0, 20)}`, async t => {
    let derives = 0;
    const crypto = { subtle: { deriveKey() { derives++; throw new Error('Must not derive'); } } };
    const record = { v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: Buffer.alloc(16).toString('base64'),
      iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(32).toString('base64'), ...change };
    const h = setup(t, { allowCredentials: true, crypto, values: new Map([['enabled', true], ['vault', record]]) });
    await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
    assert.equal(derives, 0); assert.deepEqual(h.clicks, []);
  });
}

function delayedCrypto(method) {
  let release, completed;
  const gate = new Promise(resolve => { release = resolve; });
  const done = new Promise(resolve => { completed = resolve; });
  const subtle = new Proxy(webcrypto.subtle, { get(target, key) {
    if (key === method) return async (...args) => { await gate; const result = await target[key](...args); completed(); return result; };
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } });
  return { crypto: { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, release, done };
}

for (const action of ['cancel', 'route', 'hidden']) {
  test(`cancelling pending encryption (${action}) cannot save new data`, async t => {
    const delayed = delayedCrypto('encrypt');
    const h = setup(t, { allowCredentials: true, crypto: delayed.crypto });
    await h.menu('로그인 정보 설정');
    const pending = h.submitDialog(vaultInput);
    if (action === 'cancel') h.dialog.querySelector('button[type="button"]').click();
    if (action === 'route') h.navigate('/login?step=mfa');
    if (action === 'hidden') h.activity(false);
    delayed.release(); await delayed.done; await pending; await h.advance(0);
    assert.equal(h.values.has('vault'), false); assert.deepEqual(h.clicks, []);
  });
}

test('cancelling decryption cannot start a login after the dialog has closed', async t => {
  const stored = await configureVault(t); const delayed = delayedCrypto('decrypt');
  const h = setup(t, { allowCredentials: true, crypto: delayed.crypto, values: stored.values });
  await h.menu('잠금 해제 후 로그인'); const pending = h.submitDialog({ passphrase: vaultInput.passphrase });
  h.dialog.querySelector('button[type="button"]').click();
  delayed.release(); await delayed.done; await pending; await h.advance();
  assert.deepEqual(h.clicks, []); assert.equal(h.readField('email'), '');
});

test('changing vault ciphertext during unlock cannot activate stale credentials', async t => {
  const stored = await configureVault(t); const delayed = delayedCrypto('decrypt');
  const h = setup(t, { allowCredentials: true, crypto: delayed.crypto, values: stored.values });
  await h.menu('잠금 해제 후 로그인'); const pending = h.submitDialog({ passphrase: vaultInput.passphrase });
  h.values.delete('vault');
  delayed.release(); await delayed.done; await pending; await h.advance();
  assert.deepEqual(h.clicks, []); assert.equal(h.readField('email'), '');
});

test('a manual Login click keeps the filled password available to JumpCloud', async t => {
  const h = await configureVault(t); h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  let submitted;
  const button = h.document.querySelector('[data-automation="loginButton"]');
  button.addEventListener('click', () => { submitted = h.readField('password'); });
  button.click(); await h.advance();
  assert.equal(submitted, vaultInput.password); assert.deepEqual(h.clicks, ['password']);
});

test('Enter submission stops automation without clearing the submitted password', async t => {
  const h = await configureVault(t); h.passwordStep(); h.document.querySelector('input[readonly]').value = vaultInput.email;
  await h.menu('잠금 해제 후 로그인'); await h.submitDialog({ passphrase: vaultInput.passphrase });
  h.document.querySelector('input[name="password"]').dispatchEvent(new h.window.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  await h.advance();
  assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), vaultInput.password);
});
