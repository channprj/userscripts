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
    <header><button aria-labelledby="user-menu-label" data-login="sample-personal">Profile</button><span id="user-menu-label" hidden>Open user navigation menu</span></header><main></main>`, {
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
  const intervals = [];
  const writes = [];
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
  const userButton = document.querySelector('header button');
  userButton.addEventListener('click', () => {
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
        item.addEventListener('click', () => clicks.push({ account, url: window.location.href }));
        menu.append(item);
      }
      menu.insertAdjacentHTML('beforeend', '<li><a role="menuitem" href="/login?add_account=1">Add account</a></li>');
      nav.append(menu);
    });
  });
  window.eval(source);
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return {
    window, document, values, menus, clicks, writes, errors, flush,
    async tick() { for (const fn of intervals) fn(); await flush(); },
    async settle() { await new Promise(resolve => setTimeout(resolve, 35)); await flush(); },
    async navigate(route) { window.history.pushState({}, '', route); await this.tick(); },
    async activate() {
      visible = true; focused = true;
      document.dispatchEvent(new window.Event('visibilitychange'));
      window.dispatchEvent(new window.Event('focus'));
      await this.tick();
    },
  };
}

test('switches the exact configured account and retains the full destination', async t => {
  const h = setup(t);
  await h.flush();
  assert.deepEqual(h.clicks, [{account:'sample-work', url:'https://github.com/sample-team/repo/pull/42?tab=files#diff-1'}]);
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

test('deleting settings removes stored mappings and stops switching', async t => {
  const h = setup(t, {route:'/'}); await h.flush();
  h.menus.get('GitHub Account Switcher: 설정')();
  h.document.querySelector('[data-gas-reset]').click();
  assert.equal(h.values.has('settings'), false);
  await h.navigate('/sample-team/repo');
  assert.equal(h.clicks.length, 0);
});
