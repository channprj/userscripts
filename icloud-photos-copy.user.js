// ==UserScript==
// @name         iCloud Photos Copy Shortcut
// @namespace    https://github.com/channprj/userscripts
// @version      0.1
// @author       CHANN <chann@chann.dev>
// @description  iCloud Photos 상세 화면에서 Cmd/Ctrl+C 로 현재 사진을 클립보드에 복사합니다.
// @match        https://www.icloud.com/photos/*
// @match        https://www.icloud.com/applications/photos3/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // 상세 화면에서 보이는 대형 이미지의 최소 표시 크기(px)
  const MIN_DISPLAY_SIZE = 400;

  const isEditingTarget = (el) => {
    if (!el) return false;
    const tag = el.tagName && el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  };

  const hasTextSelection = () => {
    const sel = window.getSelection && window.getSelection();
    return !!(sel && sel.toString().length > 0);
  };

  // 뷰포트 안의 큰 이미지 중 중심에 가장 가까운 것 = 현재 상세에 표시되는 사진
  // iCloud Photos 는 placeholder(저해상도)와 풀해상도 <img>를 같은 위치에 겹쳐서 렌더링하므로
  // 자연 해상도가 표시 크기보다 작은 placeholder 는 제외한다.
  const findDetailImage = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;

    const candidates = [];
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete || !img.naturalWidth) continue;
      const r = img.getBoundingClientRect();
      if (r.width < MIN_DISPLAY_SIZE || r.height < MIN_DISPLAY_SIZE) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;

      candidates.push({ img, rect: r });
    }
    if (!candidates.length) return null;

    // 가능하면 풀해상도(자연 너비 ≥ 표시 너비)만 사용
    const fullRes = candidates.filter(
      (c) => c.img.naturalWidth >= c.rect.width
    );
    const pool = fullRes.length ? fullRes : candidates;

    let best = null;
    let bestDist = Infinity;
    for (const { img, rect } of pool) {
      const ix = rect.left + rect.width / 2;
      const iy = rect.top + rect.height / 2;
      const dist = Math.hypot(ix - cx, iy - cy);
      if (dist < bestDist) {
        best = img;
        bestDist = dist;
      }
    }
    return best;
  };

  const copyImageToClipboard = async (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('canvas.toBlob() returned null');

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
  };

  const onKeyDown = (e) => {
    const isCopy =
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      !e.altKey &&
      (e.key === 'c' || e.key === 'C' || e.code === 'KeyC');
    if (!isCopy) return;

    if (isEditingTarget(e.target)) return;
    if (hasTextSelection()) return;

    const img = findDetailImage();
    if (!img) return;

    e.preventDefault();
    e.stopPropagation();

    copyImageToClipboard(img).catch((err) => {
      console.warn('[iCloud Photos Copy] failed:', err);
    });
  };

  // 캡처 단계에서 가로채 iCloud 기본 핸들러보다 먼저 처리
  document.addEventListener('keydown', onKeyDown, true);
})();
