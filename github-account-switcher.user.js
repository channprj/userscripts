// ==UserScript==
// @name         GitHub Account Switcher
// @namespace    https://chann.dev
// @version      0.6.1
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
  // GitHub's own account switcher reads stashed sessions from ACCOUNTS_PATH and
  // posts the selected one to SWITCH_PATH, so no menu needs to be opened.
  const ACCOUNTS_PATH = '/_side-panels/user.json';
  const SWITCH_PATH = '/switch_account';
  const SESSION_TIMEOUT = 8_000;
  const SWITCH_TIMEOUT = 15_000;
  const COUNTDOWN_SECONDS = 4;
  let busy = false;
  let manualButton = null;
  let manualLabel = null;
  let manualCountdown = null;
  let manualGauge = null;
  let manualButtonSnapshot = null;
  let manualControls = null;
  let observedManualContext = '';
  let dismissedManualContext = null;
  let countdownContext = null;
  let firedCountdownContext = null;
  let countdownTimer = 0;
  let lastKey = '';
  let activation = 0;
  let wasActive;
  let editing = false;
  const editedControls = new Set();

  const normalized = value => String(value ?? '').trim().toLowerCase();
  const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const validRuleOwner = value => NAME_PATTERN.test(value ?? '') || normalized(value) === ENTERPRISES_RULE;
  const active = () => document.visibilityState === 'visible' && document.hasFocus();
  wasActive = active();
  const login = doc => normalized(doc.querySelector('meta[name="user-login"]')?.content);

  function pendingEdits() {
    for (const control of editedControls) if (!control.isConnected) editedControls.delete(control);
    return editedControls.size > 0;
  }

  function settings() {
    const value = GM_getValue('settings', EMPTY);
    if (!value || !NAME_PATTERN.test(value.personal ?? '') || !Array.isArray(value.rules)) return null;
    if (Object.hasOwn(value, 'autoSwitchAccount') && (typeof value.autoSwitchAccount !== 'string'
      || (value.autoSwitchAccount.trim() && !NAME_PATTERN.test(value.autoSwitchAccount.trim())))) return null;
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

  function isAutomatic(config, target) {
    return config.enabled !== false || (!!normalized(config.autoSwitchAccount)
      && normalized(config.autoSwitchAccount) === target);
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
    refreshManualButton();
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
      <label style="display:block">자동 전환 예외 계정 username
        <input name="autoSwitchAccount" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;padding:8px">
      </label>
      <p>전체 자동 전환을 꺼도 이 계정이 대상이면 자동 전환합니다. 비우면 예외가 없습니다.</p>
      <label style="display:block">Organization / user / Enterprise 전환 규칙
        <textarea name="rules" rows="6" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;margin:6px 0;padding:8px"></textarea>
      </label>
      <p>한 줄에 <code>organization 또는 user = 전환할 username</code>을 입력하세요. URL 대신 이름만 입력합니다.</p>
      <p><code>/enterprises/</code> 아래 모든 경로에는 <code>enterprises/* = 전환할 username</code>을 사용하세요. SSO 등 인증 화면과 <code>/settings</code> 같은 GitHub 설정·시스템 페이지에서는 전환을 보류하며, 규칙에 없는 경로에서는 개인 계정을 사용합니다.</p>
      <label><input type="checkbox" name="enabled"> 자동 전환 사용</label>
      <p>끄면 전환이 필요할 때 화면 상단에 버튼이 나타나고 ${COUNTDOWN_SECONDS}초 뒤 전환합니다. 버튼을 누르면 바로 전환하고, ×를 누르면 취소합니다.</p>
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
    const autoSwitchAccount = form.elements.namedItem('autoSwitchAccount');
    personal.value = value.personal;
    rules.value = value.rules.map(rule => `${rule.owner} = ${rule.account}`).join('\n');
    enabled.checked = value.enabled !== false;
    autoSwitchAccount.value = value.autoSwitchAccount ?? '';
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
        const exception = autoSwitchAccount.value.trim();
        if (exception && !NAME_PATTERN.test(exception)) throw new Error('자동 전환 예외 계정의 username을 확인해주세요.');
        for (const line of rules.value.split('\n').map(line => line.trim()).filter(Boolean)) {
          const pair = line.split('=').map(part => part.trim());
          if (pair.length !== 2 || !validRuleOwner(pair[0]) || !NAME_PATTERN.test(pair[1])) {
            throw new Error('각 규칙은 organization/user 이름 또는 enterprises/* = username 형식으로 입력해주세요.');
          }
          if (seen.has(normalized(pair[0]))) throw new Error('같은 이름이나 enterprises/* 규칙은 한 번만 입력해주세요.');
          seen.add(normalized(pair[0]));
          parsed.push({ owner: pair[0], account: pair[1] });
        }
        const next = { personal: personal.value.trim(), rules: parsed, enabled: enabled.checked };
        if (exception) next.autoSwitchAccount = exception;
        GM_setValue('settings', next);
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

  // Fallback for GitHub variants without the stashed-account endpoint.
  async function switchWithMenu(target, valid) {
    let opened = false;
    let submitted = false;
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
      submitted = true;
      // GitHub's own handler performs the switch and preserves the destination.
    } catch (error) {
      if (valid()) notice(error.message);
    } finally {
      if (opened && !submitted) buttonNamed('Close user navigation menu')?.click();
    }
  }

  // Mirror the headers of GitHub's verifiedFetch. The fresh session document
  // carries the newest nonce; the current page is the fallback.
  function verifiedHeaders(doc) {
    const meta = name => doc.querySelector(`meta[name="${name}"]`)?.content
      || document.querySelector(`meta[name="${name}"]`)?.content;
    const headers = { Accept: 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' };
    if (meta('fetch-nonce')) headers['X-Fetch-Nonce'] = meta('fetch-nonce');
    if (meta('release')) headers['X-GitHub-Client-Version'] = meta('release');
    return headers;
  }

  async function withTimeout(ms, run) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try { return await run(controller.signal); } finally { clearTimeout(timeout); }
  }

  async function sessionDocument(signal) {
    const response = await fetch('/', { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('현재 GitHub 계정을 확인하지 못했습니다. 다시 시도를 눌러주세요.');
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  // Returns null when GitHub no longer exposes stashed accounts in this shape.
  async function stashedAccounts(headers, signal) {
    const response = await fetch(ACCOUNTS_PATH, { credentials: 'same-origin', cache: 'no-store', headers, signal });
    if (!response.ok || new URL(response.url).origin !== location.origin) return null;
    const data = await response.json().catch(error => { if (error.name === 'AbortError') throw error; return null; });
    const accounts = data?.stashedAccounts;
    return Array.isArray(accounts) && accounts.every(account => typeof account?.login === 'string'
      && ['string', 'number'].includes(typeof account.userSessionId)) ? accounts : null;
  }

  // Reload like GitHub, or follow its SSO redirect, unless unsaved input would be lost.
  function leavePage(redirect) {
    if (pendingEdits() || editing) {
      notice(redirect ? '대상 계정의 SSO 인증이 필요합니다. 입력 중인 내용을 저장한 뒤 다시 시도해주세요.'
        : '계정을 전환했습니다. 입력 중인 내용을 저장한 뒤 페이지를 새로고침해주세요.');
    } else if (redirect) location.assign(redirect);
    else location.reload();
  }

  async function switchAccount(target, doc, valid, signal) {
    const headers = verifiedHeaders(doc);
    const accounts = await stashedAccounts(headers, signal);
    if (!valid()) return;
    if (!accounts) { await switchWithMenu(target, valid); return; }
    const account = accounts.find(account => normalized(account.login) === target);
    if (!account || String(account.userSessionId) === '') {
      throw new Error('대상 계정이 없거나 세션이 만료되었습니다. Account switcher에서 계정을 추가하거나 다시 로그인해주세요.');
    }
    const body = new FormData();
    body.append('user_session_id', String(account.userSessionId));
    body.append('from', 'nav_panel');
    // Persist before posting so a rejected switch / reload cannot create a loop.
    GM_setValue('attempt', { target, at: Date.now() });
    // The POST has its own time budget: aborting it cannot undo a switch the server already made.
    const result = await withTimeout(SWITCH_TIMEOUT, async postSignal => {
      const response = await fetch(SWITCH_PATH, { method: 'POST', credentials: 'same-origin', headers, body, signal: postSignal });
      return { ok: response.ok, data: await response.json() };
    }).catch(() => null);
    if (result?.ok && result.data?.success) { leavePage(); return; }
    if (result?.data?.reason === 'emu_sso_redirect' && typeof result.data.redirect_to === 'string') {
      let redirect = null;
      try { redirect = new URL(result.data.redirect_to, location.href); } catch {}
      if (!/^https?:$/.test(redirect?.protocol ?? '')) throw new Error('대상 계정의 재인증이 필요합니다. GitHub에서 직접 로그인해주세요.');
      leavePage(redirect.href);
      return;
    }
    if (typeof result?.data?.error === 'string' && result.data.error.trim()) {
      throw new Error(`계정을 전환하지 못했습니다: ${result.data.error.trim()}`);
    }
    // Without a clear answer the switch may still have happened, so trust the server session.
    if (login(await withTimeout(SESSION_TIMEOUT, sessionDocument)) === target) { leavePage(); return; }
    throw new Error('계정을 전환하지 못했습니다. Account switcher에서 계정을 다시 추가하거나 다시 로그인해주세요.');
  }

  function startManualSwitch() {
    if (busy || !manualButtonSnapshot) return;
    const snapshot = manualButtonSnapshot;
    // One countdown per page: a failed switch leaves the button for an explicit retry.
    firedCountdownContext = snapshot.context;
    stopCountdown();
    manualButton.disabled = true;
    void check({ manual: snapshot });
  }

  function stopCountdown() {
    clearTimeout(countdownTimer);
    countdownContext = null;
    if (!manualControls) return;
    manualCountdown.hidden = true;
    manualGauge.hidden = true;
    manualButton.removeAttribute('title');
  }

  // The gauge shrinks in one CSS transition while the label counts whole seconds.
  function startCountdown(context) {
    stopCountdown();
    countdownContext = context;
    let remaining = COUNTDOWN_SECONDS;
    manualButton.title = '누르면 바로 전환하고, ×를 누르면 취소합니다.';
    manualGauge.hidden = false;
    manualGauge.style.transition = 'none';
    manualGauge.style.transform = 'scaleX(1)';
    manualGauge.getBoundingClientRect();
    manualGauge.style.transition = `transform ${COUNTDOWN_SECONDS * 1_000}ms linear`;
    manualGauge.style.transform = 'scaleX(0)';
    const step = () => {
      if (remaining === 0) { startManualSwitch(); return; }
      manualCountdown.hidden = false;
      manualCountdown.textContent = `${remaining}초`;
      remaining--;
      countdownTimer = setTimeout(step, 1_000);
    };
    step();
  }

  function hideManualControls() {
    stopCountdown();
    manualControls?.remove();
  }

  function refreshManualButton() {
    const config = settings();
    const url = new URL(location.href);
    const serialized = JSON.stringify(config);
    const target = config ? targetAccount(url, config) : '';
    // Dismissal and the one-countdown rule follow the account to switch to, not the
    // exact address, so anchors and other pages needing the same account keep them.
    const context = `${target}\n${serialized}`;
    if (observedManualContext && observedManualContext !== context) {
      dismissedManualContext = null;
      firedCountdownContext = null;
    }
    observedManualContext = context;
    const eligible = !!config && !isAutomatic(config, target) && active() && !editing && !pendingEdits()
      && !busy && !!login(document) && login(document) !== target
      && !isAuthentication(url.pathname) && !isSystem(url.pathname);
    if (!eligible || dismissedManualContext === context) { hideManualControls(); return; }
    if (!manualControls) {
      manualControls = document.createElement('div');
      manualControls.dataset.gasSwitchControls = '';
      manualControls.style.cssText = 'position:fixed;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:stretch;width:max-content;max-width:calc(100vw - 32px);overflow:hidden;border:1px solid #57606a;border-radius:8px;background:Canvas;color:CanvasText;font:14px/1.4 system-ui;box-shadow:0 2px 8px #0003';
      manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.dataset.gasSwitch = '';
      manualButton.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:8px 14px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer';
      manualButton.addEventListener('click', startManualSwitch);
      // Only the label truncates, so a long username never hides the countdown.
      manualLabel = document.createElement('span');
      manualLabel.dataset.gasSwitchLabel = '';
      manualLabel.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      manualCountdown = document.createElement('span');
      manualCountdown.dataset.gasSwitchCountdown = '';
      manualCountdown.setAttribute('aria-hidden', 'true');
      manualCountdown.hidden = true;
      manualCountdown.style.cssText = 'flex:none;font-variant-numeric:tabular-nums;opacity:.7';
      manualButton.append(manualLabel, manualCountdown);
      const dismissButton = document.createElement('button');
      dismissButton.type = 'button';
      dismissButton.dataset.gasSwitchDismiss = '';
      dismissButton.setAttribute('aria-label', '계정 전환 버튼 닫기');
      dismissButton.title = '계정 전환 버튼 닫기';
      dismissButton.textContent = '×';
      dismissButton.style.cssText = 'flex:0 0 40px;min-width:40px;padding:0;border:0;border-left:1px solid #57606a;background:transparent;color:inherit;font:20px/1 system-ui;cursor:pointer';
      dismissButton.addEventListener('click', () => {
        if (!manualControls?.isConnected) return;
        dismissedManualContext = observedManualContext;
        hideManualControls();
      });
      manualGauge = document.createElement('div');
      manualGauge.dataset.gasSwitchGauge = '';
      manualGauge.setAttribute('aria-hidden', 'true');
      manualGauge.hidden = true;
      manualGauge.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:3px;background:#2f81f7;forced-color-adjust:none;transform-origin:left center;pointer-events:none';
      manualControls.append(manualButton, dismissButton, manualGauge);
    }
    if (!manualControls.isConnected) document.body.append(manualControls);
    manualButtonSnapshot = { url: url.href, serialized, target, activation, context };
    manualButton.disabled = false;
    manualLabel.textContent = `@${target} 계정으로 전환`;
    if (countdownContext !== context && firedCountdownContext !== context) startCountdown(context);
  }

  async function check(options = {}) {
    const manual = options.manual ?? null;
    if (!manual) refreshManualButton();
    if (!active() || busy || editing || pendingEdits()) { refreshManualButton(); return; }
    const config = settings();
    if (!config) return;
    const url = new URL(location.href);
    const target = targetAccount(url, config);
    if (!isAutomatic(config, target) && !manual) { refreshManualButton(); return; }
    if (isAuthentication(url.pathname) || isSystem(url.pathname)) { refreshManualButton(); return; }
    const serialized = JSON.stringify(config);
    if (manual && (manual.url !== url.href || manual.serialized !== serialized || manual.activation !== activation
      || target !== manual.target || isAutomatic(config, target))) { refreshManualButton(); return; }
    const key = `${url.href}\n${activation}\n${serialized}`;
    if (!manual && lastKey === key) return;
    if (!manual) lastKey = key;
    const expectedActivation = manual?.activation ?? activation;
    const valid = () => active() && !editing && !pendingEdits() && location.href === url.href
      && activation === expectedActivation && JSON.stringify(settings()) === serialized
      && (!manual || (manual.url === location.href && manual.target === targetAccount(url, settings())
        && !isAutomatic(settings(), manual.target)));
    busy = true;
    refreshManualButton();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT);
    try {
      const switchTarget = manual?.target ?? target;
      // A background tab's meta tag may describe the previous shared session.
      // Check the server before using any menu cached in that tab.
      const doc = await sessionDocument(controller.signal);
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
      if (current === switchTarget) {
        if (previous?.target === switchTarget) GM_deleteValue('attempt');
        return;
      }
      if (previous && Date.now() - previous.at < (previous.target === switchTarget ? SWITCH_COOLDOWN : 2_000)) {
        throw new Error('반복 전환을 멈췄습니다. 계정 상태를 확인한 뒤 매니저 메뉴에서 다시 시도를 눌러주세요.');
      }
      await switchAccount(switchTarget, doc, valid, controller.signal);
    } catch (error) {
      if (valid()) notice(error.name === 'AbortError' ? '계정 확인 시간이 초과되었습니다. 매니저 메뉴에서 다시 시도를 눌러주세요.' : error.message);
    } finally {
      clearTimeout(timeout);
      busy = false;
      refreshManualButton();
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
    refreshManualButton();
    lastKey = '';
    notice(config.enabled ? '자동 전환을 켰습니다.' : normalized(config.autoSwitchAccount)
      ? `자동 전환을 껐습니다. 예외 계정 @${config.autoSwitchAccount.trim()}이 대상이면 계속 자동 전환하고, 다른 계정은 상단 버튼이 ${COUNTDOWN_SECONDS}초 뒤 전환합니다.`
      : `자동 전환을 껐습니다. 전환이 필요하면 상단 버튼이 ${COUNTDOWN_SECONDS}초 뒤 전환하며 ×로 취소할 수 있습니다.`);
    void check();
  });

  // Avoid reloading a tab with an unfinished comment or edited form.
  const markEdited = event => {
    const control = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (control && !control.closest('[data-gas-settings]') && !control.matches('input[type="search"]')) {
      editedControls.add(control);
      lastKey = '';
      refreshManualButton();
    }
  };
  document.addEventListener('input', markEdited, true);
  document.addEventListener('change', markEdited, true);
  const activate = () => {
    const nowActive = active();
    if (nowActive && !wasActive) activation++;
    wasActive = nowActive;
    void check();
  };
  window.addEventListener('focus', activate);
  window.addEventListener('blur', activate);
  window.navigation?.addEventListener('currententrychange', () => { void check(); });
  document.addEventListener('visibilitychange', activate);
  for (const name of ['turbo:load', 'pjax:end']) document.addEventListener(name, () => { void check(); });
  window.addEventListener('popstate', () => { void check(); });
  // Detect pushState in both Tampermonkey's isolated world and GitHub's React router.
  setInterval(() => { void check(); }, 750);

  if (!settings()) notice('설정에서 개인 계정과 전환 규칙을 입력해주세요.');
  void check();
})();
