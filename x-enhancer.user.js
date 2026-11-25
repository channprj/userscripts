// ==UserScript==
// @name         X Enhancer
// @namespace    https://github.com/channprj/userscripts
// @version      0.3
// @icon         https://user-images.githubusercontent.com/1831308/99884645-3101e100-2c73-11eb-9258-958dee09457e.png
// @description  X(formerly Twitter): copy a post's full text with one click or the C key, Esc to go back, Korean line breaks.
// @author       CHANN <chann@chann.dev>
// @match        https://x.com/*
// @downloadURL  https://raw.githubusercontent.com/channprj/userscripts/main/x-enhancer.user.js
// @updateURL    https://raw.githubusercontent.com/channprj/userscripts/main/x-enhancer.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const COPY_ATTR = 'data-x-enhancer-copy';
  const RESET_MS = 1500;
  const ICONS = {
    copy: 'M8 3h10a3 3 0 0 1 3 3v10h-2V6a1 1 0 0 0-1-1H8V3zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h10V9H5z',
    done: 'M9.64 18.95l-5.55-4.86 1.32-1.5 3.95 3.46 8.46-10.95 1.58 1.22L9.64 18.95z',
    fail: 'M13.41 12l5.8-5.79-1.42-1.42L12 10.59 6.21 4.79 4.79 6.21 10.59 12l-5.8 5.79 1.42 1.42L12 13.41l5.79 5.8 1.42-1.42L13.41 12z',
  };
  const LABELS = { copy: '전문 복사 (C) · Shift: 출처 포함', done: '복사됨', fail: '복사 실패' };
  const POST = 'article[data-testid="tweet"]';
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
    .x-enhancer-copy-wrap {
      display: flex;
      align-items: center;
    }
    .x-enhancer-copy {
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
    .x-enhancer-copy:hover,
    .x-enhancer-copy:focus-visible {
      background: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
      outline: none;
    }
    .x-enhancer-copy[data-state=done] { color: rgb(0, 186, 124); }
    .x-enhancer-copy[data-state=fail] { color: rgb(244, 33, 46); }
    .x-enhancer-copy svg {
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
    button.dataset.state = state;
    button.setAttribute('aria-label', LABELS[state]);
    button.title = LABELS[state];
    button.querySelector('path').setAttribute('d', ICONS[state]);
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

  const copyPost = async (button, withSource = false) => {
    const article = button.closest('article');
    const shown = article ? domText(article) : '';
    const data = article && tweetData(article);
    let text = data ? postText(data, shown) : shown;
    const source = text && withSource ? sourceLine(article, data) : '';
    if (source) text += `\n\n— ${source}`;
    clearTimeout(button.resetTimer);
    try {
      if (!text) throw new Error('no text');
      await writeClipboard(text);
      setState(button, 'done');
    } catch (_) {
      setState(button, 'fail');
    }
    button.resetTimer = setTimeout(() => setState(button, 'copy'), RESET_MS);
  };

  const addCopyButton = (article) => {
    const bar = article.querySelector('[data-testid="reply"]')?.closest('[role="group"]');
    if (!bar || bar.querySelector(`[${COPY_ATTR}]`)) return;
    const wrap = document.createElement('div');
    wrap.className = 'x-enhancer-copy-wrap';
    wrap.innerHTML = `<button type="button" class="x-enhancer-copy" ${COPY_ATTR}><svg viewBox="0 0 24 24" aria-hidden="true"><path></path></svg></button>`;
    const button = wrap.firstElementChild;
    setState(button, 'copy');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyPost(button, event.shiftKey);
    });
    bar.appendChild(wrap);
  };

  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll(POST).forEach(addCopyButton);
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
      const button = currentPost()?.querySelector(`[${COPY_ATTR}]`);
      if (!button) return;
      event.preventDefault();
      copyPost(button, event.shiftKey);
    }
  }, true);
})();
