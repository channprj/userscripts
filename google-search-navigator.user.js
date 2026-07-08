// ==UserScript==
// @name         Google Search Navigator
// @description  Navigate google search with custom shortcuts
// @namespace    https://github.com/channprj/google-search-navigator
// @icon         https://user-images.githubusercontent.com/1831308/60544915-c043e700-9d54-11e9-9eb0-5c80c85d3a28.png
// @version      0.13
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
      if (document.querySelector("#google-search-navigator-style")) {
        return;
      }

      const style = document.createElement("style");
      style.setAttribute("id", "google-search-navigator-style");
      style.textContent = `
        [data-gsn-image-selected="true"] {
          outline: 3px solid #d93025 !important;
          outline-offset: 2px !important;
          border-radius: 4px !important;
        }
      `;
      (document.head || document.body).appendChild(style);
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

  // Initialize navigation controller
  const navigation = new NavigationController();

  // Keyboard Event Handler
  const KeyboardHandler = {
    handleEscapeKey(event) {
      event.preventDefault();
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
