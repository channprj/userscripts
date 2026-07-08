// ==UserScript==
// @name         Google Search Navigator
// @description  Navigate google search with custom shortcuts
// @namespace    https://github.com/channprj/google-search-navigator
// @icon         https://user-images.githubusercontent.com/1831308/60544915-c043e700-9d54-11e9-9eb0-5c80c85d3a28.png
// @version      0.15
// @author       channprj
// @run-at       document-end
// @include      http*://*.google.tld/search*
// @include      http*://*.google.*/search*
// ==/UserScript==

(function () {
  "use strict";

  // Configuration
  const CONFIG = {
    styles: {
      selectedLink:
        "padding-left:8px; margin-left:-12px; border-left:4px solid red;",
      normal: "",
    },
    selectors: {
      resultElements: ".MjjYud",
      nestedResultElements: ".A6K0A",
      imageResultElements: ".isv-r, [data-lpage]",
      imagePreviewLink: "a[href*='/imgres'], a[href*='imgurl='], a",
      searchInput: "div textarea",
      contentWrapper: "#rcnt",
      nextButton: "#pnnext",
      prevButton: "#pnprev",
    },
    scrollBehavior: {
      behavior: "smooth",
      block: "center",
    },
    searchTabs: [
      { label: "AI Mode", mnemonic: "m", digit: "1" },
      { label: "All", mnemonic: "a", digit: "2" },
      { label: "Videos", mnemonic: "v", digit: "3" },
      { label: "Images", mnemonic: "i", digit: "4" },
      { label: "Short videos", mnemonic: "s", digit: "5" },
      { label: "News", mnemonic: "n", digit: "6" },
      { label: "Shopping", mnemonic: "b", digit: "7" },
      { label: "Finance", mnemonic: "f", digit: "8" },
    ],
  };

  function hasSearchParam(name, expectedValue) {
    const search =
      (window.location && window.location.search) ||
      (document.location && document.location.search) ||
      "";
    return search
      .replace(/^\?/, "")
      .split("&")
      .filter(Boolean)
      .some((pair) => {
        const [rawName, rawValue = ""] = pair.split("=");
        return (
          decodeURIComponent(rawName.replace(/\+/g, " ")) === name &&
          decodeURIComponent(rawValue.replace(/\+/g, " ")) === expectedValue
        );
      });
  }

  function isImageSearchPage() {
    return hasSearchParam("tbm", "isch") || hasSearchParam("udm", "2");
  }

  const StyleInstaller = {
    init() {
      let style = document.querySelector("#google-search-navigator-style");
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("id", "google-search-navigator-style");
        (document.head || document.body).appendChild(style);
      }

      style.textContent = `
        [data-gsn-image-selected="true"] {
          outline: 3px solid #d93025 !important;
          outline-offset: 2px !important;
          border-radius: 4px !important;
        }

        [data-gsn-shortcuts-modal="true"] {
          --gsn-modal-bg: #fff;
          --gsn-modal-fg: #202124;
          --gsn-modal-muted: #5f6368;
          --gsn-modal-border: #dadce0;
          --gsn-modal-shadow: rgba(60, 64, 67, .3);
          --gsn-kbd-bg: #f8fafd;
          --gsn-kbd-fg: #202124;
          --gsn-kbd-border: #c7cdd7;
          --gsn-kbd-shadow: rgba(60, 64, 67, .16);
          position: fixed;
          inset: 24px;
          z-index: 2147483647;
          box-sizing: border-box;
          max-width: 640px;
          max-height: calc(100vh - 48px);
          margin: auto;
          padding: 22px;
          overflow: auto;
          color: var(--gsn-modal-fg);
          background: var(--gsn-modal-bg);
          border: 1px solid var(--gsn-modal-border);
          border-radius: 8px;
          box-shadow: 0 16px 48px var(--gsn-modal-shadow);
          color-scheme: light dark;
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        @media (prefers-color-scheme: dark) {
          [data-gsn-shortcuts-modal="true"] {
            --gsn-modal-bg: #202124;
            --gsn-modal-fg: #e8eaed;
            --gsn-modal-muted: #bdc1c6;
            --gsn-modal-border: #3c4043;
            --gsn-modal-shadow: rgba(0, 0, 0, .46);
            --gsn-kbd-bg: #303134;
            --gsn-kbd-fg: #f1f3f4;
            --gsn-kbd-border: #5f6368;
            --gsn-kbd-shadow: rgba(0, 0, 0, .35);
          }
        }

        [data-gsn-shortcuts-title="true"] {
          margin: 0 0 16px;
          color: var(--gsn-modal-fg);
          font-size: 18px;
          font-weight: 650;
          line-height: 1.25;
        }

        [data-gsn-shortcuts-section="true"] + [data-gsn-shortcuts-section="true"] {
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid var(--gsn-modal-border);
        }

        [data-gsn-shortcuts-section-title="true"] {
          margin: 0 0 10px;
          color: var(--gsn-modal-muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        [data-gsn-shortcut-row="true"] {
          display: grid;
          grid-template-columns: minmax(132px, max-content) minmax(0, 1fr);
          gap: 14px;
          align-items: center;
          min-height: 30px;
        }

        [data-gsn-shortcut-row="true"] + [data-gsn-shortcut-row="true"] {
          margin-top: 7px;
        }

        [data-gsn-shortcut-keys="true"] {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 5px;
        }

        [data-gsn-shortcut-label="true"] {
          color: var(--gsn-modal-fg);
          min-width: 0;
        }

        [data-gsn-shortcut-separator="true"] {
          color: var(--gsn-modal-muted);
          font-size: 12px;
        }

        [data-gsn-shortcuts-modal="true"] kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 24px;
          min-height: 24px;
          box-sizing: border-box;
          padding: 2px 7px;
          color: var(--gsn-kbd-fg);
          background: var(--gsn-kbd-bg);
          border: 1px solid var(--gsn-kbd-border);
          border-radius: 5px;
          box-shadow: inset 0 -1px 0 var(--gsn-kbd-shadow);
          font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }

        @media (max-width: 520px) {
          [data-gsn-shortcuts-modal="true"] {
            inset: 12px;
            max-height: calc(100vh - 24px);
            padding: 18px;
          }

          [data-gsn-shortcut-row="true"] {
            grid-template-columns: 1fr;
            gap: 6px;
            align-items: start;
          }
        }
      `;
    },
  };

  // DOM Elements Cache
  class DOMCache {
    constructor() {
      this.refresh();
    }

    refresh() {
      this._isImageSearch = isImageSearchPage();

      if (this._isImageSearch) {
        this._resultElements = document.querySelectorAll(
          CONFIG.selectors.imageResultElements
        );
      } else {
        this._resultElements = document.querySelectorAll(
          CONFIG.selectors.resultElements
        );
        const nestedElements = document.querySelectorAll(
          CONFIG.selectors.nestedResultElements
        );

        // Use nested elements if available (for specialized search results)
        if (nestedElements.length > 0) {
          this._resultElements = nestedElements;
        }
      }

      this._searchInput = document.querySelector(CONFIG.selectors.searchInput);
      this._contentWrapper = document.querySelector(
        CONFIG.selectors.contentWrapper
      );
    }

    get resultElements() {
      return this._resultElements;
    }

    get searchInput() {
      return this._searchInput;
    }

    get contentWrapper() {
      return this._contentWrapper;
    }

    get isImageSearch() {
      return this._isImageSearch;
    }
  }

  const domCache = new DOMCache();

  // Utility Functions
  const Utils = {
    isTextElementFocused() {
      const el = document.activeElement;
      return (
        el &&
        ((el.tagName.toLowerCase() === "input" &&
          (el.type === "text" ||
            el.type === "search" ||
            el.type === "email" ||
            el.type === "password" ||
            el.type === "url")) ||
          el.tagName.toLowerCase() === "textarea" ||
          el.contentEditable === "true")
      );
    },

    moveCursorToEnd(element) {
      if (!element) return;

      element.focus();
      if (element.setSelectionRange) {
        const len = element.value.length * 2;
        element.setSelectionRange(len, len);
      } else {
        element.value = element.value;
      }
    },

    isValidResultNode(node) {
      return node && node.childElementCount > 0 && node.offsetHeight > 0;
    },

    getImagePreviewLink(element) {
      return (
        element.querySelector(CONFIG.selectors.imagePreviewLink) ||
        element.getElementsByTagName("a")[0]
      );
    },

    getImageDestination(element) {
      const dataDestination =
        element.getAttribute("data-lpage") ||
        (element.dataset && element.dataset.lpage);
      if (dataDestination) return dataDestination;

      const link = this.getImagePreviewLink(element);
      if (!link) return null;

      const href = link.href || link.getAttribute("href");
      if (!href) return null;

      try {
        const url = new URL(href, window.location.href);
        return url.searchParams.get("imgrefurl") || url.href;
      } catch (error) {
        return href;
      }
    },

    getRectCenter(rect) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },

    normalizeText(text) {
      return String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    },

    getShortcutKey(event) {
      if (event.key && event.key.length === 1) {
        return event.key.toLowerCase();
      }

      if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3).toLowerCase();
      }

      if (/^Digit[0-9]$/.test(event.code)) {
        return event.code.slice(5);
      }

      if (/^Numpad[0-9]$/.test(event.code)) {
        return event.code.slice(6);
      }

      return "";
    },

    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },
  };

  // Navigation Controller
  class NavigationController {
    constructor() {
      this.focusIndex = 0;
      this.previewedImageIndex = null;
      this.initialize();
    }

    initialize() {
      this.previewedImageIndex = null;
      this.focusIndex = this.initializeFirstResult();
    }

    findNextValidIndex(currentIndex) {
      const elements = domCache.resultElements;
      let nextIndex = currentIndex + 1;

      while (
        nextIndex < elements.length &&
        !Utils.isValidResultNode(elements[nextIndex])
      ) {
        nextIndex++;
      }

      return nextIndex < elements.length ? nextIndex : currentIndex;
    }

    findPrevValidIndex(currentIndex) {
      const elements = domCache.resultElements;
      let prevIndex = currentIndex - 1;

      while (prevIndex >= 0 && !Utils.isValidResultNode(elements[prevIndex])) {
        prevIndex--;
      }

      return prevIndex >= 0 ? prevIndex : currentIndex;
    }

    findDirectionalImageIndex(currentIndex, direction) {
      const elements = Array.from(domCache.resultElements);
      const currentElement = elements[currentIndex];
      if (!Utils.isValidResultNode(currentElement)) {
        return currentIndex;
      }

      const currentRect = currentElement.getBoundingClientRect();
      const currentCenter = Utils.getRectCenter(currentRect);
      let bestMatch = null;

      elements.forEach((element, index) => {
        if (index === currentIndex || !Utils.isValidResultNode(element)) {
          return;
        }

        const rect = element.getBoundingClientRect();
        const center = Utils.getRectCenter(rect);
        const dx = center.x - currentCenter.x;
        const dy = center.y - currentCenter.y;
        let primaryDistance;
        let crossAxisDistance;

        if (direction === "right") {
          if (dx <= 0) return;
          primaryDistance = dx;
          crossAxisDistance = Math.abs(dy);
        } else if (direction === "left") {
          if (dx >= 0) return;
          primaryDistance = Math.abs(dx);
          crossAxisDistance = Math.abs(dy);
        } else if (direction === "down") {
          if (dy <= 0) return;
          primaryDistance = dy;
          crossAxisDistance = Math.abs(dx);
        } else if (direction === "up") {
          if (dy >= 0) return;
          primaryDistance = Math.abs(dy);
          crossAxisDistance = Math.abs(dx);
        } else {
          return;
        }

        const score = crossAxisDistance * 2 + primaryDistance;
        const candidate = {
          index,
          score,
          primaryDistance,
          domDistance: Math.abs(index - currentIndex),
        };

        if (
          !bestMatch ||
          candidate.score < bestMatch.score ||
          (candidate.score === bestMatch.score &&
            candidate.primaryDistance < bestMatch.primaryDistance) ||
          (candidate.score === bestMatch.score &&
            candidate.primaryDistance === bestMatch.primaryDistance &&
            candidate.domDistance < bestMatch.domDistance)
        ) {
          bestMatch = candidate;
        }
      });

      return bestMatch ? bestMatch.index : currentIndex;
    }

    setHighlight(index) {
      const elements = domCache.resultElements;
      if (
        index >= 0 &&
        index < elements.length &&
        Utils.isValidResultNode(elements[index])
      ) {
        const element = elements[index];
        element.setAttribute("data-gsn-selected", "true");

        if (domCache.isImageSearch) {
          element.setAttribute("data-gsn-image-selected", "true");
          element.setAttribute("tabindex", "-1");
          element.focus();
        } else {
          element.style.cssText = CONFIG.styles.selectedLink;
        }

        element.scrollIntoView(CONFIG.scrollBehavior);
      }
    }

    clearHighlight(index) {
      const elements = domCache.resultElements;
      if (index >= 0 && index < elements.length) {
        const element = elements[index];
        element.removeAttribute("data-gsn-selected");
        element.removeAttribute("data-gsn-image-selected");

        if (!domCache.isImageSearch) {
          element.style.cssText = CONFIG.styles.normal;
        }
      }
    }

    openImageItem(index, openInNewTab = false) {
      const elements = domCache.resultElements;
      const element = elements[index];
      const destination = Utils.getImageDestination(element);

      if (openInNewTab) {
        if (destination) {
          window.open(destination, "_blank");
        }
        return;
      }

      if (this.previewedImageIndex === index && destination) {
        window.location.href = destination;
        return;
      }

      const previewLink = Utils.getImagePreviewLink(element);
      if (previewLink) {
        previewLink.click();
        this.previewedImageIndex = index;
        return;
      }

      if (destination) {
        window.location.href = destination;
      }
    }

    clickItem(index, openInNewTab = false) {
      const elements = domCache.resultElements;
      if (
        index >= 0 &&
        index < elements.length &&
        Utils.isValidResultNode(elements[index])
      ) {
        if (domCache.isImageSearch) {
          this.openImageItem(index, openInNewTab);
          return;
        }

        const selectedLink = elements[index].getElementsByTagName("a")[0];
        if (selectedLink) {
          if (openInNewTab) {
            // Open in new background tab
            window.open(selectedLink.href, "_blank");
          } else {
            selectedLink.click();
          }
        }
      }
    }

    initializeFirstResult() {
      const elements = domCache.resultElements;
      if (!elements || elements.length === 0) return 0;

      let firstValidIndex = 0;
      while (
        firstValidIndex < elements.length &&
        !Utils.isValidResultNode(elements[firstValidIndex])
      ) {
        firstValidIndex++;
      }

      if (firstValidIndex < elements.length) {
        this.setHighlight(firstValidIndex);
        return firstValidIndex;
      }

      return 0;
    }

    navigateNext() {
      this.clearHighlight(this.focusIndex);
      const nextIndex = this.findNextValidIndex(this.focusIndex);
      if (nextIndex !== this.focusIndex) {
        this.previewedImageIndex = null;
      }
      this.focusIndex = nextIndex;
      this.setHighlight(this.focusIndex);
    }

    navigatePrev() {
      this.clearHighlight(this.focusIndex);
      const prevIndex = this.findPrevValidIndex(this.focusIndex);
      if (prevIndex !== this.focusIndex) {
        this.previewedImageIndex = null;
      }
      this.focusIndex = prevIndex;
      this.setHighlight(this.focusIndex);
    }

    navigateImageDirection(direction) {
      this.clearHighlight(this.focusIndex);
      const nextIndex = this.findDirectionalImageIndex(
        this.focusIndex,
        direction
      );
      if (nextIndex !== this.focusIndex) {
        this.previewedImageIndex = null;
      }
      this.focusIndex = nextIndex;
      this.setHighlight(this.focusIndex);
    }

    openItem(openInNewTab = false) {
      this.clickItem(this.focusIndex, openInNewTab);
    }

    refresh() {
      domCache.refresh();
      this.initialize();
    }
  }

  // Pagination Handler
  const PaginationHandler = {
    handlePagination(direction) {
      if (Utils.isTextElementFocused()) {
        return;
      }

      const buttonId =
        direction === "next"
          ? CONFIG.selectors.nextButton
          : CONFIG.selectors.prevButton;
      const pageButton = document.querySelector(buttonId);

      if (pageButton) {
        pageButton.click();
      }
    },
  };

  // Search Input Handler
  const SearchInputHandler = {
    focusSearchInput() {
      const searchInput = domCache.searchInput;
      if (searchInput) {
        Utils.moveCursorToEnd(searchInput);
      }
    },

    blurSearchInput() {
      const searchInput = domCache.searchInput;
      if (searchInput) {
        searchInput.blur();
      }
    },
  };

  const SearchTabHandler = {
    pendingPrefix: false,

    getTabForKey(key) {
      return CONFIG.searchTabs.find(
        (tab) => tab.mnemonic === key || tab.digit === key
      );
    },

    getLinkText(link) {
      return Utils.normalizeText(
        link.textContent || link.getAttribute("aria-label")
      );
    },

    findTabLink(tab) {
      const expectedText = Utils.normalizeText(tab.label);
      return Array.from(document.querySelectorAll("a")).find(
        (link) => this.getLinkText(link) === expectedText
      );
    },

    openTab(tab) {
      const link = this.findTabLink(tab);
      if (!link) return false;

      link.click();
      return true;
    },

    startPrefix() {
      this.pendingPrefix = true;
    },

    cancelPrefix() {
      this.pendingPrefix = false;
    },

    handlePrefixedKey(event) {
      const key = Utils.getShortcutKey(event);
      const tab = this.getTabForKey(key);
      this.cancelPrefix();

      if (!tab) return false;

      event.preventDefault();
      return this.openTab(tab);
    },
  };

  const ShortcutHelpModal = {
    modal: null,

    getSections() {
      return [
        {
          title: "Results",
          rows: [
            { keys: ["J", "Down"], label: "Next result or image below" },
            { keys: ["K", "Up"], label: "Previous result or image above" },
            { keys: ["H", "Left"], label: "Previous page or image left" },
            { keys: ["L", "Right"], label: "Next page or image right" },
            { keys: ["Enter"], label: "Open or preview selected result" },
            {
              keys: ["Cmd/Ctrl+Enter"],
              label: "Open selected result in a new tab",
            },
            { keys: ["/"], label: "Focus search box" },
            { keys: ["Esc"], label: "Close shortcuts or blur search box" },
          ],
        },
        {
          title: "Search tabs",
          rows: CONFIG.searchTabs.map((tab) => ({
            keys: [`g ${tab.mnemonic}`, `g ${tab.digit}`],
            label: tab.label,
          })),
        },
        {
          title: "Help",
          rows: [{ keys: ["?"], label: "Show shortcuts" }],
        },
      ];
    },

    createElement(tagName, attributes = {}, text = "") {
      const element = document.createElement(tagName);
      Object.keys(attributes).forEach((name) => {
        element.setAttribute(name, attributes[name]);
      });
      if (text) {
        element.textContent = text;
      }
      return element;
    },

    createShortcutKeys(keys) {
      const container = this.createElement("span", {
        "data-gsn-shortcut-keys": "true",
      });

      keys.forEach((key, index) => {
        if (index > 0) {
          container.appendChild(
            this.createElement(
              "span",
              { "data-gsn-shortcut-separator": "true" },
              "/"
            )
          );
        }

        container.appendChild(this.createElement("kbd", {}, key));
      });

      return container;
    },

    createShortcutRow(row) {
      const element = this.createElement("div", {
        "data-gsn-shortcut-row": "true",
      });
      element.appendChild(this.createShortcutKeys(row.keys));
      element.appendChild(
        this.createElement(
          "span",
          { "data-gsn-shortcut-label": "true" },
          row.label
        )
      );
      return element;
    },

    createShortcutSection(section) {
      const element = this.createElement("section", {
        "data-gsn-shortcuts-section": "true",
      });
      element.appendChild(
        this.createElement(
          "h3",
          { "data-gsn-shortcuts-section-title": "true" },
          section.title
        )
      );
      section.rows.forEach((row) => {
        element.appendChild(this.createShortcutRow(row));
      });
      return element;
    },

    open() {
      if (this.modal) return;

      const modal = document.createElement("div");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-label", "Google Search Navigator shortcuts");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("data-gsn-shortcuts-modal", "true");
      modal.setAttribute("tabindex", "-1");
      modal.appendChild(
        this.createElement(
          "h2",
          { "data-gsn-shortcuts-title": "true" },
          "Google Search Navigator Shortcuts"
        )
      );
      this.getSections().forEach((section) => {
        modal.appendChild(this.createShortcutSection(section));
      });

      document.body.appendChild(modal);
      modal.focus();
      this.modal = modal;
    },

    close() {
      if (!this.modal) return;
      this.modal.remove();
      this.modal = null;
    },

    toggle() {
      if (this.modal) {
        this.close();
      } else {
        this.open();
      }
    },
  };

  // Initialize navigation controller
  const navigation = new NavigationController();

  // Keyboard Event Handler
  const KeyboardHandler = {
    handleEscapeKey(event) {
      event.preventDefault();
      if (ShortcutHelpModal.modal) {
        ShortcutHelpModal.close();
        SearchTabHandler.cancelPrefix();
        return;
      }

      const contentWrapper = domCache.contentWrapper;
      if (contentWrapper) {
        contentWrapper.click();
      }
      SearchInputHandler.blurSearchInput();
      navigation.setHighlight(navigation.focusIndex);
    },

    handleKeyupEvent(event) {
      const keyCode = event.code;
      console.log("keyup:", keyCode);

      if (Utils.isTextElementFocused()) {
        // Escape key
        if (keyCode === "Escape") {
          KeyboardHandler.handleEscapeKey(event);
        }
        return;
      }
    },

    handleKeydownEvent(event) {
      const keyCode = event.code;
      console.log("keydown:", keyCode);

      if (Utils.isTextElementFocused()) {
        return;
      }

      if (SearchTabHandler.pendingPrefix) {
        SearchTabHandler.handlePrefixedKey(event);
        return;
      }

      if (keyCode === "Slash" && event.shiftKey) {
        event.preventDefault();
        SearchTabHandler.cancelPrefix();
        ShortcutHelpModal.toggle();
        return;
      }

      if (keyCode === "Escape") {
        KeyboardHandler.handleEscapeKey(event);
        return;
      }

      if (keyCode === "KeyG" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        SearchTabHandler.startPrefix();
        return;
      }

      // Navigation keys
      if (keyCode === "KeyJ" || keyCode === "ArrowDown") {
        event.preventDefault();
        if (domCache.isImageSearch) {
          navigation.navigateImageDirection("down");
          return;
        }
        navigation.navigateNext();
        return;
      }

      if (keyCode === "KeyK" || keyCode === "ArrowUp") {
        event.preventDefault();
        if (domCache.isImageSearch) {
          navigation.navigateImageDirection("up");
          return;
        }
        navigation.navigatePrev();
        return;
      }

      // Activation key
      if (keyCode === "Enter") {
        event.preventDefault();
        // Check for Cmd+Enter (metaKey on macOS)
        if (event.metaKey || event.ctrlKey) {
          console.log("Cmd+Enter detected: opening in new tab");
          navigation.openItem(true); // Open in new tab
        } else {
          console.log("Enter detected: normal navigation");
          navigation.openItem(false); // Normal navigation
        }
        return;
      }

      // Pagination keys
      if (keyCode === "KeyL" || keyCode === "ArrowRight") {
        // Bypass when Cmd+L is pressed; allow browser's address bar focus
        if (
          (keyCode === "KeyL" && event.metaKey) ||
          (keyCode === "KeyL" && event.ctrlKey)
        ) {
          return;
        }
        event.preventDefault();
        if (domCache.isImageSearch) {
          navigation.navigateImageDirection("right");
          return;
        }
        PaginationHandler.handlePagination("next");
        return;
      }

      if (keyCode === "KeyH" || keyCode === "ArrowLeft") {
        event.preventDefault();
        if (domCache.isImageSearch) {
          navigation.navigateImageDirection("left");
          return;
        }
        PaginationHandler.handlePagination("prev");
        return;
      }

      // Search focus key
      if (keyCode === "Slash") {
        event.preventDefault();
        SearchInputHandler.focusSearchInput();
        return;
      }
    },
  };

  // DOM Observer for dynamic content
  const DOMObserver = {
    observer: null,

    init() {
      this.observer = new MutationObserver(
        Utils.debounce((mutations) => {
          // Check if search results have changed
          const hasNewResults = mutations.some((mutation) =>
            Array.from(mutation.addedNodes).some(
              (node) =>
                node.nodeType === Node.ELEMENT_NODE &&
                ((node.matches &&
                  (node.matches(CONFIG.selectors.resultElements) ||
                    node.matches(CONFIG.selectors.imageResultElements))) ||
                  (node.querySelector &&
                    (node.querySelector(CONFIG.selectors.resultElements) ||
                      node.querySelector(CONFIG.selectors.imageResultElements))))
            )
          );

          if (hasNewResults) {
            navigation.refresh();
          }
        }, 250)
      );

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    disconnect() {
      if (this.observer) {
        this.observer.disconnect();
      }
    },
  };

  // Event Listeners
  const setupEventListeners = () => {
    window.addEventListener("keyup", KeyboardHandler.handleKeyupEvent);
    window.addEventListener("keydown", KeyboardHandler.handleKeydownEvent);

    // Handle page unload
    window.addEventListener("beforeunload", () => {
      DOMObserver.disconnect();
    });
  };

  // Initialize the application
  const init = () => {
    try {
      StyleInstaller.init();
      DOMObserver.init();
      setupEventListeners();

      console.log("Google Search Navigator initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Google Search Navigator:", error);
    }
  };

  // Start the application
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
