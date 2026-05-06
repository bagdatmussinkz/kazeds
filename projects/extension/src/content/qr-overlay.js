// QR overlay content script (ISOLATED world)
// Renders a QR code overlay using Shadow DOM for style isolation
// Injected dynamically by sign-flow.js when a signing request starts

(function () {
  if (window.__kazedsQrOverlayInstalled) return;
  window.__kazedsQrOverlayInstalled = true;

  let overlayHost = null;
  let shadow = null;
  let currentSessionId = null;
  let progressTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "kazeds-show-qr") {
      currentSessionId = message.sessionId;
      showOverlay(message);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "kazeds-hide-qr" && message.sessionId === currentSessionId) {
      removeOverlay();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "kazeds-qr-status" && message.sessionId === currentSessionId) {
      updateStatus(message.status);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  function showOverlay(data) {
    if (overlayHost) removeOverlay();

    overlayHost = document.createElement("div");
    overlayHost.id = "__kazeds_qr_overlay__";
    shadow = overlayHost.attachShadow({ mode: "closed" });

    const expiresMs = data.expiresAt ? new Date(data.expiresAt).getTime() - Date.now() : 300000;
    const totalMs = Math.max(expiresMs, 10000);
    const isAuth = data.operation === "auth";
    const badgeClass = isAuth ? "qr-badge-auth" : "qr-badge-sign";
    const badgeText = isAuth ? "Аутентификация" : "Подписание";

    shadow.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("src/content/qr-overlay.css")}">
      <div class="overlay-backdrop">
        <div class="overlay-dialog">
          <div class="qr-badge ${badgeClass}">${badgeText}</div>
          <p class="qr-title">Отсканируйте QR-код</p>
          <p class="qr-subtitle">Откройте KazEDS на телефоне и наведите камеру</p>
          <div class="qr-domain">${escapeHtml(data.domain || "")}</div>
          <div class="qr-image-wrap">
            <img class="qr-image" src="${escapeHtml(data.qrImageUrl)}" width="280" height="280" alt="QR" />
          </div>
          <div class="qr-progress"><div class="qr-progress-bar" id="kazeds-bar" style="width:100%"></div></div>
          <div class="qr-countdown">Осталось <strong id="kazeds-countdown">${Math.floor(totalMs / 1000)}</strong> сек</div>
          <div class="qr-status" id="kazeds-status">
            <div class="qr-spinner"></div>
            <span>Ожидание сканирования...</span>
          </div>
          <button class="qr-btn-cancel" id="kazeds-cancel">Отмена</button>
          <div class="qr-branding">KazEDS v2.0.3</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlayHost);

    // Bind events
    shadow.getElementById("kazeds-cancel").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "kazeds-cancel-flow", sessionId: currentSessionId });
      removeOverlay();
    });

    shadow.querySelector(".overlay-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        chrome.runtime.sendMessage({ type: "kazeds-cancel-flow", sessionId: currentSessionId });
        removeOverlay();
      }
    });

    // Entrance animation
    requestAnimationFrame(() => {
      const backdrop = shadow.querySelector(".overlay-backdrop");
      if (backdrop) backdrop.classList.add("visible");
    });

    // Countdown timer
    const startTime = Date.now();
    const bar = shadow.getElementById("kazeds-bar");
    const countdown = shadow.getElementById("kazeds-countdown");

    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      if (bar) bar.style.width = Math.max(0, (1 - elapsed / totalMs) * 100) + "%";
      if (countdown) countdown.textContent = String(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    }, 1000);
  }

  function updateStatus(status) {
    if (!shadow) return;
    const statusEl = shadow.getElementById("kazeds-status");
    if (!statusEl) return;

    if (status === "scanned") {
      statusEl.innerHTML = `
        <div class="qr-spinner qr-spinner-green"></div>
        <span class="qr-status-scanned">QR отсканирован, ожидание подписи...</span>
      `;
    }
  }

  function removeOverlay() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (overlayHost && overlayHost.parentNode) {
      overlayHost.parentNode.removeChild(overlayHost);
    }
    overlayHost = null;
    shadow = null;
    currentSessionId = null;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();
