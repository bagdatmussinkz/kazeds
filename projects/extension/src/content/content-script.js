/**
 * Content Script — инжектирует eds.js в контекст страницы
 * Вся логика в eds.js (WebSocket эмуляция, Relay, QR overlay)
 */

console.log("[KazEDS CS] Injecting eds.js");

const script = document.createElement("script");
script.src = chrome.runtime.getURL("eds.js");
script.onload = () => {
  console.log("[KazEDS CS] eds.js loaded");
  script.remove();
};
(document.head || document.documentElement).appendChild(script);
