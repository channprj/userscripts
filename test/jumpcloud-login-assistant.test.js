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
  t.after(() => { window.close(); assert.deepEqual(errors, []); assert.deepEqual(sensitiveAccesses, []); assert.deepEqual(storageAccesses, []); });
  let now = 1_800_000_000_000;
  let focused = options.focused ?? true;
  let visible = options.visible ?? true;
  let sequence = 0;
  const timers = new Map();
  const menus = new Map();
  const values = options.values ?? new Map([['enabled', options.enabled ?? true]]);
  const originStorage = options.originStorage ?? new Map();
  const storageAccesses = [];
  const clicks = [];
  const sensitiveAccesses = [];
  const dialogs = [];
  const attachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options); dialogs.push(root); return root;
  };
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
      storageAccesses.push(['get', key]);
      if (options.noLocalStorage) throw new Error('storage unavailable');
      assert.equal(key, attemptKey); // No access to JumpCloud's own stored account/session data.
      if (options.readFailure) throw new Error('storage unavailable');
      return originStorage.get(key) ?? null;
    },
    setItem(key, data) {
      storageAccesses.push(['set', key]);
      if (options.noLocalStorage) throw new Error('storage unavailable');
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
    assert.ok(['enabled', 'credentials'].includes(key));
    if (key === 'enabled') assert.equal(typeof data, 'boolean');
    else assert.deepEqual(Object.keys(data).sort(), ['email', 'password']);
    values.set(key, structuredClone(data));
  };
  window.GM_deleteValue = key => {
    assert.ok(['credentials', 'vault'].includes(key)); if (options.deleteFailure) throw new Error('storage unavailable'); values.delete(key);
  };
  window.GM_registerMenuCommand = (name, fn) => menus.set(name, fn);
  if (!options.noLocks) Object.defineProperty(window.navigator, 'locks', { get: () => blocked('navigator.locks') });
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
  'https://console.jumpcloud.com:444/login#/', 'https://console.jumpcloud.com/admin',
  'https://console.jumpcloud.com/other/login?step=password', 'https://console.jumpcloud.com/LOGIN',
]) {
  test(`does not run on an origin or path outside the match: ${url}`, async t => {
    const h = setup(t, { url }); h.fill('email', 'fixture@example.test'); await h.advance();
    assert.deepEqual(h.clicks, []); assert.equal(h.menus.size, 0);
  });
}

for (const suffix of ['', '/', '-other', '/continue?next=portal', '?error=denied#/', '?step=mfa#/',
  '?step=password&state=opaque&redirectTo=%2Fuserconsole#/', '?step=one&step=two&empty=&flag',
  '?redirectTo=https%3A%2F%2Fexample.test%2Fcallback&state=%E0%A4%A', '#/signin?state=opaque']) {
  test(`automatically runs for the full login match regardless of query or hash: ${suffix || '(bare)'}`, async t => {
    const h = savedLogin(t, { url: `https://console.jumpcloud.com/login${suffix}` });
    await h.advance(); assert.equal(h.readField('email'), loginInput.email);
    assert.deepEqual(h.clicks, ['email']);
  });
}

test('query changes between email and password stages do not stop automatic login', async t => {
  const h = savedLogin(t, { url: 'https://console.jumpcloud.com/login?state=opaque&redirectTo=%2Fuserconsole' });
  await h.advance(); assert.deepEqual(h.clicks, ['email']);
  h.passwordStep(); h.document.querySelector('input[readonly]').value = loginInput.email;
  h.navigate('/login?step=password&state=changed&foo=bar#/continue');
  await h.advance(); assert.deepEqual(h.clicks, ['email', 'password']);
});

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
  h.navigate('/logout'); await h.advance();
  h.navigate('/login#/'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

test('GM settings read failures still stop automatic login', async t => {
  const h = setup(t, { readFailure: true }); h.fill('email', 'fixture@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

test('login and retry work without Web Locks or available localStorage', async t => {
  const h = savedPassword(t, { noLocks: true, noLocalStorage: true });
  await h.advance(); assert.deepEqual(h.clicks, ['password']);
  await h.menu('다시 시도'); await h.advance(); assert.deepEqual(h.clicks, ['password', 'password']);
});

test('password submission does not block a fresh page or reload', async t => {
  const first = savedPassword(t); await first.advance(); assert.deepEqual(first.clicks, ['password']);
  const email = savedLogin(t, { values: first.values, originStorage: first.originStorage });
  await email.advance(); assert.deepEqual(email.clicks, ['email']);
  const reloaded = savedPassword(t, { values: first.values, originStorage: first.originStorage });
  await reloaded.advance(); assert.deepEqual(reloaded.clicks, ['password']);
});

test('independent tabs can each submit once without a shared cooldown', async t => {
  const originStorage = new Map();
  const first = savedPassword(t, { originStorage });
  const second = savedPassword(t, { originStorage, values: first.values });
  await Promise.all([first.advance(), second.advance()]);
  assert.deepEqual(first.clicks, ['password']); assert.deepEqual(second.clicks, ['password']);
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

test('MFA appearing during the stability window stops submission on any query', async t => {
  const h = savedLogin(t, { url: 'https://console.jumpcloud.com/login?step=mfa&state=opaque' });
  await h.advance(500);
  const otp = h.document.createElement('input'); otp.autocomplete = 'one-time-code';
  h.document.body.append(otp);
  await h.advance(); assert.deepEqual(h.clicks, []);
});

test('retry handles storage rejection without an unhandled promise', async t => {
  const options = {};
  const h = setup(t, options);
  options.readFailure = true;
  await h.menu('다시 시도'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

for (const record of ['broken json', 'null', '[]', '{"email":"yesterday"}', '{"unexpected":1}',
  '{"password":1800000000000}', '{"password":1800000100000}']) {
  test(`legacy submission records never block login: ${record}`, async t => {
    const originStorage = new Map([['chann.jumpcloud-login-assistant.attempts.v1', record]]);
    const h = savedPassword(t, { originStorage }); await h.advance();
    assert.deepEqual(h.clicks, ['password']);
    assert.equal(originStorage.get('chann.jumpcloud-login-assistant.attempts.v1'), record);
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

test('repeated events and query changes never resubmit a stage in the same execution', async t => {
  const h = savedLogin(t); await h.advance();
  for (let i = 0; i < 4; i++) {
    h.fill('email', loginInput.email);
    h.navigate(`/login?state=${i}#/signin`);
    await h.advance();
  }
  assert.deepEqual(h.clicks, ['email']);
  await h.menu('다시 시도'); await h.advance(); assert.deepEqual(h.clicks, ['email', 'email']);
});

const loginInput = { email: 'stored-fixture@example.test', password: 'fixture-login-password' };
const legacyVault = { v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000,
  salt: 'fixture-salt', iv: 'fixture-iv', ciphertext: 'fixture-ciphertext' };

async function configureLogin(t, options = {}) {
  const h = setup(t, { enabled: false, ...options, allowCredentials: true });
  await h.menu('로그인 정보 설정');
  await h.submitDialog(loginInput);
  assert.deepEqual(h.values.get('credentials'), loginInput);
  return h;
}

function savedLogin(t, options = {}) {
  return setup(t, { allowCredentials: true,
    values: new Map([['enabled', true], ['credentials', loginInput]]), ...options });
}

function savedPassword(t, options = {}) {
  return savedLogin(t, { html: passwordForm.replace('readonly', `readonly value="${loginInput.email}"`), ...options });
}

test('settings need only ID and password and save them only in GM storage', async t => {
  const h = await configureLogin(t);
  assert.deepEqual([...h.dialog.querySelectorAll('input')].map(input => input.name), ['email', 'password']);
  assert.equal([...h.menus.keys()].some(name => name.includes('잠금')), false);
  assert.equal(h.values.get('enabled'), true);
  assert.equal(h.dialog.host.isConnected, false);
  assert.deepEqual([...h.dialog.querySelectorAll('input')].map(input => input.value), ['', '']);
  await h.advance();
  for (const value of Object.values(loginInput)) assert.ok(!JSON.stringify([...h.originStorage]).includes(value));
});

test('saved credentials automatically fill and submit both steps without an unlock prompt', async t => {
  const h = await configureLogin(t);
  await h.advance();
  assert.equal(h.readField('email'), loginInput.email); assert.deepEqual(h.clicks, ['email']);
  h.passwordStep(); h.document.querySelector('input[readonly]').value = loginInput.email;
  await h.advance();
  assert.equal(h.readField('password'), loginInput.password); assert.deepEqual(h.clicks, ['email', 'password']);
  assert.deepEqual(h.values.get('credentials'), loginInput);
  await h.advance(600_000); assert.deepEqual(h.clicks, ['email', 'password']);
});

test('a fresh page logs in from GM credentials without opening settings or unlocking', async t => {
  const h = savedLogin(t); await h.advance();
  assert.equal(h.readField('email'), loginInput.email); assert.deepEqual(h.clicks, ['email']);
  assert.equal(h.dialogs.length, 0);
});

test('disabled saved credentials do not fill or submit until enabled', async t => {
  const h = savedLogin(t, { values: new Map([['enabled', false], ['credentials', loginInput]]) });
  await h.advance(); assert.equal(h.readField('email'), ''); assert.deepEqual(h.clicks, []);
  await h.menu('자동 진행 켜기/끄기'); await h.advance(); assert.deepEqual(h.clicks, ['email']);
});

test('saved credentials refuse a password for a different or missing account', async t => {
  for (const email of ['other@example.test', '']) {
    const h = savedLogin(t, { html: passwordForm.replace('readonly', `readonly value="${email}"`) });
    await h.advance(); assert.equal(h.readField('password'), ''); assert.deepEqual(h.clicks, []);
  }
});

test('saved credentials never overwrite a different prefilled email or password', async t => {
  const h = savedLogin(t, { html: emailForm.replace('required', 'required value="other@example.test"') });
  await h.advance(); assert.equal(h.readField('email'), 'other@example.test'); assert.deepEqual(h.clicks, []);
  const p = savedPassword(t, { html: passwordForm.replace('readonly', `readonly value="${loginInput.email}"`)
    .replace('name="password"', 'name="password" value="manual-fixture-password"') });
  await p.advance(); assert.equal(p.readField('password'), 'manual-fixture-password'); assert.deepEqual(p.clicks, []);
});

test('stop clears an unsubmitted password and retry starts without a passphrase', async t => {
  const h = savedPassword(t);
  assert.equal(h.readField('password'), loginInput.password);
  await h.menu('현재 페이지 중지'); assert.equal(h.readField('password'), '');
  await h.advance(); assert.deepEqual(h.clicks, []);
  await h.menu('다시 시도'); await h.advance(); assert.deepEqual(h.clicks, ['password']);
  assert.equal(h.dialogs.length, 0);
});

for (const credentials of [{ email: 'invalid', password: 'fixture' }, { ...loginInput, password: '' },
  { ...loginInput, password: 'x'.repeat(1025) }, { ...loginInput, extra: true }, []]) {
  test(`invalid saved credentials stop instead of using browser autofill: ${JSON.stringify(credentials).slice(0, 90)}`, async t => {
    const h = savedLogin(t, { values: new Map([['enabled', true], ['credentials', credentials]]) });
    h.fill('email', 'autofill@example.test'); await h.advance(); assert.deepEqual(h.clicks, []);
  });
}

test('settings reject invalid email and empty passwords without changing stored data', async t => {
  const h = savedLogin(t);
  for (const input of [{ ...loginInput, email: 'invalid' }, { ...loginInput, password: '' }]) {
    await h.menu('로그인 정보 설정'); await h.submitDialog(input);
    assert.deepEqual(h.values.get('credentials'), loginInput); assert.deepEqual(h.clicks, []);
  }
});

test('settings replace saved credentials while failed writes preserve the previous account', async t => {
  const h = await configureLogin(t);
  const replacement = { email: 'replacement@example.test', password: 'replacement-fixture-password' };
  await h.menu('로그인 정보 설정'); await h.submitDialog(replacement);
  assert.deepEqual(h.values.get('credentials'), replacement);
  h.options.writeFailure = true;
  await h.menu('로그인 정보 설정'); await h.submitDialog(loginInput);
  assert.deepEqual(h.values.get('credentials'), replacement); assert.deepEqual(h.clicks, []);
});

test('deleting saved data removes current and legacy records and disables login', async t => {
  const h = savedLogin(t); h.values.set('vault', legacyVault);
  await h.menu('저장 정보 삭제');
  assert.equal(h.values.has('credentials'), false); assert.equal(h.values.has('vault'), false);
  assert.equal(h.values.get('enabled'), false); await h.advance(); assert.deepEqual(h.clicks, []);
});

test('cancelled deletion preserves data and failed deletion leaves automation disabled', async t => {
  const h = savedLogin(t); h.options.confirmDelete = false;
  await h.menu('저장 정보 삭제'); assert.deepEqual(h.values.get('credentials'), loginInput);
  h.options.confirmDelete = true; h.options.deleteFailure = true;
  await h.menu('저장 정보 삭제'); assert.deepEqual(h.values.get('credentials'), loginInput);
  assert.equal(h.values.get('enabled'), false); await h.advance(); assert.deepEqual(h.clicks, []);
});

test('old encrypted storage is retained and requires re-registration, with no autofill fallback', async t => {
  const h = setup(t, { allowCredentials: true, values: new Map([['enabled', true], ['vault', legacyVault]]) });
  h.fill('email', 'autofill@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []); assert.deepEqual(h.values.get('vault'), legacyVault);
  assert.equal(h.dialogs.length, 0);
  await h.menu('로그인 정보 설정'); await h.submitDialog(loginInput);
  assert.deepEqual(h.values.get('credentials'), loginInput); assert.equal(h.values.has('vault'), false);
});

test('failed migration preserves the old encrypted record and cannot enable partial settings', async t => {
  const h = setup(t, { allowCredentials: true, values: new Map([['enabled', true], ['vault', legacyVault]]) });
  h.options.writeFailure = true;
  await h.menu('로그인 정보 설정'); await h.submitDialog(loginInput);
  assert.deepEqual(h.values.get('vault'), legacyVault); assert.equal(h.values.has('credentials'), false);
  h.options.writeFailure = false; h.options.deleteFailure = true;
  await h.submitDialog(loginInput);
  assert.deepEqual(h.values.get('vault'), legacyVault); assert.equal(h.values.get('enabled'), false);
  await h.menu('자동 진행 켜기/끄기'); h.fill('email', 'autofill@example.test'); await h.advance();
  assert.deepEqual(h.clicks, []);
});

for (const action of ['cancel', 'route', 'hidden']) {
  test(`closed settings cannot save or start login: ${action}`, async t => {
    const h = setup(t, { allowCredentials: true, enabled: false }); await h.menu('로그인 정보 설정');
    if (action === 'cancel') h.dialog.querySelector('button[type="button"]').click();
    if (action === 'route') h.navigate('/logout');
    if (action === 'hidden') h.activity(false);
    await h.submitDialog(loginInput); await h.advance();
    assert.equal(h.values.has('credentials'), false); assert.deepEqual(h.clicks, []);
  });
}

test('hiding the page stops login and clears its unsubmitted password without deleting GM data', async t => {
  const h = savedPassword(t); assert.equal(h.readField('password'), loginInput.password);
  h.activity(false); assert.equal(h.readField('password'), '');
  h.activity(true); await h.advance(); assert.deepEqual(h.clicks, []);
  assert.deepEqual(h.values.get('credentials'), loginInput);
  await h.menu('다시 시도'); await h.advance(); assert.deepEqual(h.clicks, ['password']);
});

test('saved credentials can fill a password while the login button is initially disabled', async t => {
  const h = savedPassword(t, { focused: false });
  const button = h.document.querySelector('[data-automation="loginButton"]'); button.disabled = true;
  h.document.querySelector('input[name="password"]').addEventListener('input', () => { button.disabled = false; });
  h.activity(true); await h.advance(); assert.deepEqual(h.clicks, ['password']);
});

test('account changes during stability prevent submission and clear the injected password', async t => {
  const h = savedPassword(t); await h.advance(500);
  h.document.querySelector('input[readonly]').value = 'other@example.test';
  await h.advance(); assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), '');
});

test('stopping preserves a password that the user replaced manually', async t => {
  const h = savedPassword(t); h.fill('password', 'manual-fixture-password');
  await h.advance(); assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), 'manual-fixture-password');
});

test('a manual Login click keeps the filled password available to JumpCloud', async t => {
  const h = savedPassword(t); let submitted;
  const button = h.document.querySelector('[data-automation="loginButton"]');
  button.addEventListener('click', () => { submitted = h.readField('password'); });
  button.click(); await h.advance();
  assert.equal(submitted, loginInput.password); assert.deepEqual(h.clicks, ['password']);
});

test('Enter submission stops automation without clearing the submitted password', async t => {
  const h = savedPassword(t);
  h.document.querySelector('input[name="password"]').dispatchEvent(new h.window.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  await h.advance(); assert.deepEqual(h.clicks, []); assert.equal(h.readField('password'), loginInput.password);
});
