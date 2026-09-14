// ==UserScript==
// @name         JumpCloud Login Assistant
// @namespace    https://chann.dev
// @version      0.4.0
// @description  Store JumpCloud credentials in Tampermonkey and automatically log in.
// @match        https://console.jumpcloud.com/login*
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

  const NAME = 'JumpCloud Login Assistant';
  const ORIGIN = 'https://console.jumpcloud.com';
  const LIFETIME = 2 * 60_000;
  const STABLE = 1_000;
  const BUTTON = 'button[data-automation="loginButton"][type="submit"]';
  const ALERT = '[role="alert"], [data-test-id="error-alert"], [class*="loginAlert"], [class*="errorDisplay"]';
  let run = null;
  let automaticClick = false;
  let message = '';
  let loginSession = null;
  let settingsUI = null;
  let filledPassword = null;

  function allowedRoute() {
    return window.self === window.top && location.origin === ORIGIN
      && location.pathname.startsWith('/login');
  }

  if (!allowedRoute()) return;

  function notice(text) {
    message = text;
    let box = document.querySelector('[data-jcla-notice]');
    if (!box) {
      box = document.createElement('aside');
      box.dataset.jclaNotice = '';
      box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:14px;border:1px solid #888;border-radius:8px;background:Canvas;color:CanvasText;font:14px/1.5 system-ui;box-shadow:0 3px 16px #0003';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.style.margin = '0 0 8px';
      box.append(status);
      for (const [label, action] of [['중지', () => stop('현재 페이지의 자동 진행을 중지했습니다.')], ['닫기', () => box.remove()]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = 'margin-right:8px;padding:3px 10px;cursor:pointer';
        button.addEventListener('click', action);
        box.append(button);
      }
      document.body.append(box);
    }
    // Only our own static messages are rendered. Never include page content or errors.
    box.querySelector('[role="status"]').textContent = `${NAME}: ${text}`;
  }

  function stop(text, submitted = false) {
    if (run) {
      clearInterval(run.timer);
      clearTimeout(run.expiry);
      run.observer.disconnect();
      run = null;
    }
    closeSettingsUI();
    if (loginSession) { loginSession.email = ''; loginSession.password = ''; loginSession = null; }
    const filled = filledPassword;
    filledPassword = null;
    // Once submitted, JumpCloud may still be awaiting validation. It owns the form.
    if (!submitted && filled?.field.isConnected && filled.field.value === filled.password) setField(filled.field, '');
    if (text) notice(text);
  }

  function closeSettingsUI() {
    const ui = settingsUI;
    settingsUI = null;
    if (!ui) return;
    for (const input of ui.root.querySelectorAll('input')) input.value = '';
    ui.host.remove();
  }

  function setField(field, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function validateLogin(data) {
    return data && !Array.isArray(data) && typeof data.email === 'string' && data.email.length <= 254
      && /^[^\s@]+@[^\s@]+$/.test(data.email) && typeof data.password === 'string'
      && data.password.length > 0 && data.password.length <= 1024
      && Object.keys(data).length === 2;
  }

  function showSettings() {
    stop();
    if (!allowedRoute()) { notice('지원하는 로그인 페이지에서 설정하세요.'); return; }
    const host = document.createElement('div');
    // Closed shadow DOM avoids incidental page form handlers; it is not a security boundary.
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      dialog{width:min(440px,85vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid #888;border-radius:10px;background:Canvas;color:CanvasText;font:14px/1.6 system-ui}
      dialog::backdrop{background:#0006}h2{font-size:20px;margin:0 0 12px}label{display:block;margin:12px 0}input{display:block;width:100%;box-sizing:border-box;padding:8px}button{margin:8px 8px 0 0;padding:6px 12px} [role=alert]{color:#c22}
    </style><dialog aria-label="JumpCloud 로그인 정보"><form autocomplete="off">
      <h2>로그인 정보 설정</h2>
      <p>ID/PW를 이 브라우저의 Tampermonkey 저장소에 평문으로 보관합니다. 기존 저장 정보가 있으면 교체합니다.</p>
      <label>JumpCloud 이메일<input name="email" type="email" required maxlength="254" autocomplete="off"></label>
      <label>JumpCloud 비밀번호<input name="password" type="password" required maxlength="1024" autocomplete="new-password"></label>
      <p>로컬 전용으로 사용하려면 Tampermonkey 동기화·클라우드 백업을 끄고 저장 데이터를 외부로 내보내지 마세요.</p>
      <p role="alert"></p><button type="submit">저장 후 자동 로그인</button><button type="button">취소</button>
    </form></dialog>`;
    const ui = { host, root };
    settingsUI = ui;
    const dialog = root.querySelector('dialog');
    const form = root.querySelector('form');
    const button = root.querySelector('button[type="submit"]');
    const error = root.querySelector('[role="alert"]');
    root.querySelector('button[type="button"]').addEventListener('click', closeSettingsUI);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeSettingsUI(); });
    form.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      if (button.disabled || settingsUI !== ui || !allowedRoute() || document.visibilityState !== 'visible') return;
      const data = { email: form.elements.namedItem('email').value.trim(), password: form.elements.namedItem('password').value };
      try {
        if (!validateLogin(data)) { error.textContent = '이메일과 비밀번호를 확인하세요.'; return; }
        button.disabled = true;
        error.textContent = '';
        for (const input of root.querySelectorAll('input')) input.value = '';
        // Keep login disabled through partial failures. Remove legacy ciphertext only after saving the replacement.
        GM_setValue('enabled', false);
        GM_setValue('credentials', data);
        GM_deleteValue('vault');
        GM_setValue('enabled', true);
        closeSettingsUI();
        start();
      } catch {
        if (settingsUI === ui) error.textContent = '저장·활성화를 완료하지 못했습니다. 정보를 확인하고 다시 저장하세요.';
      } finally {
        data.email = ''; data.password = '';
        button.disabled = false;
      }
    });
    document.body.append(host);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    root.querySelector('input').focus();
  }

  function visible(element) {
    return element.isConnected && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === 'visible';
  }

  function enabled(element) {
    return visible(element) && !element.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]');
  }

  const active = () => document.visibilityState === 'visible' && document.hasFocus();

  function safeForm(form, button) {
    if (form.method.toLowerCase() !== 'post' || form.noValidate || button.formNoValidate
      || !['', '_self'].includes(form.target) || !['', '_self'].includes(button.formTarget)
      || button.hasAttribute('formmethod') || document.querySelector('base')) return false;
    for (const action of [form.getAttribute('action'), button.getAttribute('formaction')]) {
      if (action === null) continue;
      try {
        const url = new URL(action, location.href);
        if (url.origin !== ORIGIN || url.username || url.password) return false;
      } catch { return false; }
    }
    return true;
  }

  function candidate(requireReady = true) {
    const buttons = Array.from(document.querySelectorAll(BUTTON)).filter(visible);
    const forms = Array.from(document.forms).filter(visible);
    if (buttons.length !== 1 || forms.length !== 1) return null;
    const button = buttons[0];
    const form = button.form;
    if (form !== forms[0] || (requireReady && !enabled(button)) || !safeForm(form, button)) return null;
    let field = null;
    for (const control of form.elements) {
      if (control.tagName === 'BUTTON' || control.tagName === 'FIELDSET') continue;
      if (control.tagName !== 'INPUT') return null;
      // JumpCloud owns hidden form state and its readonly email on the password step.
      if (control.type === 'hidden' || (control.type === 'email' && control.readOnly && !visible(control))) continue;
      if (control.type === 'checkbox' && !control.required) continue;
      if (field || !enabled(control) || control.readOnly || !control.required
        || !control.willValidate || control.autocomplete === 'new-password'
        || !['email', 'password'].includes(control.name) || control.type !== control.name) return null;
      field = control;
    }
    if (!field || (requireReady && !field.validity.valid)) return null;
    return { field, button, stage: field.name };
  }

  const normalizedEmail = email => email.trim().toLowerCase();

  function accountMatches(next) {
    const fields = next.stage === 'email' ? [next.field]
      : Array.from(next.field.form.querySelectorAll('input[type="email"][readonly]'));
    return fields.length === 1 && normalizedEmail(fields[0].value) === normalizedEmail(loginSession.email);
  }

  function fillSavedLogin(current) {
    if (!loginSession) return;
    const next = candidate(false);
    if (!next || current.sent.has(next.stage)) return;
    if ((next.stage === 'password' && !accountMatches(next))
      || (next.field.value && next.field.value !== loginSession[next.stage])) {
      stop('입력된 계정 또는 비밀번호가 저장 정보와 다릅니다. 내용을 직접 확인하세요.'); return;
    }
    if (!next.field.value) {
      current.filling = true;
      try {
        if (next.stage === 'password') filledPassword = { field: next.field, password: loginSession.password };
        setField(next.field, loginSession[next.stage]);
      } finally { current.filling = false; }
      current.ready = null;
    }
  }

  const same = (a, b) => a && b && a.field === b.field && a.button === b.button && a.stage === b.stage;

  function inspect() {
    const current = run;
    if (!current || current.filling) return;
    try {
      if (!allowedRoute()) { stop('로그인 경로가 바뀌어 자동 진행을 중지했습니다.'); return; }
      if (Date.now() >= current.deadline) { stop('대기 시간이 끝났습니다. 준비 후 메뉴에서 다시 시도하세요.'); return; }
      if (Array.from(document.querySelectorAll(ALERT)).some(visible)) {
        stop('페이지에 알림이 있어 중지했습니다. 내용을 직접 확인하세요.'); return;
      }
      if (document.querySelector('input[autocomplete="one-time-code"]')) {
        stop('추가 인증은 직접 완료하세요.'); return;
      }
      if (!active()) { current.ready = null; return; }
      fillSavedLogin(current);
      if (run !== current) return;
      const next = candidate();
      if (!next || current.sent.has(next.stage)) { current.ready = null; return; }
      if (!same(current.ready, next)) {
        current.ready = { ...next, since: Date.now() };
        return;
      }
      if (Date.now() - current.ready.since < STABLE) return;
      if (GM_getValue('enabled', false) !== true) { stop('자동 진행이 꺼져 있습니다.'); return; }
      if (loginSession && (!accountMatches(next) || next.field.value !== loginSession[next.stage])) {
        stop('로그인 대상이 바뀌어 중지했습니다. 내용을 직접 확인하세요.'); return;
      }
      // Mark this stage before clicking: synchronous page events must not submit it again.
      current.sent.add(next.stage);
      current.ready = null;
      automaticClick = true;
      try { next.button.click(); } finally { automaticClick = false; }
      if (next.stage === 'password') stop('비밀번호 단계를 제출했습니다. 추가 인증과 로그인 결과를 직접 확인하세요.', true);
      else if (run === current) notice('이메일 단계를 제출했습니다. 비밀번호 단계를 기다립니다.');
    } catch { stop('안전한 자동 진행 조건을 확인할 수 없어 중지했습니다.'); }
  }

  function start() {
    stop();
    if (!allowedRoute()) { stop('지원하는 User Login 화면에서만 실행할 수 있습니다.'); return; }
    try {
      if (GM_getValue('vault', null) !== null) {
        stop('이전 버전의 암호화 정보는 자동 변환할 수 없습니다. 메뉴에서 로그인 정보를 한 번 다시 등록하세요.'); return;
      }
      if (GM_getValue('enabled', false) !== true) {
        stop('메뉴에서 로그인 정보를 설정하세요. 저장된 정보나 외부 자동완성은 자동 진행 켜기/끄기로 사용할 수 있습니다.'); return;
      }
      const saved = GM_getValue('credentials', null);
      if (saved !== null) {
        if (!validateLogin(saved)) { stop('저장 정보 형식이 올바르지 않습니다. 메뉴에서 로그인 정보를 다시 등록하세요.'); return; }
        loginSession = { email: saved.email, password: saved.password };
      }
      const observer = new MutationObserver(inspect);
      run = { observer, sent: new Set(), ready: null, deadline: Date.now() + LIFETIME };
      run.timer = setInterval(inspect, 500);
      run.expiry = setTimeout(() => stop('대기 시간이 끝났습니다. 준비 후 메뉴에서 다시 시도하세요.'), LIFETIME);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      notice(loginSession ? '저장한 계정으로 로그인합니다. 직접 입력하면 자동 진행을 중지합니다.' : '암호 관리자의 자동 입력을 기다립니다. 직접 입력하면 자동 진행을 중지합니다.');
      inspect();
    } catch { stop('설정을 읽을 수 없어 자동 진행을 중지했습니다.'); }
  }

  function menu(label, action) {
    GM_registerMenuCommand(`${NAME}: ${label}`, async () => {
      try { await action(); } catch { stop('설정을 읽거나 저장할 수 없어 자동 진행을 중지했습니다.'); }
    });
  }

  menu('로그인 정보 설정', showSettings);
  menu('저장 정보 삭제', () => {
    stop();
    if (!confirm('저장한 로그인 정보를 삭제할까요? 다시 사용하려면 등록해야 합니다.')) return;
    GM_setValue('enabled', false);
    GM_deleteValue('credentials');
    GM_deleteValue('vault');
    notice('저장 정보를 삭제하고 자동 진행을 껐습니다.');
  });
  menu('자동 진행 켜기/끄기', () => {
    GM_setValue('enabled', GM_getValue('enabled', false) !== true);
    start();
  });
  menu('현재 페이지 중지', () => stop('현재 페이지의 자동 진행을 중지했습니다.'));
  menu('다시 시도', start);
  menu('상태 안내', () => notice(message));

  for (const type of ['input', 'change']) document.addEventListener(type, () => {
    if (run) { run.ready = null; inspect(); }
  }, true);
  for (const type of ['beforeinput', 'paste', 'compositionstart']) document.addEventListener(type, event => {
    // The event payload is never read. Browser replacement autofill may emit beforeinput.
    if (type === 'beforeinput' && event.inputType === 'insertReplacementText') return;
    if (run && event.target instanceof HTMLInputElement) stop('직접 입력을 감지했습니다. 로그인은 직접 진행하세요.');
  }, true);
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape') stop('현재 페이지의 자동 진행을 중지했습니다.');
    // JumpCloud's Vue input handles Enter directly without a native form submit.
    if (run && ['Enter', 'NumpadEnter'].includes(event.code) && event.target instanceof HTMLInputElement) {
      stop('직접 로그인을 진행 중이므로 자동 진행을 중지했습니다.', true);
    }
  }, true);
  document.addEventListener('click', event => {
    if (run && !automaticClick && event.target instanceof Element && event.target.closest(BUTTON)) {
      stop('직접 로그인을 진행 중이므로 자동 진행을 중지했습니다.', true);
    }
  }, true);
  document.addEventListener('submit', () => {
    if (run && !automaticClick) stop('직접 로그인을 진행 중이므로 자동 진행을 중지했습니다.', true);
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && (loginSession || settingsUI)) stop('페이지가 숨겨져 자동 진행을 중지했습니다. 필요하면 메뉴에서 다시 시도하세요.');
    else inspect();
  });
  window.addEventListener('focus', inspect);
  window.addEventListener('blur', () => { if (run) run.ready = null; });
  const routeChanged = () => {
    if (settingsUI && !allowedRoute()) stop('로그인 경로가 바뀌어 중지했습니다.');
    else inspect();
  };
  window.addEventListener('hashchange', routeChanged);
  window.addEventListener('popstate', routeChanged);
  window.addEventListener('pagehide', () => stop());
  start();
})();
