// ==UserScript==
// @name         X Enhancer
// @namespace    https://github.com/channprj/userscripts
// @version      0.4
// @icon         https://user-images.githubusercontent.com/1831308/99884645-3101e100-2c73-11eb-9258-958dee09457e.png
// @description  X(formerly Twitter): copy a post's full text, save photos and videos in original quality, copy photos, Esc to go back, Korean line breaks.
// @author       CHANN <chann@chann.dev>
// @match        https://x.com/*
// @downloadURL  https://raw.githubusercontent.com/channprj/userscripts/main/x-enhancer.user.js
// @updateURL    https://raw.githubusercontent.com/channprj/userscripts/main/x-enhancer.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const KIND_ATTR = 'data-x-enhancer';
  const RESET_MS = 1500;
  const ICONS = {
    copy: 'M8 3h10a3 3 0 0 1 3 3v10h-2V6a1 1 0 0 0-1-1H8V3zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h10V9H5z',
    download: 'M13 3v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3h2zM5 19h14v2H5v-2z',
    downloadAll: 'M13 2v8.17l3.59-3.58L18 8l-6 6-6-6 1.41-1.41L11 10.17V2h2zM4 16h16v2H4v-2zm0 4h16v2H4v-2z',
    done: 'M9.64 18.95l-5.55-4.86 1.32-1.5 3.95 3.46 8.46-10.95 1.58 1.22L9.64 18.95z',
    fail: 'M13.41 12l5.8-5.79-1.42-1.42L12 10.59 6.21 4.79 4.79 6.21 10.59 12l-5.8 5.79 1.42 1.42L12 13.41l5.79 5.8 1.42-1.42L13.41 12z',
  };
  const BUTTONS = {
    copy: { icon: 'copy', label: '전문 복사 (C) · Shift: 출처 포함', done: '복사됨', fail: '복사 실패' },
    all: { icon: 'downloadAll', label: '사진·동영상 전체 원본 다운로드', done: '다운로드함', fail: '다운로드 실패' },
    save: { icon: 'download', label: '원본 다운로드', done: '다운로드함', fail: '다운로드 실패' },
    image: { icon: 'copy', label: '원본 사진 복사', done: '복사됨', fail: '복사 실패' },
  };
  const POST = 'article[data-testid="tweet"]';
  // A photo or video in a post, and a slide of the full-screen photo viewer.
  const MEDIA = '[data-testid="tweetPhoto"], [data-testid="swipe-to-dismiss"]';
  // Layers X closes itself on Esc: menus, dialogs, the photo viewer, search suggestions.
  const OPEN_LAYER = '[role="menu"], [role="dialog"], [aria-modal="true"], [role="listbox"]';
  // X's own two-key shortcuts start with g (g c opens Creator Studio).
  const SEQUENCE_MS = 1500;

  const style = document.createElement('style');
  style.textContent = `
    div[lang=ko] {
      word-break: keep-all;
      word-wrap: break-word;
    }
    .x-enhancer-wrap {
      display: flex;
      align-items: center;
    }
    .x-enhancer-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: rgb(113, 118, 123);
      cursor: pointer;
      transition: background-color 0.2s, color 0.2s;
    }
    .x-enhancer-btn:hover,
    .x-enhancer-btn:focus-visible {
      background: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
      outline: none;
    }
    /* Top left: X puts the carousel counter top right and ALT, GIF and
       duration badges bottom left. */
    .x-enhancer-media {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 3;
      display: flex;
      gap: 6px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    /* The viewer's close button sits top left; its bottom right is empty. */
    [data-testid=swipe-to-dismiss] > .x-enhancer-media {
      top: auto;
      left: auto;
      right: 16px;
      bottom: 16px;
    }
    :is([data-testid=tweetPhoto], [data-testid=swipe-to-dismiss]):hover > .x-enhancer-media,
    .x-enhancer-media:focus-within {
      opacity: 1;
    }
    .x-enhancer-media .x-enhancer-btn {
      width: 32px;
      height: 32px;
      background: rgba(15, 20, 25, 0.75);
      color: rgb(255, 255, 255);
    }
    .x-enhancer-media .x-enhancer-btn:hover,
    .x-enhancer-media .x-enhancer-btn:focus-visible {
      background: rgba(15, 20, 25, 0.9);
      color: rgb(29, 155, 240);
    }
    .x-enhancer-btn[hidden] { display: none; }
    .x-enhancer-btn[data-state=busy] { opacity: 0.6; cursor: progress; }
    .x-enhancer-btn[data-state=done] { color: rgb(0, 186, 124); }
    .x-enhancer-btn[data-state=fail] { color: rgb(244, 33, 46); }
    .x-enhancer-btn svg {
      width: 1.25em;
      height: 1.25em;
      fill: currentColor;
    }
  `;
  document.head.appendChild(style);

  // X keeps the post's API object, full long-post text included, in React props.
  // The DOM only holds the truncated text behind "Show more".
  const tweetData = (article) => {
    const key = Object.keys(article).find((k) => k.startsWith('__reactFiber$'));
    for (let fiber = key && article[key], depth = 0; fiber && depth < 50; fiber = fiber.return, depth++) {
      const tweet = fiber.memoizedProps?.tweet;
      if (tweet && typeof tweet === 'object' && ('full_text' in tweet || 'note_tweet' in tweet)) return tweet;
    }
    return null;
  };

  const decodeEntities = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  const expandUrls = (text, urls) =>
    (urls || []).reduce((acc, u) => (u?.url && u.expanded_url ? acc.split(u.url).join(u.expanded_url) : acc), text);

  const squash = (text) => text.replace(/\s+/g, ' ').trim();

  const postText = (data, shown) => {
    const tweet = data.retweeted_status || data;
    // X may show a Grok translation in place of the original; copy what is shown.
    const translation = (tweet.grok_translated_post || data.grok_translated_post)?.translation;
    const head = squash(shown).slice(0, 40);
    if (translation && head && squash(translation).startsWith(head)) {
      return expandUrls(translation, tweet.note_tweet?.entity_set?.urls || tweet.entities?.urls).trim();
    }
    const note = tweet.note_tweet;
    if (note?.text) return expandUrls(note.text, note.entity_set?.urls).trim();
    // display_text_range drops leading reply mentions and the trailing media link;
    // its indices count code points of the entity-encoded text.
    const [start, end] = tweet.display_text_range || [0, Infinity];
    let text = Array.from(tweet.full_text ?? tweet.text ?? '').slice(start, end).join('');
    text = expandUrls(text, tweet.entities?.urls);
    for (const media of tweet.extended_entities?.media || tweet.entities?.media || []) {
      if (media.url) text = text.split(media.url).join('');
    }
    return decodeEntities(text).trim();
  };

  // The visible, possibly truncated text; the fallback when React props are unavailable.
  const domText = (article) => {
    const root = article.querySelector('[data-testid="tweetText"]');
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'IMG') return node.alt || '';
      if (node.tagName === 'BR') return '\n';
      const text = Array.from(node.childNodes, walk).join('');
      return node.tagName === 'A' ? text.replace(/…$/, '') : text;
    };
    return root ? walk(root).trim() : '';
  };

  const writeClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {}
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy failed');
  };

  const setState = (button, state) => {
    const spec = BUTTONS[button.getAttribute(KIND_ATTR)];
    const label = state === 'idle' ? spec.label : state === 'busy' ? '처리 중…' : spec[state];
    button.dataset.state = state;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.querySelector('path').setAttribute('d', ICONS[state === 'done' || state === 'fail' ? state : spec.icon]);
  };

  // The task starts synchronously, so clipboard calls stay inside the click's
  // user activation.
  const run = async (button, task) => {
    if (button.dataset.state === 'busy') return;
    clearTimeout(button.resetTimer);
    setState(button, 'busy');
    try {
      await task();
      setState(button, 'done');
    } catch (error) {
      console.warn('[X Enhancer]', error);
      setState(button, 'fail');
    }
    button.resetTimer = setTimeout(() => setState(button, 'idle'), RESET_MS);
  };

  const makeButton = (kind, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-enhancer-btn';
    button.setAttribute(KIND_ATTR, kind);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path></path></svg>';
    setState(button, 'idle');
    // Media sit inside links and video players; keep the press away from them.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      button.addEventListener(type, (event) => event.stopPropagation());
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    return button;
  };

  const permalink = (article, data) => {
    const tweet = data && (data.retweeted_status || data);
    if (tweet?.user?.screen_name && tweet.id_str) return `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
    return article.querySelector('a[href*="/status/"] time')?.closest('a')?.href || '';
  };

  const sourceLine = (article, data) => {
    const user = (data?.retweeted_status || data)?.user;
    const author = user?.screen_name ? `${user.name} (@${user.screen_name})` : '';
    return [author, permalink(article, data)].filter(Boolean).join(' ');
  };

  const copyPost = (button, withSource = false) => run(button, async () => {
    const article = button.closest('article');
    const shown = article ? domText(article) : '';
    const data = article && tweetData(article);
    let text = data ? postText(data, shown) : shown;
    const source = text && withSource ? sourceLine(article, data) : '';
    if (source) text += `\n\n— ${source}`;
    if (!text) throw new Error('no text');
    await writeClipboard(text);
  });

  const baseUrl = (url) => url.split('?')[0].replace(/\.\w+$/, '');

  // name=orig serves the photo at its uploaded size and format.
  const photoOriginal = (url) => {
    const parsed = new URL(url);
    const ext = parsed.searchParams.get('format') || parsed.pathname.match(/\.(\w+)$/)?.[1] || 'jpg';
    return { url: `${parsed.origin}${baseUrl(parsed.pathname)}?format=${ext}&name=orig`, ext };
  };

  const mediaItem = (media, owner, index) => {
    const name = `${owner.user?.screen_name || 'x'}_${owner.id_str}_${index + 1}`;
    if (media.type === 'photo') {
      const { url, ext } = photoOriginal(media.media_url_https);
      return { kind: 'photo', url, filename: `${name}.${ext}` };
    }
    // Videos and GIFs: the highest-bitrate MP4, not the HLS playlist.
    const best = (media.video_info?.variants || [])
      .filter((variant) => variant.content_type === 'video/mp4')
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    return best ? { kind: 'video', url: best.url, filename: `${name}.mp4` } : null;
  };

  const postMedia = (data) => {
    const owner = data && (data.retweeted_status || data);
    return (owner?.extended_entities?.media || []).map((media, index) => mediaItem(media, owner, index)).filter(Boolean);
  };

  // Matches a photo or video on the page to its post data by the thumbnail URL.
  // Videos play from blob: URLs, so their files come only from the data.
  const elementMedia = (el) => {
    const video = el.querySelector('video');
    const src = video?.poster || el.querySelector('img[src*="pbs.twimg.com"]')?.src;
    if (!src) return null;
    const key = baseUrl(src);
    for (const article of [el.closest(POST), ...document.querySelectorAll(POST)]) {
      const data = article && tweetData(article);
      const top = data && (data.retweeted_status || data);
      for (const owner of [top, top?.quoted_status]) {
        const list = owner?.extended_entities?.media || [];
        const index = list.findIndex((media) => baseUrl(media.media_url_https || '') === key);
        if (index >= 0) return mediaItem(list[index], owner, index);
      }
    }
    if (video || !src.includes('/media/')) return null;
    const { url, ext } = photoOriginal(src);
    return { kind: 'photo', url, filename: `${key.split('/').pop()}.${ext}` };
  };

  const fetchBlob = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.blob();
  };

  // Cross-origin links ignore the download attribute, so save a blob: URL.
  const saveItem = async (item) => {
    const href = URL.createObjectURL(await fetchBlob(item.url));
    const link = document.createElement('a');
    link.href = href;
    link.download = item.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };

  const toPng = async (blob) => {
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG encoding failed'))), 'image/png');
    });
  };

  // Browsers put images on the clipboard only as PNG. ClipboardItem takes the
  // pending blob, so the write itself starts inside the click.
  const copyImage = (url) => navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchBlob(url).then(toPng) })]);

  const addPostButtons = (article) => {
    const bar = article.querySelector('[data-testid="reply"]')?.closest('[role="group"]');
    if (!bar) return;
    const append = (button) => {
      const wrap = document.createElement('div');
      wrap.className = 'x-enhancer-wrap';
      wrap.appendChild(button);
      bar.appendChild(wrap);
    };
    if (!bar.querySelector(`[${KIND_ATTR}="copy"]`)) {
      const copy = makeButton('copy', (event) => copyPost(copy, event.shiftKey));
      append(copy);
    }
    if (!bar.querySelector(`[${KIND_ATTR}="all"]`) && postMedia(tweetData(article)).length) {
      const all = makeButton('all', () => run(all, async () => {
        const items = postMedia(tweetData(all.closest(POST)));
        if (!items.length) throw new Error('no media');
        for (const item of items) await saveItem(item);
      }));
      append(all);
    }
  };

  const addMediaButtons = (el) => {
    let toolbar = el.querySelector(':scope > .x-enhancer-media');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'x-enhancer-media';
      const save = makeButton('save', () => run(save, async () => {
        const item = elementMedia(el);
        if (!item) throw new Error('media not found');
        await saveItem(item);
      }));
      const image = makeButton('image', () => run(image, async () => {
        const item = elementMedia(el);
        if (item?.kind !== 'photo') throw new Error('photo not found');
        await copyImage(item.url);
      }));
      toolbar.append(save, image);
      el.appendChild(toolbar);
    }
    // X mounts the video player after its thumbnail, so check on every scan.
    toolbar.querySelector(`[${KIND_ATTR}="image"]`).hidden = !!el.querySelector('[data-testid="videoPlayer"], video');
  };

  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll(POST).forEach(addPostButtons);
    document.querySelectorAll(MEDIA).forEach(addMediaButtons);
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const isShown = (el) => el.getClientRects().length > 0;
  const hasOpenLayer = () => Array.from(document.querySelectorAll(OPEN_LAYER)).some(isShown);

  // The post picked with j/k, or the post a /status/ page is about.
  const currentPost = () => {
    const focused = document.activeElement?.closest?.(POST);
    if (focused) return focused;
    const id = location.pathname.match(/\/status\/(\d+)/)?.[1];
    return id ? Array.from(document.querySelectorAll(POST)).find((article) => tweetData(article)?.id_str === id) : null;
  };

  let lastG = -Infinity;
  // Capture phase: decide before X's handlers run, so an Esc that closes a
  // layer, or a C that finishes X's g-sequence, is left to X alone.
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const sinceG = event.timeStamp - lastG;
    if (event.code === 'KeyG') lastG = event.timeStamp;
    const active = document.activeElement;

    if (event.key === 'Escape') {
      if (event.shiftKey || hasOpenLayer()) return;
      if (isEditable(active)) {
        active.blur();
        return;
      }
      Array.from(document.querySelectorAll('[data-testid="app-bar-back"]')).find(isShown)?.click();
      return;
    }

    // event.code keeps C working while the Korean IME is on (it would type ㅊ).
    if (event.code === 'KeyC' && sinceG > SEQUENCE_MS && !isEditable(active) && !hasOpenLayer()) {
      const button = currentPost()?.querySelector(`[${KIND_ATTR}="copy"]`);
      if (!button) return;
      event.preventDefault();
      copyPost(button, event.shiftKey);
    }
  }, true);
})();
