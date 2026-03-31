document.addEventListener("DOMContentLoaded", () => {
  // Load cached certificate info
  chrome.storage.local.get("cachedCertificate", (result) => {
    const certInfo = document.getElementById("cert-info");
    if (result.cachedCertificate) {
      certInfo.textContent = `Сертификат: ${result.cachedCertificate.subjectDN || "Загружен"}`;
    } else {
      certInfo.textContent = "Сертификат не привязан";
    }
  });

  // Forget certificate
  document.getElementById("btn-forget").addEventListener("click", () => {
    chrome.storage.local.remove("cachedCertificate", () => {
      document.getElementById("cert-info").textContent = "Сертификат не привязан";
    });
  });
});
