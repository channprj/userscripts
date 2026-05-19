// ==UserScript==
// @name         X Shortcut Extension
// @namespace    https://chann.dev
// @version      0.1
// @icon https://user-images.githubusercontent.com/1831308/99884645-3101e100-2c73-11eb-9258-958dee09457e.png
// @description  X(fomerly Twitter) Extension
// @author       CHANN <chann@chann.dev>
// @match        https://x.com/*
// @run-at       document-end
// ==/UserScript==

const overrideStyle = document.createElement('style')
overrideStyle.innerHTML = `
div[lang=ko] {
  word-break: keep-all;
  word-wrap: break-word;
}
`
document.head.appendChild(overrideStyle)

// TODO: Use MutationObserver
const observer = new MutationObserver((mutations) => {})

observer.observe(document.body, {
  childList: true,
  subtree: true,
})

window.addEventListener('keyup', (event) => {
  event = event || window.event
  const keyCode = event.code

  const popupMenu = document.querySelector('[role=menu]')
  const closeBtn = document.querySelector('[aria-label=Close]')
  const backBtn = document.querySelector('[aria-label=Back]')
  if (keyCode === 'Escape') {
    if (popupMenu !== null) {
      popupMenu.remove()
      return
    } else if (closeBtn !== null) {
      closeBtn.click()
      return
    } else if (backBtn !== null) {
      backBtn.click()
      return
    }
  }
})
window.removeEventListener('keyup')

