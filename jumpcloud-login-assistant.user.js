// ==UserScript==
// @name         JumpCloud Login Assistant
// @namespace    https://chann.dev
// @version      0.2.0
// @description  Store encrypted JumpCloud credentials in Tampermonkey and log in after unlocking.
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
  let vaultSession = null;
  let vaultUI = null;
  let filledPassword = null;
  const ITERATIONS = 600_000;
  const VAULT_AAD = 'chann.jumpcloud-login-assistant.vault.v1';

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

  function stop(text, submitted = false) {
    if (run) {
      clearInterval(run.timer);
      clearTimeout(run.expiry);
      run.observer.disconnect();
      run = null;
    }
    closeVaultUI();
    if (vaultSession) { vaultSession.email = ''; vaultSession.password = ''; vaultSession = null; }
    const filled = filledPassword;
    filledPassword = null;
    // Once submitted, JumpCloud may still be awaiting validation. It owns the form.
    if (!submitted && filled?.field.isConnected && filled.field.value === filled.password) setField(filled.field, '');
    if (text) notice(text);
  }

  function closeVaultUI() {
    const ui = vaultUI;
    vaultUI = null;
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
    return data && typeof data.email === 'string' && data.email.length <= 254
      && /^[^\s@]+@[^\s@]+$/.test(data.email) && typeof data.password === 'string'
      && data.password.length > 0 && data.password.length <= 1024
      && Object.keys(data).length === 2;
  }

  function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function fromBase64(text, min, max) {
    if (typeof text !== 'string' || text.length > Math.ceil(max / 3) * 4) throw new Error();
    const raw = atob(text);
    if (raw.length < min || raw.length > max || btoa(raw) !== text) throw new Error();
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function deriveVaultKey(passphrase, salt) {
    const bytes = new TextEncoder().encode(passphrase);
    try {
      const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
      return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally { bytes.fill(0); }
  }

  async function sealVault(data, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    try {
      const key = await deriveVaultKey(passphrase, salt);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: new TextEncoder().encode(VAULT_AAD), tagLength: 128 }, key, plaintext);
      return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
        salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
    } finally { plaintext.fill(0); }
  }

  async function openVault(record, passphrase) {
    if (!record || Object.keys(record).length !== 6 || record.v !== 1
      || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== ITERATIONS) throw new Error();
    const salt = fromBase64(record.salt, 16, 16);
    const iv = fromBase64(record.iv, 12, 12);
    const ciphertext = fromBase64(record.ciphertext, 17, 8192);
    const key = await deriveVaultKey(passphrase, salt);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(VAULT_AAD), tagLength: 128 }, key, ciphertext));
    try {
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
      if (!validateLogin(data)) throw new Error();
      return data;
    } finally { plaintext.fill(0); }
  }

  function showVault(mode) {
    stop();
    if (!allowedRoute() || !crypto.subtle) { notice('지원하는 로그인 페이지와 Web Crypto가 필요합니다.'); return; }
    const record = GM_getValue('vault', null);
    if (mode === 'unlock' && !record) { notice('먼저 메뉴에서 로그인 정보를 설정하세요.'); return; }
    const host = document.createElement('div');
    // Closed shadow DOM avoids incidental page form handlers; it is not a security boundary.
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      dialog{width:min(440px,85vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid #888;border-radius:10px;background:Canvas;color:CanvasText;font:14px/1.6 system-ui}
      dialog::backdrop{background:#0006}h2{font-size:20px;margin:0 0 12px}label{display:block;margin:12px 0}input{display:block;width:100%;box-sizing:border-box;padding:8px}button{margin:8px 8px 0 0;padding:6px 12px} [role=alert]{color:#c22}
    </style><dialog aria-label="JumpCloud 로그인 정보"><form autocomplete="off">
      <h2>${mode === 'setup' ? '로그인 정보 암호화 저장' : '잠금 해제 후 로그인'}</h2>
      <p>${mode === 'setup' ? 'ID/PW를 Tampermonkey에 암호화해 저장합니다. 저장된 정보가 있으면 교체합니다.' : '잠금 암호를 입력하면 이 페이지에서 저장한 계정으로 로그인합니다.'}</p>
      ${mode === 'setup' ? `<label>JumpCloud 이메일<input name="email" type="email" required maxlength="254" autocomplete="off"></label>
      <label>JumpCloud 비밀번호<input name="password" type="password" required maxlength="1024" autocomplete="new-password"></label>` : ''}
      <label>잠금 암호<input name="passphrase" type="password" required minlength="12" maxlength="1024" autocomplete="off"></label>
      ${mode === 'setup' ? '<label>잠금 암호 확인<input name="confirmation" type="password" required maxlength="1024" autocomplete="off"></label><p>JumpCloud 비밀번호와 다른 12자 이상의 긴 암호를 사용하세요. 잠금 암호는 저장하지 않으며 잊으면 정보를 다시 등록해야 합니다. Tampermonkey 동기화·내보내기 설정은 별도로 적용됩니다.</p>' : ''}
      <p role="alert"></p><button type="submit">${mode === 'setup' ? '암호화 저장' : '잠금 해제 후 로그인'}</button><button type="button">취소</button>
    </form></dialog>`;
    const ui = { host, root };
    vaultUI = ui;
    const dialog = root.querySelector('dialog');
    const form = root.querySelector('form');
    const button = root.querySelector('button[type="submit"]');
    const error = root.querySelector('[role="alert"]');
    root.querySelector('button[type="button"]').addEventListener('click', closeVaultUI);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeVaultUI(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); event.stopPropagation();
      if (button.disabled || vaultUI !== ui) return;
      let data = null;
      let passphrase = form.elements.namedItem('passphrase').value;
      if (passphrase.length < 12 || passphrase.length > 1024) { error.textContent = '잠금 암호는 12자 이상이어야 합니다.'; return; }
      if (mode === 'setup') {
        data = { email: form.elements.namedItem('email').value.trim(), password: form.elements.namedItem('password').value };
        if (!validateLogin(data) || passphrase !== form.elements.namedItem('confirmation').value || passphrase === data.password) {
          error.textContent = '이메일과 비밀번호를 확인하고, 별도의 잠금 암호를 두 번 동일하게 입력하세요.'; return;
        }
      }
      button.disabled = true;
      error.textContent = '';
      for (const input of root.querySelectorAll('input')) input.value = '';
      try {
        if (mode === 'setup') {
          const encrypted = await sealVault(data, passphrase);
          if (vaultUI !== ui || !allowedRoute() || document.visibilityState !== 'visible') return;
          GM_setValue('vault', encrypted);
          closeVaultUI();
          notice('암호화 저장했습니다. 메뉴에서 잠금 해제 후 로그인을 선택하세요.');
        } else {
          // Read again at submit time: the vault may have changed in another settings dialog.
          const saved = GM_getValue('vault', null);
          data = await openVault(saved, passphrase);
          if (vaultUI !== ui || !allowedRoute() || document.visibilityState !== 'visible'
            || JSON.stringify(saved) !== JSON.stringify(GM_getValue('vault', null))) return;
          closeVaultUI();
          GM_setValue('enabled', true);
          start(data);
          data = null; // Ownership transferred to the bounded login execution.
        }
      } catch {
        if (vaultUI === ui) error.textContent = mode === 'setup' ? '저장하지 못했습니다. 정보를 다시 입력하세요.' : '잠금 암호가 다르거나 저장 정보가 손상되었습니다.';
      } finally {
        passphrase = '';
        if (data) { data.email = ''; data.password = ''; }
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
    return fields.length === 1 && normalizedEmail(fields[0].value) === normalizedEmail(vaultSession.email);
  }

  function fillVault(current) {
    if (!vaultSession) return;
    const next = candidate(false);
    if (!next || current.sent.has(next.stage)) return;
    if ((next.stage === 'password' && !accountMatches(next))
      || (next.field.value && next.field.value !== vaultSession[next.stage])) {
      stop('입력된 계정 또는 비밀번호가 저장 정보와 다릅니다. 내용을 직접 확인하세요.'); return;
    }
    if (!next.field.value) {
      current.filling = true;
      try {
        if (next.stage === 'password') filledPassword = { field: next.field, password: vaultSession.password };
        setField(next.field, vaultSession[next.stage]);
      } finally { current.filling = false; }
      current.ready = null;
    }
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
      fillVault(current);
      if (run !== current) return;
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
        if (vaultSession && (!accountMatches(next) || next.field.value !== vaultSession[next.stage])) {
          stop('로그인 대상이 바뀌어 중지했습니다. 내용을 직접 확인하세요.'); return;
        }
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
        if (next.stage === 'password') stop('비밀번호 단계를 제출했습니다. 추가 인증과 로그인 결과를 직접 확인하세요.', true);
        else if (run === current) notice('이메일 단계를 제출했습니다. 비밀번호 단계를 기다립니다.');
      }).catch(() => { if (run === current) stop('안전한 제출 기록을 사용할 수 없어 중지했습니다.'); })
        .finally(() => { current.busy = false; });
    } catch { stop('안전한 자동 진행 조건을 확인할 수 없어 중지했습니다.'); }
  }

  function start(data = null) {
    stop();
    vaultSession = data;
    if (!allowedRoute()) { stop('지원하는 User Login 화면에서만 실행할 수 있습니다.'); return; }
    try {
      if (GM_getValue('enabled', false) !== true) {
        stop('메뉴에서 로그인 정보를 설정하고 잠금 해제 후 로그인을 선택하세요. 외부 자동완성은 자동 진행 켜기/끄기로 사용할 수 있습니다.'); return;
      }
      if (GM_getValue('vault', null) !== null && !vaultSession) { stop('저장 정보가 잠겨 있습니다. 메뉴에서 잠금 해제 후 로그인을 선택하세요.'); return; }
      if (!navigator.locks?.request) { stop('이 브라우저에서는 안전한 중복 제출 방지 기능을 사용할 수 없습니다.'); return; }
      if (recent(attempts().password)) { stop('최근 비밀번호 제출 기록이 있습니다. 필요하면 메뉴에서 다시 시도한 뒤 잠금을 해제하세요.'); return; }
      const observer = new MutationObserver(inspect);
      run = { observer, sent: new Set(), ready: null, busy: false, deadline: Date.now() + LIFETIME };
      run.timer = setInterval(inspect, 500);
      run.expiry = setTimeout(() => stop('대기 시간이 끝났습니다. 준비 후 메뉴에서 다시 시도하세요.'), LIFETIME);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      notice(vaultSession ? '저장한 계정으로 로그인합니다. 직접 입력하면 잠급니다.' : '암호 관리자의 자동 입력을 기다립니다. 직접 입력하면 자동 진행을 중지합니다.');
      inspect();
    } catch { stop('설정을 읽을 수 없어 자동 진행을 중지했습니다.'); }
  }

  function menu(label, action) {
    GM_registerMenuCommand(`${NAME}: ${label}`, async () => {
      try { await action(); } catch { stop('설정을 읽거나 저장할 수 없어 자동 진행을 중지했습니다.'); }
    });
  }

  menu('로그인 정보 설정', () => showVault('setup'));
  menu('잠금 해제 후 로그인', () => showVault('unlock'));
  menu('저장 정보 삭제', () => {
    stop();
    if (!confirm('암호화해 저장한 로그인 정보를 삭제할까요? 다시 사용하려면 등록해야 합니다.')) return;
    GM_setValue('enabled', false);
    GM_deleteValue('vault');
    notice('저장 정보를 삭제하고 자동 진행을 껐습니다.');
  });
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
    if (document.visibilityState !== 'visible' && (vaultSession || vaultUI)) stop('페이지가 숨겨져 저장 정보를 잠갔습니다.');
    else inspect();
  });
  window.addEventListener('focus', inspect);
  window.addEventListener('blur', () => { if (run) run.ready = null; });
  const routeChanged = () => {
    if (vaultUI && !allowedRoute()) stop('로그인 경로가 바뀌어 중지했습니다.');
    else inspect();
  };
  window.addEventListener('hashchange', routeChanged);
  window.addEventListener('popstate', routeChanged);
  window.addEventListener('pagehide', () => stop());
  start();
})();
