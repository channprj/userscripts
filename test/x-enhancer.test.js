const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'x-enhancer.user.js'), 'utf8');

// Sanitized fixture of X's post markup: the action bar and the React fiber
// whose props carry the post's API object.
function setup(t, posts, { url = 'https://x.com/home', extra = '' } = {}) {
  const articles = posts.map(({ shown }) => `<article data-testid="tweet">
      <div data-testid="tweetText" lang="en"><span>${shown}</span></div>
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
    window.document.querySelectorAll('[data-x-enhancer-copy]').forEach(button => window.clearTimeout(button.resetTimer));
    window.requestAnimationFrame = () => 0;
    window.close();
  });
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  window.document.querySelectorAll('article').forEach((article, index) => {
    const host = { memoizedProps: { testID: 'tweet' } };
    host.return = { memoizedProps: { other: true }, return: { memoizedProps: { tweet: posts[index].tweet }, return: null } };
    article['__reactFiber$fixture'] = host;
  });
  window.eval(source);
  const click = async index => {
    const button = window.document.querySelectorAll('[data-x-enhancer-copy]')[index];
    button.click();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    return button;
  };
  const press = async (code, key, init = {}) => {
    const target = window.document.activeElement || window.document.body;
    target.dispatchEvent(new window.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...init }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
  };
  return { window, copied, click, press };
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
  second.querySelector('[data-x-enhancer-copy]').parentElement.remove();
  document.body.appendChild(second);
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  await new Promise(resolve => h.window.requestAnimationFrame(resolve));
  assert.equal(document.querySelectorAll('[data-x-enhancer-copy]').length, 2);
  for (const bar of document.querySelectorAll('[role=group]')) assert.equal(bar.querySelectorAll('[data-x-enhancer-copy]').length, 1);
  // The clone has no React fiber, so its copy falls back to the visible text.
  await h.click(1);
  assert.deepEqual(h.copied, ['one']);
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
