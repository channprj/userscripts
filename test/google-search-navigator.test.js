const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(
  __dirname,
  "..",
  "google-search-navigator.user.js"
);

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...tokens) {
    for (const token of tokens) this.values.add(token);
    this.element.className = Array.from(this.values).join(" ");
  }

  remove(...tokens) {
    for (const token of tokens) this.values.delete(token);
    this.element.className = Array.from(this.values).join(" ");
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = { cssText: "" };
    this.classList = new FakeClassList(this);
    this.className = "";
    this.textContent = options.textContent ?? "";
    this.offsetHeight = options.offsetHeight ?? 100;
    this.rect = options.rect ?? {
      left: 0,
      top: 0,
      width: 100,
      height: this.offsetHeight,
    };
    this.clickCount = 0;
    this.scrollIntoViewCount = 0;

    for (const className of options.classes || []) {
      this.classList.add(className);
    }

    for (const [name, value] of Object.entries(options.attrs || {})) {
      this.setAttribute(name, value);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    for (const grandchild of child.children) {
      grandchild.ownerDocument = this.ownerDocument;
    }
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this
    );
    this.parentElement = null;
  }

  get childElementCount() {
    return this.children.length;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "href") this.href = String(value);
    if (name === "class") {
      for (const className of String(value).split(/\s+/).filter(Boolean)) {
        this.classList.add(className);
      }
    }
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  click() {
    this.clickCount += 1;
  }

  scrollIntoView() {
    this.scrollIntoViewCount += 1;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  getElementsByTagName(tagName) {
    const expectedTag = tagName.toUpperCase();
    return this._descendants().filter((node) => node.tagName === expectedTag);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this._descendants().filter((node) => matchesAny(node, selector));
  }

  matches(selector) {
    return matchesAny(this, selector);
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (matchesAny(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  _descendants() {
    const nodes = [];
    const visit = (node) => {
      for (const child of node.children) {
        nodes.push(child);
        visit(child);
      }
    };
    visit(this);
    return nodes;
  }
}

class FakeDocument {
  constructor(url) {
    this.location = new URL(url);
    this.readyState = "complete";
    this.eventListeners = {};
    this.body = new FakeElement("body", { offsetHeight: 1000 });
    this.body.ownerDocument = this;
    this.activeElement = this.body;
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  append(...elements) {
    for (const element of elements) {
      element.ownerDocument = this;
      this.body.appendChild(element);
    }
  }

  addEventListener(type, handler) {
    this.eventListeners[type] ||= [];
    this.eventListeners[type].push(handler);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const nodes = [this.body, ...this.body._descendants()];
    return nodes.filter((node) => matchesAny(node, selector));
  }
}

function matchesAny(element, selector) {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => matchesSelector(element, part));
}

function matchesSelector(element, selector) {
  if (selector.includes(" ")) {
    const parts = selector.split(/\s+/).filter(Boolean);
    const lastPart = parts.pop();
    if (!matchesSelector(element, lastPart)) return false;
    return parts.every((part) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (matchesSelector(ancestor, part)) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    });
  }

  const tagMatch = selector.match(/^[a-z][a-z0-9-]*/i);
  if (tagMatch && element.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) {
    return false;
  }

  for (const className of selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!element.classList.contains(className[1])) return false;
  }

  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch && element.getAttribute("id") !== idMatch[1]) {
    return false;
  }

  for (const attrMatch of selector.matchAll(
    /\[([^\]=~^*$\s]+)([*^$]?=)?(?:"([^"]*)"|'([^']*)'|([^\]]*))?\]/g
  )) {
    const [, name, operator, doubleQuoted, singleQuoted, rawValue] = attrMatch;
    const actualValue = element.getAttribute(name);
    const expectedValue = doubleQuoted ?? singleQuoted ?? rawValue ?? "";

    if (operator === undefined) {
      if (actualValue === null) return false;
      continue;
    }

    if (actualValue === null) return false;
    if (operator === "=" && actualValue !== expectedValue) return false;
    if (operator === "^=" && !actualValue.startsWith(expectedValue)) {
      return false;
    }
    if (operator === "*=" && !actualValue.includes(expectedValue)) {
      return false;
    }
    if (operator === "$=" && !actualValue.endsWith(expectedValue)) {
      return false;
    }
  }

  return true;
}

function createImageCard({ destination, previewHref, rect }) {
  const card = new FakeElement("div", {
    attrs: { "data-lpage": destination },
    classes: ["isv-r"],
    rect,
  });
  const anchor = new FakeElement("a", {
    attrs: { href: previewHref },
  });
  const image = new FakeElement("img", {
    attrs: { src: "https://example.test/thumb.jpg" },
  });
  anchor.appendChild(image);
  card.appendChild(anchor);
  return { card, anchor };
}

function createSearchTab(label, href = `/search?tbm=${label.toLowerCase()}`) {
  return new FakeElement("a", {
    attrs: { href, role: "link" },
    textContent: label,
  });
}

function loadNavigator({ url, bodyChildren }) {
  const document = new FakeDocument(url);
  document.append(...bodyChildren);

  const windowListeners = {};
  const openedUrls = [];
  const window = {
    document,
    location: document.location,
    addEventListener(type, handler) {
      windowListeners[type] ||= [];
      windowListeners[type].push(handler);
    },
    open(urlToOpen, target) {
      openedUrls.push({ url: urlToOpen, target });
    },
  };

  const context = {
    console: { log() {}, error() {} },
    document,
    window,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Node: { ELEMENT_NODE: 1 },
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context);

  const dispatchKeydown = (code, options = {}) => {
    const event = {
      code,
      metaKey: Boolean(options.metaKey),
      ctrlKey: Boolean(options.ctrlKey),
      shiftKey: Boolean(options.shiftKey),
      key: options.key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const handler of windowListeners.keydown || []) handler(event);
    return event;
  };

  return { document, dispatchKeydown, openedUrls };
}

test("Google Images navigation highlights and focuses image cards with arrows and hjkl", () => {
  const first = createImageCard({
    destination: "https://site.example/first",
    rect: { left: 0, top: 0, width: 100, height: 100 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ffirst.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ffirst",
  });
  const second = createImageCard({
    destination: "https://site.example/second",
    rect: { left: 120, top: 0, width: 100, height: 100 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Fsecond.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Fsecond",
  });
  const { document, dispatchKeydown } = loadNavigator({
    url: "https://www.google.com/search?q=cat&udm=2",
    bodyChildren: [first.card, second.card],
  });

  assert.equal(document.activeElement, first.card);
  assert.equal(first.card.getAttribute("data-gsn-selected"), "true");

  dispatchKeydown("ArrowRight");

  assert.equal(document.activeElement, second.card);
  assert.equal(first.card.getAttribute("data-gsn-selected"), null);
  assert.equal(second.card.getAttribute("data-gsn-selected"), "true");

  dispatchKeydown("KeyH");

  assert.equal(document.activeElement, first.card);
  assert.equal(first.card.getAttribute("data-gsn-selected"), "true");
  assert.equal(second.card.getAttribute("data-gsn-selected"), null);

  dispatchKeydown("KeyL");

  assert.equal(document.activeElement, second.card);
});

test("Google Images directional navigation follows visual masonry neighbors", () => {
  const topLeft = createImageCard({
    destination: "https://site.example/top-left",
    rect: { left: 0, top: 0, width: 100, height: 120 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ftop-left.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ftop-left",
  });
  const topMiddle = createImageCard({
    destination: "https://site.example/top-middle",
    rect: { left: 120, top: 0, width: 100, height: 90 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ftop-middle.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ftop-middle",
  });
  const topRight = createImageCard({
    destination: "https://site.example/top-right",
    rect: { left: 240, top: 0, width: 100, height: 150 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ftop-right.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ftop-right",
  });
  const lowerLeft = createImageCard({
    destination: "https://site.example/lower-left",
    rect: { left: 0, top: 140, width: 100, height: 100 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Flower-left.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Flower-left",
  });
  const lowerMiddle = createImageCard({
    destination: "https://site.example/lower-middle",
    rect: { left: 120, top: 110, width: 100, height: 100 },
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Flower-middle.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Flower-middle",
  });
  const { document, dispatchKeydown } = loadNavigator({
    url: "https://www.google.com/search?q=cat&udm=2",
    bodyChildren: [
      topLeft.card,
      topMiddle.card,
      topRight.card,
      lowerLeft.card,
      lowerMiddle.card,
    ],
  });

  dispatchKeydown("ArrowDown");

  assert.equal(document.activeElement, lowerLeft.card);

  dispatchKeydown("ArrowRight");

  assert.equal(document.activeElement, lowerMiddle.card);

  dispatchKeydown("KeyK");

  assert.equal(document.activeElement, topMiddle.card);

  dispatchKeydown("KeyL");

  assert.equal(document.activeElement, topRight.card);

  dispatchKeydown("KeyH");

  assert.equal(document.activeElement, topMiddle.card);
});

test("Google Images Enter previews first, then navigates to the selected image result", () => {
  const first = createImageCard({
    destination: "https://site.example/first",
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ffirst.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ffirst",
  });
  const { document, dispatchKeydown } = loadNavigator({
    url: "https://www.google.com/search?q=cat&tbm=isch",
    bodyChildren: [first.card],
  });

  dispatchKeydown("Enter");

  assert.equal(first.anchor.clickCount, 1);
  assert.equal(document.location.href, "https://www.google.com/search?q=cat&tbm=isch");

  dispatchKeydown("Enter");

  assert.equal(document.location.href, "https://site.example/first");
});

test("Google Images Cmd/Ctrl+Enter opens the selected image result in a new tab", () => {
  const first = createImageCard({
    destination: "https://site.example/first",
    previewHref:
      "/imgres?imgurl=https%3A%2F%2Fimg.example%2Ffirst.jpg&imgrefurl=https%3A%2F%2Fsite.example%2Ffirst",
  });
  const { dispatchKeydown, openedUrls } = loadNavigator({
    url: "https://www.google.com/search?q=cat&udm=2",
    bodyChildren: [first.card],
  });

  dispatchKeydown("Enter", { metaKey: true });

  assert.deepEqual(openedUrls, [
    { url: "https://site.example/first", target: "_blank" },
  ]);
  assert.equal(first.anchor.clickCount, 0);
});

test("Google search tab shortcuts open tabs with g plus mnemonic or number", () => {
  const tabs = {
    aiMode: createSearchTab("AI Mode"),
    all: createSearchTab("All"),
    videos: createSearchTab("Videos"),
    images: createSearchTab("Images"),
    shortVideos: createSearchTab("Short videos"),
    news: createSearchTab("News"),
    shopping: createSearchTab("Shopping"),
    finance: createSearchTab("Finance"),
  };
  const { dispatchKeydown } = loadNavigator({
    url: "https://www.google.com/search?q=cat",
    bodyChildren: Object.values(tabs),
  });
  const shortcuts = [
    [tabs.aiMode, "KeyM", "Digit1"],
    [tabs.all, "KeyA", "Digit2"],
    [tabs.videos, "KeyV", "Digit3"],
    [tabs.images, "KeyI", "Digit4"],
    [tabs.shortVideos, "KeyS", "Digit5"],
    [tabs.news, "KeyN", "Digit6"],
    [tabs.shopping, "KeyB", "Digit7"],
    [tabs.finance, "KeyF", "Digit8"],
  ];

  for (const [tab, mnemonicCode, digitCode] of shortcuts) {
    dispatchKeydown("KeyG");
    dispatchKeydown(mnemonicCode);

    dispatchKeydown("KeyG");
    dispatchKeydown(digitCode);

    assert.equal(tab.clickCount, 2);
  }
});

test("question mark opens a shortcuts modal that Escape closes", () => {
  const { document, dispatchKeydown } = loadNavigator({
    url: "https://www.google.com/search?q=cat",
    bodyChildren: [],
  });

  const event = dispatchKeydown("Slash", { shiftKey: true, key: "?" });
  const modal = document.querySelector('[role="dialog"]');

  assert.equal(event.defaultPrevented, true);
  assert.ok(modal);
  assert.equal(modal.getAttribute("aria-label"), "Google Search Navigator shortcuts");
  assert.match(modal.textContent, /g i \/ g 4\s+Images/);
  assert.match(modal.textContent, /g s \/ g 5\s+Short videos/);
  assert.match(modal.textContent, /\?\s+Show shortcuts/);

  dispatchKeydown("Escape");

  assert.equal(document.querySelector('[role="dialog"]'), null);
});
