// ==UserScript==
// @name         Confluence Enhancer
// @namespace    https://github.com/channprj/userscripts
// @version      2
// @author       CHANN <chann@chann.dev>
// @description  Hide Confluence Rovo, etc.
// @match        https://*.atlassian.net/wiki/*
// @match        https://*.atlassian.com/wiki/*
// @run-at       document-end
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  /**
   * 설정값
   * - hideProactiveNudge: hover로 뜨는 Rovo 안내(프로액티브 넛지)만 숨김
   * - hideRovoButton: 우측 액션바의 "Rovo Button" 자체도 숨기고 싶으면 true
   */
  const CONFIG = {
    hideProactiveNudge: false,
    hideRovoButton: true,
  };

  const SELECTORS = [];
  if (CONFIG.hideProactiveNudge) {
    // 질문에 첨부된 DOM의 핵심 요소
    SELECTORS.push('[data-testid="platform-ai-proactive-nudge"]');
  }
  if (CONFIG.hideRovoButton) {
    // 질문에 첨부된 Rovo 버튼
    SELECTORS.push('button[data-testid="object-sidebar-container"], [data-testid="object-sidebar-container"]');
  }

  // GM_addStyle이 없을 때도 동작하도록 fallback 포함
  const addStyle = (cssText) => {
    try {
      if (typeof GM_addStyle === 'function') {
        GM_addStyle(cssText);
        return;
      }
    } catch (_) {}
    const style = document.createElement('style');
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  };

  // CSS로 1차 차단(깜빡임 최소화)
  addStyle(`
    /* Rovo proactive nudge (hover bubble) */
    [data-testid="platform-ai-proactive-nudge"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    [data-testid="platform-ai-proactive-nudge"] * {
      pointer-events: none !important;
    }

    /* Optional: hide the Rovo button itself */
    ${CONFIG.hideRovoButton ? `
    button[data-testid="platform-ai-button"],
    [data-testid="platform-ai-button"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }` : ``}
  `);

  const hideEl = (el) => {
    if (!el || !(el instanceof HTMLElement)) return;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  };

  const sweep = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    for (const sel of SELECTORS) {
      scope.querySelectorAll(sel).forEach(hideEl);
    }
  };

  // 초기 적용
  sweep(document);

  // 동적 렌더링 대응: 다시 생기면 즉시 숨김
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // 추가된 노드 자체가 타겟이면 숨김
        for (const sel of SELECTORS) {
          if (node.matches?.(sel)) hideEl(node);
        }
        // 추가된 subtree도 스캔
        sweep(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 로드 후에도 몇 번 더 보수적으로 스윕(포털/지연 렌더링 케이스)
  window.addEventListener('load', () => {
    sweep(document);
    setTimeout(() => sweep(document), 1000);
    setTimeout(() => sweep(document), 3000);
    setTimeout(() => sweep(document), 7000);
  }, { once: true });
})();

