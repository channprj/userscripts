// ==UserScript==
// @name         GitHub Account Switcher
// @namespace    https://chann.dev
// @version      0.2.1
// @description  Switch GitHub accounts by organization/user or enterprise paths, with private browser-local settings.
// @match        https://github.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const NAME = 'GitHub Account Switcher';
  const EMPTY = { personal: '', rules: [], enabled: true };
  const NAME_PATTERN = /^[a-z\d](?:[a-z\d_-]*[a-z\d])?$/i;
  const ENTERPRISES_RULE = 'enterprises/*';
  // GitHub reserves these first path segments for account settings and site-wide
  // pages. They belong to no organization or user, so a switch is never intended.
  const SYSTEM_PATHS = new Set([
    'about', 'apps', 'blog', 'business', 'careers', 'changelog', 'codespaces',
    'collections', 'contact', 'customer-stories', 'dashboard', 'enterprise',
    'events', 'explore', 'features', 'git-lfs', 'home', 'import', 'integrations',
    'issues', 'marketplace', 'new', 'nonprofit', 'notifications', 'organizations',
    'pricing', 'pulls', 'readme', 'search', 'security', 'settings', 'site',
    'sponsors', 'stars', 'topics', 'trending', 'watching',
  ]);
  const SWITCH_COOLDOWN = 30_000;
  let busy = false;
  let lastKey = '';
  let activation = 0;
  let editing = false;
  const editedControls = new Set();

  const normalized = value => String(value ?? '').trim().toLowerCase();
  const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const validRuleOwner = value => NAME_PATTERN.test(value ?? '') || normalized(value) === ENTERPRISES_RULE;
  const active = () => document.visibilityState === 'visible' && document.hasFocus();
  const login = doc => normalized(doc.querySelector('meta[name="user-login"]')?.content);

  function pendingEdits() {
    for (const control of editedControls) if (!control.isConnected) editedControls.delete(control);
    return editedControls.size > 0;
  }

  function settings() {
    const value = GM_getValue('settings', EMPTY);
    if (!value || !NAME_PATTERN.test(value.personal ?? '') || !Array.isArray(value.rules)) return null;
    const owners = new Set();
    for (const rule of value.rules) {
      if (!rule || !validRuleOwner(rule.owner) || !NAME_PATTERN.test(rule.account ?? '')) return null;
      const owner = normalized(rule.owner);
      if (owners.has(owner)) return null;
      owners.add(owner);
    }
    return value;
  }

  function isAuthentication(pathname) {
    return /^\/(?:login|logout|session|sessions|switch_account|account|sudo|password_reset|password|signup|join|two-factor|auth)(?:\/|$)/i.test(pathname)
      || /^\/settings\/(?:two_factor_authentication|security)(?:\/|$)/i.test(pathname)
      || /^\/(?:orgs|enterprises)\/[^/]+\/(?:sso|saml|oidc)(?:\/|$)/i.test(pathname)
      || /^\/apps\/[^/]+\/(?:installations|permissions)(?:\/|$)/i.test(pathname);
  }

  // /settings/profile and similar pages act on the signed-in account itself.
  function isSystem(pathname) {
    return SYSTEM_PATHS.has(normalized(decoded(pathname.split('/').filter(Boolean)[0] ?? '')));
  }

  function targetAccount(url, config) {
    const enterpriseRule = /^\/enterprises\//i.test(url.pathname)
      ? config.rules.find(rule => normalized(rule.owner) === ENTERPRISES_RULE) : null;
    const parts = url.pathname.split('/').filter(Boolean).map(part => decoded(part));
    const owner = normalized(['orgs', 'users'].includes(parts[0]?.toLowerCase()) ? parts[1] : parts[0]);
    const ownerRule = config.rules.find(rule => normalized(rule.owner) === owner && owner !== ENTERPRISES_RULE);
    return normalized(enterpriseRule?.account ?? ownerRule?.account ?? config.personal);
  }

  function notice(message) {
    document.querySelector('[data-gas-notice]')?.remove();
    const box = document.createElement('div');
    box.dataset.gasNotice = '';
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:390px;padding:14px;border:1px solid #888;border-radius:8px;background:Canvas;color:CanvasText;font:14px/1.5 system-ui;box-shadow:0 3px 16px #0003';
    const text = document.createElement('div');
    text.textContent = `${NAME}: ${message}`;
    box.append(text);
    for (const [label, action] of [['설정', openSettings], ['닫기', () => box.remove()]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'margin:8px 8px 0 0;padding:3px 10px;cursor:pointer';
      button.addEventListener('click', action);
      box.append(button);
    }
    document.body.append(box);
  }

  function openSettings() {
    if (editing) return;
    editing = true;
    const value = settings() ?? EMPTY;
    const dialog = document.createElement('dialog');
    dialog.dataset.gasSettings = '';
    dialog.setAttribute('aria-label', `${NAME} 설정`);
    dialog.style.cssText = 'width:min(520px,90vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid #888;border-radius:10px;background:Canvas;color:CanvasText;font:14px/1.6 system-ui';
    // Only static markup is interpolated; user values are assigned with .value.
    dialog.innerHTML = `<form>
      <h2 style="font-size:20px;margin:0 0 16px">GitHub Account Switcher 설정</h2>
      <p>같은 브라우저의 GitHub에서 사용할 계정들을 먼저 Add account로 추가하세요.</p>
      <label style="display:block">기본 개인 계정 username
        <input name="personal" required autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:8px">
      </label>
      <label style="display:block">Organization / user / Enterprise 전환 규칙
        <textarea name="rules" rows="6" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;padding:8px"></textarea>
      </label>
      <p>한 줄에 <code>organization 또는 user = 전환할 username</code>을 입력하세요. URL 대신 이름만 입력합니다.</p>
      <p><code>/enterprises/</code> 아래 모든 경로에는 <code>enterprises/* = 전환할 username</code>을 사용하세요. SSO 등 인증 화면과 <code>/settings</code> 같은 GitHub 설정·시스템 페이지에서는 전환을 보류하며, 규칙에 없는 경로에서는 개인 계정을 사용합니다.</p>
      <label><input type="checkbox" name="enabled"> 자동 전환 사용</label>
      <p>설정은 이 브라우저의 userscript 매니저 저장소에만 저장됩니다. 코드나 저장소 파일은 수정하지 않습니다.</p>
      <p role="alert" data-gas-error style="color:#cf222e"></p>
      <button type="submit">저장</button>
      <button type="button" data-gas-cancel>취소</button>
      <button type="button" data-gas-reset>설정 삭제</button>
    </form>`;
    const form = dialog.querySelector('form');
    const personal = form.elements.namedItem('personal');
    const rules = form.elements.namedItem('rules');
    const enabled = form.elements.namedItem('enabled');
    personal.value = value.personal;
    rules.value = value.rules.map(rule => `${rule.owner} = ${rule.account}`).join('\n');
    enabled.checked = value.enabled !== false;
    const close = () => {
      dialog.remove();
      editing = false;
      lastKey = '';
      void check();
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('[data-gas-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-gas-reset]').addEventListener('click', () => {
      GM_deleteValue('settings');
      GM_deleteValue('attempt');
      close();
      notice('설정을 삭제했습니다. 설정을 입력하면 자동 전환을 시작합니다.');
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const parsed = [];
      const seen = new Set();
      try {
        if (!NAME_PATTERN.test(personal.value.trim())) throw new Error('개인 계정의 username을 확인해주세요.');
        for (const line of rules.value.split('\n').map(line => line.trim()).filter(Boolean)) {
          const pair = line.split('=').map(part => part.trim());
          if (pair.length !== 2 || !validRuleOwner(pair[0]) || !NAME_PATTERN.test(pair[1])) {
            throw new Error('각 규칙은 organization/user 이름 또는 enterprises/* = username 형식으로 입력해주세요.');
          }
          if (seen.has(normalized(pair[0]))) throw new Error('같은 이름이나 enterprises/* 규칙은 한 번만 입력해주세요.');
          seen.add(normalized(pair[0]));
          parsed.push({ owner: pair[0], account: pair[1] });
        }
        GM_setValue('settings', { personal: personal.value.trim(), rules: parsed, enabled: enabled.checked });
        GM_deleteValue('attempt');
        close();
        document.querySelector('[data-gas-notice]')?.remove();
      } catch (error) {
        dialog.querySelector('[data-gas-error]').textContent = error.message;
      }
    });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    personal.focus();
  }

  // React mounts these menus lazily. Observe the DOM instead of guessing delays.
  function waitFor(find, valid) {
    return new Promise(resolve => {
      let observer;
      let timeout;
      const finish = result => { observer?.disconnect(); clearTimeout(timeout); resolve(result); };
      const inspect = () => {
        if (!valid()) { finish(null); return true; }
        const result = find();
        if (result) { finish(result); return true; }
        return false;
      };
      if (inspect()) return;
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      timeout = setTimeout(() => finish(null), 5_000);
    });
  }

  function enabledElement(element) {
    return element && !element.matches('[disabled], [aria-disabled="true"]')
      && !element.closest('[hidden], [inert], [aria-hidden="true"]');
  }

  function accessibleName(element) {
    const labelled = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    return normalized(labelled || element.getAttribute('aria-label') || element.textContent);
  }

  function buttonNamed(name) {
    return Array.from(document.querySelectorAll('button')).find(button => accessibleName(button) === normalized(name));
  }

  function accountItem(target) {
    // Restrict matching to the account switcher's own menu, never repository text.
    const switcher = buttonNamed('Account switcher');
    if (!switcher || switcher.getAttribute('aria-expanded') !== 'true') return null;
    const menuId = switcher.getAttribute('aria-controls');
    const labels = new Set([switcher.id, ...(switcher.getAttribute('aria-labelledby') ?? '').split(/\s+/)].filter(Boolean));
    const menu = (menuId && document.getElementById(menuId))
      || Array.from(document.querySelectorAll('[role="menu"]')).find(menu =>
        menu.getAttribute('aria-labelledby')?.split(/\s+/).some(id => labels.has(id)));
    // Older React variants render a single unlabelled menu beside the switcher.
    const root = menu || (document.querySelectorAll('[role="menu"]').length === 1
      ? document.querySelector('[role="menu"]') : null);
    if (!root) return null;
    return Array.from(root.querySelectorAll('[role="menuitem"]')).find(item => {
      return accessibleName(item) === target;
    });
  }

  async function switchAccount(target, valid) {
    let opened = false;
    try {
      let switcher = buttonNamed('Account switcher');
      if (!switcher) {
        const opener = await waitFor(() => buttonNamed('Open user navigation menu'), valid);
        if (!enabledElement(opener) || !valid()) throw new Error('GitHub 사용자 메뉴를 찾지 못했습니다. 수동으로 계정을 전환해주세요.');
        opener.click();
        opened = true;
        switcher = await waitFor(() => buttonNamed('Account switcher'), valid);
      }
      if (!enabledElement(switcher) || !valid()) throw new Error('Account switcher에서 사용할 계정을 먼저 추가해주세요.');
      if (switcher.getAttribute('aria-expanded') !== 'true') switcher.click();
      const item = await waitFor(() => accountItem(target), valid);
      if (!valid()) return;
      if (!enabledElement(item)) throw new Error('대상 계정이 없거나 세션이 만료되었습니다. Account switcher에서 계정을 추가하거나 다시 로그인해주세요.');
      if (item.matches('a[href]')) {
        const url = new URL(item.getAttribute('href'), location.href);
        if (url.origin !== location.origin || isAuthentication(url.pathname)) {
          throw new Error('대상 계정의 재인증이 필요합니다. GitHub에서 직접 로그인해주세요.');
        }
      }
      // Persist before clicking so a rejected switch / reload cannot create a loop.
      GM_setValue('attempt', { target, at: Date.now() });
      item.click();
      // GitHub's own handler performs the switch and preserves the destination.
    } catch (error) {
      if (valid()) notice(error.message);
    } finally {
      if (opened) buttonNamed('Close user navigation menu')?.click();
    }
  }

  async function check() {
    if (!active() || busy || editing || pendingEdits()) return;
    const config = settings();
    if (!config || config.enabled === false) return;
    const url = new URL(location.href);
    if (isAuthentication(url.pathname) || isSystem(url.pathname)) return;
    const serialized = JSON.stringify(config);
    const key = `${url.href}\n${activation}\n${serialized}`;
    if (lastKey === key) return;
    lastKey = key;
    const valid = () => active() && !editing && !pendingEdits() && location.href === url.href
      && JSON.stringify(settings()) === serialized;
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const target = targetAccount(url, config);
      // A background tab's meta tag may describe the previous shared session.
      // Check the server before using any menu cached in that tab.
      const response = await fetch('/', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('현재 GitHub 계정을 확인하지 못했습니다. 다시 시도를 눌러주세요.');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const current = login(doc);
      if (!valid()) return;
      if (!current) throw new Error('GitHub 로그인이 필요합니다. 계정들을 먼저 로그인해주세요.');
      if (current !== login(document)) {
        const refresh = GM_getValue('refresh', 0);
        if (Date.now() - refresh < 10_000) throw new Error('다른 탭의 계정 변경을 확인했습니다. 이 페이지를 새로고침해주세요.');
        GM_setValue('refresh', Date.now());
        location.reload();
        return;
      }
      const previous = GM_getValue('attempt', null);
      if (current === target) {
        if (previous?.target === target) GM_deleteValue('attempt');
        return;
      }
      if (previous && Date.now() - previous.at < (previous.target === target ? SWITCH_COOLDOWN : 2_000)) {
        throw new Error('반복 전환을 멈췄습니다. 계정 상태를 확인한 뒤 매니저 메뉴에서 다시 시도를 눌러주세요.');
      }
      await switchAccount(target, valid);
    } catch (error) {
      if (valid()) notice(error.name === 'AbortError' ? '계정 확인 시간이 초과되었습니다. 매니저 메뉴에서 다시 시도를 눌러주세요.' : error.message);
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
  }

  GM_registerMenuCommand(`${NAME}: 설정`, openSettings);
  GM_registerMenuCommand(`${NAME}: 다시 시도`, () => {
    GM_deleteValue('attempt');
    GM_deleteValue('refresh');
    if (pendingEdits()) {
      notice('입력 중인 내용을 보호하기 위해 전환을 보류했습니다. 내용을 저장한 뒤 페이지를 새로고침해주세요.');
      return;
    }
    lastKey = '';
    void check();
  });
  GM_registerMenuCommand(`${NAME}: 자동 전환 켜기/끄기`, () => {
    const config = settings();
    if (!config) { openSettings(); return; }
    config.enabled = config.enabled === false;
    GM_setValue('settings', config);
    lastKey = '';
    notice(config.enabled ? '자동 전환을 켰습니다.' : '자동 전환을 껐습니다.');
    void check();
  });

  // Avoid reloading a tab with an unfinished comment or edited form.
  const markEdited = event => {
    const control = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (control && !control.closest('[data-gas-settings]') && !control.matches('input[type="search"]')) {
      editedControls.add(control);
      lastKey = '';
    }
  };
  document.addEventListener('input', markEdited, true);
  document.addEventListener('change', markEdited, true);
  const activate = () => { activation++; void check(); };
  window.addEventListener('focus', activate);
  document.addEventListener('visibilitychange', activate);
  for (const name of ['turbo:load', 'pjax:end']) document.addEventListener(name, () => { void check(); });
  window.addEventListener('popstate', () => { void check(); });
  // Detect pushState in both Tampermonkey's isolated world and GitHub's React router.
  setInterval(() => { void check(); }, 750);

  if (!settings()) notice('설정에서 개인 계정과 전환 규칙을 입력해주세요.');
  void check();
})();
