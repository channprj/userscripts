const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'x-enhancer.user.js'), 'utf8');

// Sanitized fixture of X's post markup: the action bar and the React fiber
// whose props carry the post's API object.
function setup(t, posts, { url = 'https://x.com/home', extra = '' } = {}) {
  const articles = posts.map(({ shown, html = '' }) => `<article data-testid="tweet" tabindex="0">
      <div data-testid="tweetText" lang="en"><span>${shown}</span></div>${html}
      <div role="group"><div><button data-testid="reply"></button></div><div><button data-testid="like"></button></div></div>
    </article>`);
  const dom = new JSDOM(`<!doctype html><head></head><body>${extra}${articles.join('')}</body>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  // jsdom has no layout; treat everything outside [hidden] as on screen.
  window.Element.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
  t.after(() => {
    // Stop the pending icon reset. close() empties the document, which wakes the
    // script's observer, and jsdom throws on a frame requested after close.
    window.document.querySelectorAll('[data-x-enhancer]').forEach(button => window.clearTimeout(button.resetTimer));
    window.requestAnimationFrame = () => 0;
    window.close();
  });
  const copied = [];
  const images = [];
  const fetched = [];
  const saved = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async text => { copied.push(text); }, write: async items => { images.push(await items[0].data['image/png']); } },
  });
  window.ClipboardItem = class { constructor(data) { this.data = data; } };
  // The network and the browser's download boundary.
  window.fetch = async url => {
    fetched.push(url);
    return { ok: true, blob: async () => new window.Blob([url], { type: url.includes('format=png') ? 'image/png' : 'application/octet-stream' }) };
  };
  window.URL.createObjectURL = () => `blob:fixture/${saved.length}`;
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
  window.document.querySelectorAll('article').forEach((article, index) => {
    const host = { memoizedProps: { testID: 'tweet' } };
    host.return = { memoizedProps: { other: true }, return: { memoizedProps: { tweet: posts[index].tweet }, return: null } };
    article['__reactFiber$fixture'] = host;
  });
  window.eval(source);
  const click = async index => {
    const button = window.document.querySelectorAll('[data-x-enhancer="copy"]')[index];
    button.click();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    return button;
  };
  const press = async (code, key, init = {}) => {
    const target = window.document.activeElement || window.document.body;
    target.dispatchEvent(new window.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...init }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
  };
  // Wait for a button's task to finish.
  const settle = async button => {
    while (button.dataset.state === 'busy') await new Promise(resolve => window.setTimeout(resolve, 0));
  };
  return { window, copied, images, fetched, saved, click, press, settle };
}

const post = (id, text, user = { name: 'Sample User', screen_name: 'sample' }) =>
  ({ shown: text, tweet: { id_str: id, full_text: text, display_text_range: [0, text.length], user } });

test('copies the full long post, not the truncated text shown', async t => {
  const full = 'First line.\n\nSecond paragraph that X hides behind Show more & keeps going.';
  const h = setup(t, [{
    shown: 'First line.',
    tweet: { full_text: 'First line. https://t.co/m', display_text_range: [0, 11], note_tweet: { text: full, entity_set: { urls: [] } } },
  }]);
  const button = await h.click(0);
  assert.deepEqual(h.copied, [full]);
  assert.equal(button.dataset.state, 'done');
});

test('expands links, drops reply mentions and the media link, decodes entities', async t => {
  const full_text = '@someone Tips &amp; docs: https://t.co/abc https://t.co/pic';
  const h = setup(t, [{
    shown: 'Tips &amp; docs: example.com/do…',
    tweet: {
      full_text,
      display_text_range: [9, 42],
      entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/docs' }], media: [{ url: 'https://t.co/pic' }] },
    },
  }]);
  await h.click(0);
  assert.deepEqual(h.copied, ['Tips & docs: https://example.com/docs']);
});

test('copies the translation when X shows it, the original otherwise', async t => {
  const tweet = { full_text: 'Hola mundo, esto es largo', display_text_range: [0, 25], grok_translated_post: { translation: '안녕 세상, 이건 긴 글이야' } };
  const h = setup(t, [{ shown: '안녕 세상', tweet }, { shown: 'Hola mundo', tweet }]);
  await h.click(0);
  await h.click(1);
  assert.deepEqual(h.copied, ['안녕 세상, 이건 긴 글이야', 'Hola mundo, esto es largo']);
});

test('adds one button per post, including posts rendered later', async t => {
  const h = setup(t, [{ shown: 'one', tweet: { full_text: 'one', display_text_range: [0, 3] } }]);
  const { document } = h.window;
  const second = document.querySelector('article').cloneNode(true);
  second.querySelector('[data-x-enhancer="copy"]').parentElement.remove();
  document.body.appendChild(second);
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelectorAll('[data-x-enhancer="copy"]').length, 2);
  for (const bar of document.querySelectorAll('[role=group]')) assert.equal(bar.querySelectorAll('[data-x-enhancer="copy"]').length, 1);
  // The clone has no React fiber, so its copy falls back to the visible text.
  await h.click(1);
  assert.deepEqual(h.copied, ['one']);
});

test('C copies the post picked with j/k, also with the Korean IME on; Shift+C adds the source', async t => {
  const h = setup(t, [post('1', 'first'), post('2', 'second')]);
  h.window.document.querySelectorAll('article')[1].focus();
  await h.press('KeyC', 'c');
  await h.press('KeyC', 'ㅊ');
  await h.press('KeyC', 'C', { shiftKey: true });
  assert.deepEqual(h.copied, ['second', 'second', 'second\n\n— Sample User (@sample) https://x.com/sample/status/2']);
  assert.equal(h.window.document.querySelectorAll('[data-x-enhancer="copy"]')[1].dataset.state, 'done');
});

test('Shift-click on the button adds the source too', async t => {
  const h = setup(t, [post('7', 'hello')]);
  h.window.document.querySelector('[data-x-enhancer="copy"]').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(resolve => h.window.setTimeout(resolve, 0));
  assert.deepEqual(h.copied, ['hello\n\n— Sample User (@sample) https://x.com/sample/status/7']);
});

test('C on a post page copies that post when nothing is focused', async t => {
  const h = setup(t, [post('1', 'parent'), post('2', 'focal'), post('3', 'reply')], { url: 'https://x.com/sample/status/2' });
  await h.press('KeyC', 'c');
  assert.deepEqual(h.copied, ['focal']);
});

test('C is left alone while typing, composing, in a menu, or after g', async t => {
  const h = setup(t, [post('1', 'first')], { extra: '<textarea></textarea><div role="menu" hidden></div>' });
  const { document } = h.window;
  document.querySelector('article').focus();
  await h.press('KeyC', 'c', { isComposing: true });
  await h.press('KeyG', 'g');
  await h.press('KeyC', 'c');
  document.querySelector('[role=menu]').hidden = false;
  await h.press('KeyC', 'c');
  document.querySelector('[role=menu]').hidden = true;
  document.querySelector('textarea').focus();
  await h.press('KeyC', 'c');
  assert.deepEqual(h.copied, []);
});

test('Esc goes back only when no layer is open, and leaves text fields first', async t => {
  const h = setup(t, [post('1', 'first')], {
    url: 'https://x.com/sample/status/1',
    extra: '<button data-testid="app-bar-back" hidden></button><button data-testid="app-bar-back"></button><input><div role="dialog" hidden></div>',
  });
  const { document } = h.window;
  let backs = 0;
  document.querySelectorAll('[data-testid=app-bar-back]')[1].addEventListener('click', () => backs++);
  document.querySelectorAll('[data-testid=app-bar-back]')[0].addEventListener('click', () => { throw new Error('hidden back button clicked'); });
  const dialog = document.querySelector('[role=dialog]');
  dialog.hidden = false;
  await h.press('Escape', 'Escape');
  assert.equal(backs, 0, 'X closes the dialog itself');
  dialog.hidden = true;
  const input = document.querySelector('input');
  input.focus();
  await h.press('Escape', 'Escape');
  assert.equal(backs, 0);
  assert.notEqual(document.activeElement, input);
  await h.press('Escape', 'Escape');
  assert.equal(backs, 1);
});

const user = { name: 'Sample User', screen_name: 'sample' };
const photo = key => ({ type: 'photo', media_url_https: `https://pbs.twimg.com/media/${key}` });
const video = (id, type = 'video') => ({
  type,
  media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/thumb.jpg`,
  video_info: { variants: [
    { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/${id}/pl.m3u8` },
    { content_type: 'video/mp4', bitrate: 832000, url: `https://video.twimg.com/${id}/low.mp4` },
    { content_type: 'video/mp4', bitrate: 2176000, url: `https://video.twimg.com/${id}/high.mp4` },
  ] },
});
const mediaPost = (html = '') => ({
  shown: 'media post',
  html,
  tweet: {
    id_str: '10', full_text: 'media post', display_text_range: [0, 10], user,
    extended_entities: { media: [photo('AAA.jpg'), photo('BBB.png'), video('30'), video('40', 'animated_gif')] },
    quoted_status: { id_str: '20', user: { screen_name: 'quoted' }, extended_entities: { media: [photo('QQQ.jpg')] } },
  },
});

test('the post bar saves every photo and video of the post in original quality', async t => {
  const h = setup(t, [mediaPost(), post('11', 'no media')]);
  const { document } = h.window;
  assert.equal(document.querySelectorAll('[data-x-enhancer="all"]').length, 1, 'only posts with media get the button');
  const all = document.querySelector('[data-x-enhancer="all"]');
  all.click();
  await h.settle(all);
  assert.deepEqual(h.fetched, [
    'https://pbs.twimg.com/media/AAA?format=jpg&name=orig',
    'https://pbs.twimg.com/media/BBB?format=png&name=orig',
    'https://video.twimg.com/30/high.mp4',
    'https://video.twimg.com/40/high.mp4',
  ]);
  assert.deepEqual(h.saved, ['sample_10_1.jpg', 'sample_10_2.png', 'sample_10_3.mp4', 'sample_10_4.mp4']);
  assert.equal(all.dataset.state, 'done');
});

test('each photo or video saves its own original, without opening the media link', async t => {
  const h = setup(t, [mediaPost(`
    <a href="/sample/status/10/photo/2"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/BBB?format=jpg&name=small"></div></a>
    <div data-testid="tweetPhoto"><div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/ext_tw_video_thumb/30/pu/img/thumb.jpg" src="blob:https://x.com/v"></video></div></div>
    <div role="link"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/QQQ?format=jpg&name=small"></div></div>`)]);
  const { document } = h.window;
  let opened = 0;
  document.querySelector('a[href*="/photo/"]').addEventListener('click', () => opened++);
  const toolbars = [...document.querySelectorAll('[data-testid=tweetPhoto] > .x-enhancer-media')];
  const shown = () => toolbars.map(bar => [...bar.children].filter(b => !b.hidden).map(b => b.getAttribute('data-x-enhancer')));
  assert.deepEqual(shown(), [['save', 'image'], ['save'], ['save', 'image']]);
  for (const bar of toolbars) {
    const save = bar.querySelector('[data-x-enhancer="save"]');
    save.click();
    await h.settle(save);
  }
  assert.deepEqual(h.fetched, [
    'https://pbs.twimg.com/media/BBB?format=png&name=orig',
    'https://video.twimg.com/30/high.mp4',
    'https://pbs.twimg.com/media/QQQ?format=jpg&name=orig',
  ]);
  assert.deepEqual(h.saved, ['sample_10_2.png', 'sample_10_3.mp4', 'quoted_20_1.jpg']);
  assert.equal(opened, 0);
});

test('a photo copies its original to the clipboard as PNG', async t => {
  const h = setup(t, [mediaPost('<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/BBB?format=jpg&name=small"></div>')]);
  const image = h.window.document.querySelector('[data-x-enhancer="image"]');
  image.click();
  await h.settle(image);
  assert.equal(image.dataset.state, 'done');
  assert.equal(h.images.length, 1);
  assert.equal(h.images[0].type, 'image/png');
  assert.equal(await h.images[0].text(), 'https://pbs.twimg.com/media/BBB?format=png&name=orig');
});

test('a viewer photo without post data still saves its original', async t => {
  const h = setup(t, [], { extra: '<div data-testid="swipe-to-dismiss"><img src="https://pbs.twimg.com/media/ZZZ?format=webp&name=large"></div>' });
  const save = h.window.document.querySelector('[data-testid=swipe-to-dismiss] [data-x-enhancer="save"]');
  save.click();
  await h.settle(save);
  assert.deepEqual(h.fetched, ['https://pbs.twimg.com/media/ZZZ?format=webp&name=orig']);
  assert.deepEqual(h.saved, ['ZZZ.webp']);
});

test('a video player mounted after its thumbnail hides the photo copy button', async t => {
  const h = setup(t, [mediaPost('<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/ext_tw_video_thumb/30/pu/img/thumb.jpg"></div>')]);
  const { document } = h.window;
  const image = document.querySelector('[data-x-enhancer="image"]');
  assert.equal(image.hidden, false);
  document.querySelector('[data-testid=tweetPhoto]').insertAdjacentHTML('afterbegin', '<div data-testid="videoPlayer"><video></video></div>');
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  assert.equal(image.hidden, true);
});
