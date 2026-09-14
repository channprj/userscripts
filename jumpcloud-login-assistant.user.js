// ==UserScript==
// @name         JumpCloud Login Assistant
// @namespace    https://chann.dev
// @version      0.1.0
// @description  Advance locally autofilled JumpCloud login forms without reading or storing credentials.
// @match        https://console.jumpcloud.com/login*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const NAME = 'JumpCloud Login Assistant';
  const ORIGIN = 'https://console.jumpcloud.com';
  const LOCK = 'chann.jumpcloud-login-assistant';
  const ATTEMPTS_KEY = `${LOCK}.attempts.v1`;
  const COOLDOWN = 10 * 60_000;
  const LIFETIME = 2 * 60_000;
  const STABLE = 1_000;
  const BUTTON = 'button[data-automation="loginButton"][type="submit"]';
  const ALERT = '[role="alert"], [data-test-id="error-alert"], [class*="loginAlert"], [class*="errorDisplay"]';
  let run = null;
  let automaticClick = false;
  let message = '';

  function allowedRoute() {
    if (window.self !== window.top || location.origin !== ORIGIN
      || !['/login', '/login/'].includes(location.pathname)
      || !['', '#', '#/'].includes(location.hash)) return false;
    const params = [...new URLSearchParams(location.search)];
    return params.length === 0 || (params.length === 1 && params[0][0] === 'step' && params[0][1] === 'password');
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

  function stop(text) {
    if (run) {
      clearInterval(run.timer);
      clearTimeout(run.expiry);
      run.observer.disconnect();
      run = null;
    }
    if (text) notice(text);
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

  function candidate() {
    const buttons = Array.from(document.querySelectorAll(BUTTON)).filter(visible);
    const forms = Array.from(document.forms).filter(visible);
    if (buttons.length !== 1 || forms.length !== 1) return null;
    const button = buttons[0];
    const form = button.form;
    if (form !== forms[0] || !enabled(button) || !safeForm(form, button)) return null;
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
    // Native validity is a boolean; never inspect input values or serialize the form.
    if (!field || !field.validity.valid) return null;
    return { field, button, stage: field.name };
  }

  function attempts() {
    // Read only this script's timestamp record, never JumpCloud's account/session keys.
    const saved = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error();
    const clean = {};
    for (const key of Object.keys(saved)) {
      if (!['email', 'password'].includes(key) || !Number.isFinite(saved[key]) || saved[key] <= 0) throw new Error();
      clean[key] = saved[key];
    }
    return clean;
  }

  const recent = at => typeof at === 'number' && Date.now() - at < COOLDOWN;
  const same = (a, b) => a && b && a.field === b.field && a.button === b.button && a.stage === b.stage;

  function inspect() {
    const current = run;
    if (!current) return;
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
      const next = candidate();
      if (!next || current.sent.has(next.stage)) { current.ready = null; return; }
      if (!same(current.ready, next)) {
        current.ready = { ...next, since: Date.now() };
        return;
      }
      if (current.busy || Date.now() - current.ready.since < STABLE) return;
      current.busy = true;
      const ready = current.ready;
      void navigator.locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock || run !== current || current.ready !== ready) return;
        if (!allowedRoute() || !active() || Date.now() >= current.deadline || !same(ready, candidate())
          || document.querySelector('input[autocomplete="one-time-code"]')
          || Array.from(document.querySelectorAll(ALERT)).some(visible)) return;
        if (GM_getValue('enabled', false) !== true) { stop('자동 진행이 꺼져 있습니다.'); return; }
        const saved = attempts();
        if (recent(saved.password) || recent(saved[next.stage])) {
          stop('최근 제출 기록이 있어 중지했습니다. 필요하면 메뉴에서 다시 시도하세요.'); return;
        }
        // The origin store is shared synchronously across tabs; GM caches may lag.
        // Commit only timestamps inside the lock, before any site side effect.
        saved[next.stage] = Date.now();
        localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(saved));
        current.sent.add(next.stage);
        current.ready = null;
        automaticClick = true;
        try { next.button.click(); } finally { automaticClick = false; }
        if (next.stage === 'password') stop('비밀번호 단계를 제출했습니다. 추가 인증과 로그인 결과를 직접 확인하세요.');
        else if (run === current) notice('이메일 단계를 제출했습니다. 암호 관리자의 비밀번호 입력을 기다립니다.');
      }).catch(() => { if (run === current) stop('안전한 제출 기록을 사용할 수 없어 중지했습니다.'); })
        .finally(() => { current.busy = false; });
    } catch { stop('안전한 자동 진행 조건을 확인할 수 없어 중지했습니다.'); }
  }

  function start() {
    stop();
    if (!allowedRoute()) { notice('지원하는 User Login 화면에서만 실행할 수 있습니다.'); return; }
    try {
      if (GM_getValue('enabled', false) !== true) {
        notice('로컬 암호 관리자에서 자동완성을 설정한 뒤 매니저 메뉴의 자동 진행 켜기/끄기를 선택하세요.'); return;
      }
      if (!navigator.locks?.request) { notice('이 브라우저에서는 안전한 중복 제출 방지 기능을 사용할 수 없습니다.'); return; }
      if (recent(attempts().password)) { notice('최근 비밀번호 제출 기록이 있습니다. 필요하면 메뉴에서 다시 시도하세요.'); return; }
      const observer = new MutationObserver(inspect);
      run = { observer, sent: new Set(), ready: null, busy: false, deadline: Date.now() + LIFETIME };
      run.timer = setInterval(inspect, 500);
      run.expiry = setTimeout(() => stop('대기 시간이 끝났습니다. 준비 후 메뉴에서 다시 시도하세요.'), LIFETIME);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      notice('암호 관리자의 자동 입력을 기다립니다. 직접 입력하면 자동 진행을 중지합니다.');
      inspect();
    } catch { stop('설정을 읽을 수 없어 자동 진행을 중지했습니다.'); }
  }

  function menu(label, action) {
    GM_registerMenuCommand(`${NAME}: ${label}`, async () => {
      try { await action(); } catch { stop('설정을 읽거나 저장할 수 없어 자동 진행을 중지했습니다.'); }
    });
  }

  menu('자동 진행 켜기/끄기', () => {
    GM_setValue('enabled', GM_getValue('enabled', false) !== true);
    start();
  });
  menu('현재 페이지 중지', () => stop('현재 페이지의 자동 진행을 중지했습니다.'));
  menu('다시 시도', async () => {
    stop();
    if (!allowedRoute() || GM_getValue('enabled', false) !== true) { start(); return; }
    try {
      if (!navigator.locks?.request) { start(); return; }
      await navigator.locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) { notice('다른 탭에서 처리 중입니다. 잠시 후 다시 시도하세요.'); return; }
        localStorage.setItem(ATTEMPTS_KEY, '{}');
        start();
      });
    } catch { stop('제출 기록을 초기화할 수 없어 중지했습니다.'); }
  });
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
  }, true);
  document.addEventListener('click', event => {
    if (run && !automaticClick && event.target instanceof Element && event.target.closest(BUTTON)) {
      stop('직접 로그인을 진행 중이므로 자동 진행을 중지했습니다.');
    }
  }, true);
  document.addEventListener('submit', () => {
    if (run && !automaticClick) stop('직접 로그인을 진행 중이므로 자동 진행을 중지했습니다.');
  }, true);
  document.addEventListener('visibilitychange', inspect);
  window.addEventListener('focus', inspect);
  window.addEventListener('blur', () => { if (run) run.ready = null; });
  window.addEventListener('hashchange', inspect);
  window.addEventListener('popstate', inspect);
  window.addEventListener('pagehide', () => stop());
  start();
})();
