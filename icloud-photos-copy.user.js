// ==UserScript==
// @name         iCloud Photos Copy Shortcut
// @namespace    https://github.com/channprj/userscripts
// @version      0.2
// @author       CHANN <chann@chann.dev>
// @description  iCloud Photos 상세 화면 또는 그리드에서 선택된 사진을 Cmd/Ctrl+C 로 클립보드에 복사합니다.
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

  // 그리드 뷰에서 선택된 PhotoItemView 를 찾는다.
  // iCloud 내부 view 객체(itemState.isSelected) 를 사용 — 앱 업데이트로 바뀔 수 있음.
  const findSelectedGridItem = () => {
    for (const el of document.querySelectorAll('.PhotoItemView')) {
      const v = el.view;
      if (v && v.itemState && v.itemState.isSelected) return el;
    }
    return null;
  };

  const loadCrossOriginImage = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed: ' + url));
      img.src = url;
    });

  // PhotoItemView 의 _master.fields 에서 medium JPEG 의 downloadURL 을 얻는다.
  // medium JPEG 는 iCloud detail 화면에서 표시되는 동일한 해상도이며 (예: 1536x2048)
  // 원본 HEIC 는 브라우저 디코딩이 안 되므로 medium 을 사용한다.
  const getMediumJpegUrl = (photoItemView) => {
    const v = photoItemView.view;
    const m = v && v._master && v._master.fields;
    if (!m) return null;
    const med = m.resJPEGMedRes;
    if (!med || !med.downloadURL) return null;
    const filename = m.filenameEnc_decoded || 'photo.jpg';
    return med.downloadURL.replace('${f}', encodeURIComponent(filename));
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

  // 그리드 모드에서 클립보드 쓰기는 비동기 fetch+decode 가 필요해 user activation 이 만료될 수 있다.
  // ClipboardItem 생성자에 Promise<Blob> 을 직접 넘기면 user activation 이 promise 동안 유지된다.
  const copyGridSelection = async (photoItemView) => {
    const url = getMediumJpegUrl(photoItemView);
    if (!url) throw new Error('medium JPEG URL not available');

    const pngBlobPromise = (async () => {
      const img = await loadCrossOriginImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('canvas.toBlob() returned null'));
        }, 'image/png');
      });
    })();

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlobPromise }),
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

    // 1) 상세 화면 우선
    const detailImg = findDetailImage();
    if (detailImg) {
      e.preventDefault();
      e.stopPropagation();
      copyImageToClipboard(detailImg).catch((err) => {
        console.warn('[iCloud Photos Copy] detail copy failed:', err);
      });
      return;
    }

    // 2) 그리드 뷰에서 선택된 사진
    const grid = findSelectedGridItem();
    if (grid) {
      e.preventDefault();
      e.stopPropagation();
      copyGridSelection(grid).catch((err) => {
        console.warn('[iCloud Photos Copy] grid copy failed:', err);
      });
      return;
    }
  };

  // 캡처 단계에서 가로채 iCloud 기본 핸들러보다 먼저 처리
  document.addEventListener('keydown', onKeyDown, true);
})();
