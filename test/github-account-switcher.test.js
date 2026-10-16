const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const scriptPath = path.join(__dirname, '..', 'github-account-switcher.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const config = {
  personal: 'sample-personal',
  rules: [{ owner: 'sample-team', account: 'sample-work' }],
  enabled: true,
};
const enterpriseConfig = {
  ...config,
  rules: [...config.rules, { owner: 'enterprises/*', account: 'sample-work' }],
};

// Sanitized fixture based on GitHub's React user navigation / account menu.
// Only the GitHub session and userscript-manager boundaries are simulated.
function setup(t, options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(`<!doctype html><meta name="user-login" content="${options.current ?? 'sample-personal'}">
    <header><button aria-labelledby="user-menu-label" data-login="sample-personal">Profile</button><span id="user-menu-label" hidden>Open user navigation menu</span></header><main>${options.draft ? '<textarea>draft</textarea>' : ''}</main>`, {
    url: `https://github.com${options.route ?? '/sample-team/repo/pull/42?tab=files#diff-1'}`,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  t.after(() => {
    dom.window.close();
    if (!options.expectReload) assert.deepEqual(errors, []);
  });
  const { window } = dom;
  const { document } = window;
  const values = options.values ?? new Map([['settings', structuredClone(config)]]);
  const menus = new Map();
  const clicks = [];
  const attemptsAtClick = [];
  const menuClicks = { profile: 0, switcher: 0 };
  const intervals = [];
  const writes = [];
  let fetchCalls = 0;
  let focused = options.focused ?? true;
  let visible = options.visible ?? true;
  Object.defineProperty(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
  document.hasFocus = () => focused;
  window.GM_getValue = (key, fallback) => structuredClone(values.has(key) ? values.get(key) : fallback);
  window.GM_setValue = (key, value) => { values.set(key, structuredClone(value)); writes.push(key); };
  window.GM_deleteValue = key => values.delete(key);
  window.GM_registerMenuCommand = (label, action) => menus.set(label, action);
  window.setInterval = fn => { intervals.push(fn); return intervals.length; };
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms) => timeout(fn, Math.min(ms, 20));
  window.fetch = options.fetch ?? (async () => ({
    ok: true, url: 'https://github.com/',
    text: async () => `<meta name="user-login" content="${options.session ?? options.current ?? 'sample-personal'}">`,
  }));
  const fetchImpl = window.fetch;
  window.fetch = (...args) => { fetchCalls++; return fetchImpl(...args); };
  const userButton = document.querySelector('header button');
  userButton.addEventListener('click', () => {
    menuClicks.profile++;
    const existing = document.querySelector('[data-fixture-navigation]');
    if (existing) {
      existing.remove();
      document.getElementById('user-menu-label').textContent = 'Open user navigation menu';
      return;
    }
    document.getElementById('user-menu-label').textContent = 'Close user navigation menu';
    const nav = document.createElement('div');
    nav.dataset.fixtureNavigation = '';
    nav.setAttribute('role', 'dialog');
    nav.innerHTML = '<button id="switcher" aria-labelledby="switcher-label" aria-expanded="false">Switch</button><span id="switcher-label" hidden>Account switcher</span>';
    document.body.append(nav);
    nav.querySelector('button').addEventListener('click', () => {
      menuClicks.switcher++;
      if (nav.querySelector('[role="menu"]')) return;
      nav.querySelector('button').setAttribute('aria-expanded', 'true');
      const menu = document.createElement('ul');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-labelledby', 'switcher-label');
      for (const [index, account] of (options.accounts ?? ['sample-personal', 'sample-work', 'sample-work-extra']).entries()) {
        const item = document.createElement('li');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('aria-labelledby', `account-label-${index}`);
        if (options.expired === account) item.setAttribute('aria-disabled', 'true');
        item.innerHTML = `<span id="account-label-${index}" data-component="ActionList.Item.Label">${account}</span><span>Display Name</span>`;
        item.addEventListener('click', () => {
          attemptsAtClick.push(values.get('attempt') ?? null);
          clicks.push({ account, url: window.location.href });
        });
        menu.append(item);
      }
      menu.insertAdjacentHTML('beforeend', '<li><a role="menuitem" href="/login?add_account=1">Add account</a></li>');
      nav.append(menu);
    });
  });
  if (options.preopenProfile || options.preopenAccounts) userButton.click();
  if (options.preopenAccounts) document.querySelector('#switcher').click();
  if (options.navigationApi) {
    const navigation = new window.EventTarget();
    navigation.currentEntry = { get url() { return window.location.href; } };
    Object.defineProperty(window, 'navigation', { configurable:true, value:navigation });
    const pushState = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => {
      pushState(...args);
      navigation.dispatchEvent(new window.Event('currententrychange'));
    };
  }
  window.eval(source);
  if (options.draft) document.querySelector('textarea').dispatchEvent(new window.Event('input', {bubbles:true}));
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return {
    window, document, values, menus, clicks, attemptsAtClick, menuClicks, writes, errors, flush, get fetchCalls() { return fetchCalls; },
    async tick() { for (const fn of intervals) fn(); await flush(); },
    async settle() { await new Promise(resolve => setTimeout(resolve, 35)); await flush(); },
    async navigate(route) { window.history.pushState({}, '', route); await this.tick(); },
    async navigateWithoutTick(route) { window.history.pushState({}, '', route); await flush(); },
    async activate() {
      visible = true; focused = true;
      document.dispatchEvent(new window.Event('visibilitychange'));
      window.dispatchEvent(new window.Event('focus'));
      await this.tick();
    },
    async deactivate() {
      visible = false; focused = false;
      document.dispatchEvent(new window.Event('visibilitychange'));
      await this.tick();
    },
    async blurRefocus() {
      focused = false;
      window.dispatchEvent(new window.Event('blur'));
      focused = true;
      window.dispatchEvent(new window.Event('focus'));
      await this.tick();
    },
  };
}

test('switches the exact configured account and retains the full destination', async t => {
  const h = setup(t);
  await h.flush();
  assert.deepEqual(h.clicks, [{account:'sample-work', url:'https://github.com/sample-team/repo/pull/42?tab=files#diff-1'}]);
  assert.deepEqual(h.menuClicks, {profile:1, switcher:1});
  assert.deepEqual(h.attemptsAtClick, [{target:'sample-work', at:h.values.get('attempt').at}]);
});

test('uses only the remaining menu clicks when the profile menu is already open', async t => {
  const h = setup(t, {preopenProfile:true}); await h.flush();
  assert.deepEqual(h.menuClicks, {profile:1, switcher:1});
  assert.equal(h.clicks.length, 1);
  assert.ok(h.document.querySelector('[data-fixture-navigation]'));
});

test('uses one menu click when the account list is already expanded', async t => {
  const h = setup(t, {preopenAccounts:true}); await h.flush();
  assert.deepEqual(h.menuClicks, {profile:1, switcher:1});
  assert.equal(h.clicks.length, 1);
  assert.ok(h.document.querySelector('[data-fixture-navigation]'));
});

for (const route of ['/sample-team', '/SAMPLE-TEAM/repo', '/orgs/sample-team/projects/1', '/users/sample-team/projects/1']) {
  test(`matches owner routes: ${route}`, async t => {
    const h = setup(t, {route}); await h.flush();
    assert.equal(h.clicks[0]?.account, 'sample-work');
  });
}
for (const route of ['/', '/sample-team-extra/repo', '/another-owner/repo', '/another-owner/repo?q=sample-team', '/enterprises/sample-team/settings', '/%E0%A4%A/repo']) {
  test(`returns to the personal account: ${route}`, async t => {
    const h = setup(t, {route, current:'sample-work'}); await h.flush();
    assert.equal(h.clicks[0]?.account, 'sample-personal');
  });
}

for (const route of [
  '/settings', '/settings/profile', '/settings/security', '/SETTINGS/profile',
  '/notifications', '/dashboard', '/codespaces', '/pulls', '/issues', '/stars',
  '/search?q=sample-team', '/explore', '/marketplace', '/new', '/organizations/new',
]) {
  test(`keeps the current account on settings and system pages: ${route}`, async t => {
    const h = setup(t, {route, current:'sample-work'}); await h.flush();
    assert.equal(h.clicks.length, 0);
    assert.equal(h.document.querySelector('[data-fixture-navigation]'), null);
    assert.equal(h.document.querySelector('[data-gas-notice]'), null);
  });
}

for (const route of ['/sample-team/settings', '/sample-team/repo/settings/actions', '/orgs/sample-team/settings/profile']) {
  test(`organization and repository settings still switch: ${route}`, async t => {
    const h = setup(t, {route}); await h.flush();
    assert.equal(h.clicks[0]?.account, 'sample-work');
  });
}

test('leaving a settings page resumes switching', async t => {
  const h = setup(t, {route:'/settings/profile'}); await h.flush();
  assert.equal(h.clicks.length, 0);
  await h.navigate('/sample-team/repo');
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('a system page holds the account chosen for the previous owner page', async t => {
  const h = setup(t, {current:'sample-work'}); await h.flush();
  assert.equal(h.clicks.length, 0);
  await h.navigate('/notifications');
  assert.equal(h.clicks.length, 0);
});

for (const route of ['/enterprises/', '/enterprises/sample-company', '/enterprises/another-company/settings/billing?tab=usage#details', '/ENTERPRISES/sample-company/people']) {
  test(`matches the enterprise prefix and retains the destination: ${route}`, async t => {
    const h = setup(t, {route, values:new Map([['settings', enterpriseConfig]])}); await h.flush();
    assert.deepEqual(h.clicks, [{account:'sample-work', url:`https://github.com${route}`}]);
  });
}

for (const route of ['/enterprises', '/enterprises-extra/sample-company', '/another-owner/enterprises/repo', '/another-owner/repo?q=/enterprises/sample-company', '/orgs/enterprises/projects/1', '/enterprises%2F*/repo', '/orgs/enterprises%2F*/projects/1']) {
  test(`the enterprise rule does not match outside its prefix: ${route}`, async t => {
    const h = setup(t, {route, current:'sample-work', values:new Map([['settings', enterpriseConfig]])}); await h.flush();
    assert.equal(h.clicks[0]?.account, 'sample-personal');
  });
}

test('the enterprise prefix rule takes priority over a legacy enterprises owner rule', async t => {
  const h = setup(t, {route:'/enterprises/sample-company', values:new Map([['settings', {
    ...config, rules:[{owner:'enterprises', account:'sample-work-extra'}, ...enterpriseConfig.rules],
  }]])}); await h.flush();
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('adding an enterprise rule preserves existing organization rules', async t => {
  const h = setup(t, {values:new Map([['settings', enterpriseConfig]])}); await h.flush();
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('client-side navigation into enterprise pages selects the configured account', async t => {
  const h = setup(t, {route:'/', values:new Map([['settings', enterpriseConfig]])}); await h.flush();
  await h.navigate('/enterprises/sample-company/settings');
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('leaving enterprise pages returns to the personal account', async t => {
  const h = setup(t, {route:'/enterprises/sample-company', current:'sample-work', values:new Map([['settings', enterpriseConfig]])}); await h.flush();
  assert.equal(h.clicks.length, 0);
  await h.navigate('/');
  assert.equal(h.clicks[0]?.account, 'sample-personal');
});

for (const route of ['/enterprises/sample-company/sso', '/enterprises/sample-company/saml/consume', '/enterprises/sample-company/oidc?return_to=settings']) {
  test(`an enterprise rule does not interrupt authentication: ${route}`, async t => {
    const h = setup(t, {route, values:new Map([['settings', enterpriseConfig]])}); await h.flush();
    assert.equal(h.clicks.length, 0);
    assert.equal(h.document.querySelector('[data-fixture-navigation]'), null);
    assert.equal(h.document.querySelector('[data-gas-notice]'), null);
  });
}

test('does nothing when already using the target account', async t => {
  const h = setup(t, {current:'sample-work'}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.equal(h.document.querySelector('[data-fixture-navigation]'), null);
});

test('reacts to client-side navigation without requiring a full page load', async t => {
  const h = setup(t, {route:'/'}); await h.flush();
  await h.navigate('/sample-team/repo');
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('Navigation API route changes trigger a check without waiting for the interval', async t => {
  const h = setup(t, {route:'/', navigationApi:true}); await h.flush();
  await h.navigateWithoutTick('/sample-team/repo');
  assert.equal(h.clicks[0]?.account, 'sample-work');
  assert.equal(h.fetchCalls, 2);
  h.window.navigation.dispatchEvent(new h.window.Event('currententrychange'));
  await h.flush();
  assert.equal(h.fetchCalls, 2);
});

test('a route event cancels old verification and polling checks the new route', async t => {
  let resolveOld;
  let calls = 0;
  const h = setup(t, {
    route:'/sample-team/repo', navigationApi:true,
    values:new Map([['settings', {...config, rules:[...config.rules, {owner:'another-team', account:'sample-work-extra'}]}]]),
    fetch:() => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({
      ok:true, url:'https://github.com/', text:async()=>'<meta name="user-login" content="sample-personal">',
    }),
  });
  await h.flush();
  await h.navigateWithoutTick('/another-team/repo');
  resolveOld({ok:true, url:'https://github.com/', text:async()=>'<meta name="user-login" content="sample-personal">'});
  await h.flush();
  assert.equal(h.clicks.length, 0);
  await h.tick();
  assert.deepEqual(h.clicks.map(click => click.account), ['sample-work-extra']);
  assert.equal(h.fetchCalls, 2);
});

test('keeps background tabs idle and switches on activation', async t => {
  const h = setup(t, {visible:false, focused:false}); await h.flush();
  assert.equal(h.clicks.length, 0);
  await h.activate();
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

for (const route of ['/login', '/session', '/sessions/verified-device', '/logout', '/switch_account', '/account/choose', '/settings/two_factor_authentication', '/orgs/sample-team/sso', '/enterprises/sample-company/sso', '/login/oauth/authorize']) {
  test(`does not interrupt authentication: ${route}`, async t => {
    const h = setup(t, {route, current:'sample-work'}); await h.flush();
    assert.equal(h.clicks.length, 0);
    assert.equal(h.document.querySelector('[data-fixture-navigation]'), null);
  });
}

test('an unavailable account stops without selecting another account', async t => {
  const h = setup(t, {accounts:['sample-work-extra']}); await h.settle();
  assert.equal(h.clicks.length, 0);
  assert.equal(h.document.querySelector('[data-fixture-navigation]'), null);
  assert.deepEqual(h.menuClicks, {profile:2, switcher:1});
  assert.match(h.document.body.textContent, /계정|account/i);
  await h.tick();
  assert.equal(h.clicks.length, 0);
});

test('an expired account is left for the user to reauthenticate', async t => {
  const h = setup(t, {expired:'sample-work'}); await h.flush();
  assert.equal(h.clicks.length, 0);
});

test('a failed switch cannot loop across page reloads', async t => {
  const first = setup(t); await first.flush();
  assert.equal(first.clicks.length, 1);
  const second = setup(t, {values:first.values}); await second.flush();
  assert.equal(second.clicks.length, 0);
});

test('failed session verification never starts a switch', async t => {
  const h = setup(t, {fetch:async () => {throw new Error('offline');}}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.deepEqual(h.menuClicks, {profile:0, switcher:0});
});

test('an expired target closes only a menu opened by the script', async t => {
  const h = setup(t, {expired:'sample-work', preopenProfile:true}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.ok(h.document.querySelector('[data-fixture-navigation]'));
  assert.deepEqual(h.menuClicks, {profile:1, switcher:1});
});

test('navigation during session verification cancels a stale switch', async t => {
  let resolve;
  const h = setup(t, {fetch:() => new Promise(r => {resolve = r;})});
  await h.flush();
  h.window.history.pushState({}, '', '/another-owner');
  resolve({ok:true, url:'https://github.com/', text:async()=>'<meta name="user-login" content="sample-personal">'});
  await h.flush();
  assert.equal(h.clicks.length, 0);
});

test('fresh installation stays inactive and provides a local settings form', async t => {
  const h = setup(t, {values:new Map()}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.equal(h.writes.length, 0);
  assert.ok(h.menus.has('GitHub Account Switcher: 설정'));
  h.menus.get('GitHub Account Switcher: 설정')();
  assert.equal(h.document.querySelector('[name="personal"]').value, '');
  assert.equal(h.document.querySelector('[name="rules"]').value, '');
});

test('settings save entered mappings only in userscript-manager storage', async t => {
  const h = setup(t, {values:new Map(), route:'/'}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[name="personal"]').value = ' sample-personal ';
  h.document.querySelector('[name="rules"]').value = 'sample-team = sample-work\nanother-team=another-work';
  h.document.querySelector('[data-gas-settings] form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  await h.flush();
  assert.deepEqual(h.values.get('settings'), {personal:'sample-personal', enabled:true, rules:[
    {owner:'sample-team', account:'sample-work'}, {owner:'another-team', account:'another-work'},
  ]});
  assert.equal(h.window.localStorage.length, 0);
  assert.equal(h.document.cookie, '');
});

test('settings save, reopen, and clear an optional automatic switch exception', async t => {
  const h = setup(t, {values:new Map()}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  const input = h.document.querySelector('[name="autoSwitchAccount"]');
  assert.ok(input);
  input.value = ' sample-work ';
  h.document.querySelector('[name="personal"]').value = 'sample-personal';
  h.document.querySelector('form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  await h.flush();
  assert.equal(h.values.get('settings').autoSwitchAccount, 'sample-work');
  h.menus.get('GitHub Account Switcher: 설정')();
  assert.equal(h.document.querySelector('[name="autoSwitchAccount"]').value, 'sample-work');
  h.document.querySelector('[name="autoSwitchAccount"]').value = '   ';
  h.document.querySelector('form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  await h.flush();
  assert.equal(Object.hasOwn(h.values.get('settings'), 'autoSwitchAccount'), false);
});

test('invalid exception usernames are rejected in the form and stored settings', async t => {
  const h = setup(t, {values:new Map([['settings', config]])}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[name="autoSwitchAccount"]').value = 'bad/name';
  h.document.querySelector('form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  assert.match(h.document.querySelector('[data-gas-error]').textContent, /username/);
  assert.equal(h.values.get('settings').autoSwitchAccount, undefined);
  const malformed = setup(t, {values:new Map([['settings',{...config,autoSwitchAccount:4}]])});
  await malformed.flush();
  assert.equal(malformed.document.querySelector('[data-gas-switch]'), null);
  assert.equal(malformed.fetchCalls, 0);
  assert.match(malformed.document.querySelector('[data-gas-notice]').textContent, /설정/);
});

test('enterprise rules can be saved, applied immediately and reopened with existing mappings', async t => {
  const h = setup(t, {route:'/enterprises/sample-company'}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[name="rules"]').value += '\n ENTERPRISES/* = sample-work ';
  h.document.querySelector('[data-gas-settings] form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  await h.flush();
  assert.deepEqual(h.values.get('settings'), {...config, rules:[
    ...config.rules, {owner:'ENTERPRISES/*', account:'sample-work'},
  ]});
  assert.equal(h.clicks[0]?.account, 'sample-work');
  h.menus.get('GitHub Account Switcher: 설정')();
  assert.equal(h.document.querySelector('[name="rules"]').value, 'sample-team = sample-work\nENTERPRISES/* = sample-work');
});

test('invalid or duplicate mappings are not saved', async t => {
  const h = setup(t, {values:new Map()}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[name="personal"]').value = 'sample-personal';
  for (const rules of [
    'https://github.com/sample-team=sample-work', 'sample-team=sample-work\nSAMPLE-TEAM=other', 'sample-team=',
    'enterprises/*=sample-work\nENTERPRISES/*=other', 'enterprises/*=invalid/name',
    'sample-team=enterprises/*', 'enterprises*=sample-work', 'orgs/*=sample-work',
    'enterprises/sample-company=sample-work', 'https://github.com/enterprises/*=sample-work',
  ]) {
    h.document.querySelector('[name="rules"]').value = rules;
    h.document.querySelector('form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
    assert.equal(h.values.has('settings'), false);
  }
});

for (const html of ['<textarea>draft</textarea>', '<select><option value="a">A</option><option value="b">B</option></select>', '<div contenteditable="true"><b>draft</b></div>']) {
  test(`retained edits prevent switching across URL changes: ${html.split('>')[0]}`, async t => {
    const h = setup(t, {route:'/'}); await h.flush();
    h.document.querySelector('main').innerHTML = html;
    const control = h.document.querySelector('main').firstElementChild;
    control.dispatchEvent(new h.window.Event('input', {bubbles:true}));
    control.dispatchEvent(new h.window.Event('change', {bubbles:true}));
    await h.navigate('/sample-team/repo#diff-2');
    assert.equal(h.clicks.length, 0);
    control.remove();
    await h.tick();
    assert.equal(h.clicks[0]?.account, 'sample-work');
  });
}

test('stale account markup reloads before any account click', async t => {
  const h = setup(t, {current:'sample-personal', session:'sample-other', expectReload:true}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.deepEqual(h.menuClicks, {profile:0, switcher:0});
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /navigation/i);
  const next = setup(t, {current:'sample-personal', session:'sample-other', values:h.values}); await next.flush();
  assert.equal(next.clicks.length, 0);
  assert.match(next.document.querySelector('[data-gas-notice]').textContent, /새로고침/);
});

test('signed-out sessions do not switch accounts', async t => {
  const h = setup(t, {session:''}); await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.match(h.document.querySelector('[data-gas-notice]').textContent, /로그인/);
});

test('disabled configuration stays inactive until explicitly enabled', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])}); await h.flush();
  assert.equal(h.clicks.length, 0);
  h.menus.get('GitHub Account Switcher: 자동 전환 켜기/끄기')(); await h.flush();
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

for (const exception of ['sample-work', ' SAMPLE-WORK ']) {
  test(`disabled automation switches when the exact exception matches after normalization: ${exception}`, async t => {
    const h = setup(t, {values:new Map([['settings',{...config,enabled:false,autoSwitchAccount:exception}]])});
    await h.flush();
    assert.deepEqual(h.clicks, [{account:'sample-work', url:'https://github.com/sample-team/repo/pull/42?tab=files#diff-1'}]);
    assert.equal(h.document.querySelector('[data-gas-switch]'), null);
    assert.equal(h.values.get('settings').enabled, false);
  });
}

for (const exception of ['sample-work-extra', 'other-work', undefined, '']) {
  test(`disabled automation stays manual when exception does not exactly match: ${exception ?? 'absent'}`, async t => {
    const stored = {...config,enabled:false};
    if (exception !== undefined) stored.autoSwitchAccount = exception;
    const h = setup(t, {values:new Map([['settings',stored]])}); await h.flush();
    assert.equal(h.clicks.length, 0);
    assert.ok(h.document.querySelector('[data-gas-switch]'));
    assert.equal(h.fetchCalls, 0);
  });
}

test('global automation remains enabled for any target regardless of exception', async t => {
  const h = setup(t, {route:'/another-owner/repo', current:'sample-work', values:new Map([['settings',{...config,autoSwitchAccount:'sample-work'}]])});
  await h.flush();
  assert.deepEqual(h.clicks, [{account:'sample-personal', url:'https://github.com/another-owner/repo'}]);
});

test('exception applies to personal fallback and enterprise rule targets', async t => {
  const personal = setup(t, {route:'/', current:'sample-work', values:new Map([['settings',{...config,enabled:false,autoSwitchAccount:' SAMPLE-PERSONAL '}]])});
  await personal.flush();
  assert.equal(personal.clicks[0]?.account, 'sample-personal');
  const enterprise = setup(t, {route:'/enterprises/sample-company', current:'sample-personal', values:new Map([['settings',{...enterpriseConfig,enabled:false,autoSwitchAccount:'sample-work'}]])});
  await enterprise.flush();
  assert.equal(enterprise.clicks[0]?.account, 'sample-work');
});

test('matching exception keeps authentication, system, draft, background, and cooldown guards', async t => {
  for (const options of [
    {route:'/orgs/sample-team/sso',exception:'sample-work'},
    {route:'/settings/profile',exception:'sample-personal'},
    {focused:false,visible:false,exception:'sample-work'},
    {draft:true,exception:'sample-work'}, {attempt:true,exception:'sample-work'},
  ]) {
    const values = new Map([['settings',{...config,enabled:false,autoSwitchAccount:options.exception}]]);
    if (options.attempt) { delete options.attempt; values.set('attempt',{target:'sample-work',at:Date.now()}); }
    const h = setup(t, {values,...options}); await h.flush();
    if (options.draft) { h.document.querySelector('textarea').dispatchEvent(new h.window.Event('input', {bubbles:true})); await h.tick(); }
    assert.equal(h.clicks.length, 0);
    if (options.route || options.focused === false) assert.equal(h.fetchCalls, 0);
  }
});

test('changing the exception cancels deferred automatic session verification', async t => {
  let resolveFetch;
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false,autoSwitchAccount:'sample-work'}]]), fetch:() => new Promise(resolve => { resolveFetch = resolve; })});
  await h.flush();
  assert.equal(h.fetchCalls, 1);
  h.values.set('settings', {...config,enabled:false,autoSwitchAccount:'other-work'});
  resolveFetch({ok:true,url:'https://github.com/',text:async()=>'<meta name="user-login" content="sample-personal">'});
  await h.flush();
  assert.equal(h.clicks.length, 0);
});

test('SPA navigation updates exception mode between manual and automatic switching', async t => {
  const h = setup(t, {route:'/another-owner/repo', current:'another-work', values:new Map([['settings',{...config,enabled:false,autoSwitchAccount:'sample-work'}]])});
  await h.flush();
  assert.ok(h.document.querySelector('[data-gas-switch]'));
  assert.equal(h.fetchCalls, 0);
  await h.navigate('/sample-team/repo');
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
  assert.equal(h.clicks[0]?.account, 'sample-work');
});

test('disabling global automation preserves the exception and explains it remains active', async t => {
  const h = setup(t, {current:'sample-work',values:new Map([['settings',{...config,autoSwitchAccount:'sample-work'}]])}); await h.flush();
  h.menus.get('GitHub Account Switcher: 자동 전환 켜기/끄기')();
  await h.flush();
  assert.equal(h.values.get('settings').enabled, false);
  assert.equal(h.values.get('settings').autoSwitchAccount, 'sample-work');
  assert.match(h.document.querySelector('[data-gas-notice]').textContent, /예외 계정.*계속 자동 전환/);
});

test('deleting settings removes stored mappings and stops switching', async t => {
  const h = setup(t, {route:'/'}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[data-gas-reset]').click();
  assert.equal(h.values.has('settings'), false);
  await h.navigate('/sample-team/repo');
  assert.equal(h.clicks.length, 0);
});


test('disabled automatic switching offers a manual button without background checks', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  const button = h.document.querySelector('[data-gas-switch]');
  assert.ok(button);
  assert.equal(button.textContent, '@sample-work 계정으로 전환');
  assert.equal(h.fetchCalls, 0);
  await h.tick();
  assert.equal(h.fetchCalls, 0);
  assert.equal(h.document.querySelectorAll('[data-gas-switch]').length, 1);
  button.click();
  await h.flush();
  assert.deepEqual(h.clicks, [{account:'sample-work', url:'https://github.com/sample-team/repo/pull/42?tab=files#diff-1'}]);
  assert.equal(h.values.get('settings').enabled, false);
});

test('manual button tracks navigation and disappears when target is already current', async t => {
  const h = setup(t, {route:'/', current:'sample-work', values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  assert.equal(h.document.querySelector('[data-gas-switch]')?.textContent, '@sample-personal 계정으로 전환');
  await h.navigate('/sample-team/repo');
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
});


test('a retained manual button cannot retarget after SPA navigation', async t => {
  const h = setup(t, {route:'/sample-team/repo', values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  const oldButton = h.document.querySelector('[data-gas-switch]');
  await h.navigate('/another-owner/repo');
  oldButton.click();
  await h.flush();
  assert.deepEqual(h.clicks, []);
  assert.equal(h.fetchCalls, 0);
});

test('a retained manual button cannot run after its exception setting changes', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false,autoSwitchAccount:'other-work'}]])});
  await h.flush();
  const button = h.document.querySelector('[data-gas-switch]');
  h.values.set('settings', {...config,enabled:false,autoSwitchAccount:'sample-work'});
  button.click();
  await h.flush();
  assert.equal(h.fetchCalls, 0);
  assert.equal(h.clicks.length, 0);
});

test('manual clicks are single flight', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  const button = h.document.querySelector('[data-gas-switch]');
  button.click(); button.click();
  await h.flush();
  assert.equal(h.fetchCalls, 1);
  assert.equal(h.clicks.length, 1);
});

for (const options of [
  {route:'/login'},
  {route:'/settings/profile'},
  {focused:false, visible:false},
  {current:''},
  {values:new Map()},
]) {
  test(`manual switch button stays hidden for ineligible page state: ${JSON.stringify(options)}`, async t => {
    const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]]), ...options});
    await h.flush();
    assert.equal(h.document.querySelector('[data-gas-switch]'), null);
  });
}

test('manual button hides while settings are open and returns after cancel', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
  h.document.querySelector('[data-gas-cancel]').click();
  await h.flush();
  assert.equal(h.document.querySelector('[data-gas-switch]')?.textContent, '@sample-work 계정으로 전환');
});

test('manual button hides after an edited page control is marked', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  const control = h.document.createElement('textarea');
  h.document.querySelector('main').append(control);
  control.dispatchEvent(new h.window.Event('input', {bubbles:true}));
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
});

test('manual button is restored enabled after an offline failure and can be retried explicitly', async t => {
  let calls = 0;
  const h = setup(t, {
    values:new Map([['settings',{...config,enabled:false}]]),
    fetch:async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return {ok:true,url:'https://github.com/',text:async()=>'<meta name="user-login" content="sample-personal">'};
    },
  });
  await h.flush();
  const button = h.document.querySelector('[data-gas-switch]');
  button.click();
  await h.flush();
  assert.equal(button.disabled, false);
  assert.equal(h.document.querySelector('[data-gas-switch]'), button);
  button.click();
  await h.flush();
  assert.equal(calls, 2);
  assert.equal(h.clicks.length, 1);
  assert.equal(h.values.get('settings').enabled, false);
});

for (const mutation of ['route', 'settings', 'edit', 'activation']) {
  test(`manual session verification cancels when ${mutation} changes`, async t => {
    let resolveFetch;
    const h = setup(t, {
      values:new Map([['settings',{...config,enabled:false}]]),
      fetch:() => new Promise(resolve => { resolveFetch = resolve; }),
    });
    await h.flush();
    const button = h.document.querySelector('[data-gas-switch]');
    button.click();
    assert.equal(button.disabled, true);
    assert.equal(h.document.querySelector('[data-gas-switch]'), null);
    if (mutation === 'route') await h.navigate('/another-owner/repo');
    if (mutation === 'settings') h.values.set('settings', {...config,personal:'other-personal',enabled:false});
    if (mutation === 'edit') {
      const control = h.document.createElement('textarea');
      h.document.querySelector('main').append(control);
      control.dispatchEvent(new h.window.Event('input', {bubbles:true}));
    }
    if (mutation === 'activation') await h.deactivate();
    resolveFetch({ok:true,url:'https://github.com/',text:async()=>'<meta name="user-login" content="sample-personal">'});
    await h.flush();
    assert.equal(h.clicks.length, 0);
  });
}

test('manual switching keeps the recent-attempt cooldown', async t => {
  const values = new Map([
    ['settings',{...config,enabled:false}],
    ['attempt',{target:'sample-work',at:Date.now()}],
  ]);
  const h = setup(t, {values});
  await h.flush();
  h.document.querySelector('[data-gas-switch]').click();
  await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.match(h.document.querySelector('[data-gas-notice]').textContent, /반복 전환/);
});

test('manual switching preserves the stale-session reload guard', async t => {
  const h = setup(t, {
    values:new Map([['settings',{...config,enabled:false}]]),
    current:'sample-personal', session:'sample-other', expectReload:true,
  });
  await h.flush();
  h.document.querySelector('[data-gas-switch]').click();
  await h.flush();
  assert.equal(h.clicks.length, 0);
  assert.equal(h.values.has('refresh'), true);
  assert.equal(h.errors.length, 1);
});

test('saving, resetting, and toggling settings refreshes the manual button', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  const dialog = h.document.querySelector('[data-gas-settings]');
  dialog.querySelector('[name="enabled"]').checked = true;
  dialog.querySelector('form').dispatchEvent(new h.window.Event('submit', {cancelable:true}));
  await h.flush();
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
  h.menus.get('GitHub Account Switcher: 자동 전환 켜기/끄기')();
  await h.flush();
  assert.ok(h.document.querySelector('[data-gas-switch]'));
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[data-gas-reset]').click();
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
});


test('manual verification is cancelled by blur and refocus without visibility changes', async t => {
  let resolveFetch;
  const h = setup(t, {
    values:new Map([['settings',{...config,enabled:false}]]),
    fetch:() => new Promise(resolve => { resolveFetch = resolve; }),
  });
  await h.flush();
  h.document.querySelector('[data-gas-switch]').click();
  await h.blurRefocus();
  resolveFetch({ok:true,url:'https://github.com/',text:async()=>'<meta name="user-login" content="sample-personal">'});
  await h.flush();
  assert.equal(h.clicks.length, 0);
});

test('manual switch controls share a wrapper and dismiss without side effects until context changes', async t => {
  const h = setup(t, {values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  const switchButton = h.document.querySelector('[data-gas-switch]');
  const wrapper = switchButton?.parentElement;
  const closeButton = wrapper?.querySelector('[data-gas-switch-dismiss]');
  assert.equal(wrapper?.dataset.gasSwitchControls, '');
  assert.equal(closeButton?.tagName, 'BUTTON');
  assert.equal(closeButton?.type, 'button');
  assert.equal(closeButton?.getAttribute('aria-label'), '계정 전환 버튼 닫기');
  assert.equal(closeButton?.textContent, '×');
  assert.equal(switchButton?.nextElementSibling, closeButton);

  const fetchCalls = h.fetchCalls;
  const writes = [...h.writes];
  closeButton.click();
  assert.equal(h.document.querySelector('[data-gas-switch-controls]'), null);
  assert.equal(h.fetchCalls, fetchCalls);
  assert.deepEqual(h.writes, writes);
  assert.equal(h.values.get('settings').enabled, false);
  await h.tick();
  await h.blurRefocus();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[data-gas-cancel]').click();
  await h.flush();
  assert.equal(h.document.querySelector('[data-gas-switch-controls]'), null);

  await h.navigate('/sample-team/repo?view=changed');
  assert.ok(h.document.querySelector('[data-gas-switch-controls]'));
  assert.equal(h.document.querySelector('[data-gas-switch]')?.textContent, '@sample-work 계정으로 전환');
  h.document.querySelector('[data-gas-switch]').click();
  await h.flush();
  assert.deepEqual(h.clicks, [{account:'sample-work', url:'https://github.com/sample-team/repo?view=changed'}]);
  assert.equal(h.values.get('settings').enabled, false);
});

test('dismissal resets after ineligible routes, settings changes, and reset', async t => {
  const h = setup(t, {route:'/sample-team/repo', values:new Map([['settings',{...config,enabled:false}]])});
  await h.flush();
  h.document.querySelector('[data-gas-switch-dismiss]')?.click();
  assert.equal(h.document.querySelector('[data-gas-switch-controls]'), null);
  await h.navigate('/settings/profile');
  await h.navigate('/sample-team/repo');
  assert.ok(h.document.querySelector('[data-gas-switch-controls]'));

  h.document.querySelector('[data-gas-switch-dismiss]').click();
  h.values.set('settings', {...config, personal:'other-personal', enabled:false});
  await h.tick();
  assert.ok(h.document.querySelector('[data-gas-switch-controls]'));

  h.document.querySelector('[data-gas-switch-dismiss]').click();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[data-gas-reset]').click();
  assert.equal(h.document.querySelector('[data-gas-switch-controls]'), null);
  assert.equal(h.document.querySelector('[data-gas-switch]'), null);
});
