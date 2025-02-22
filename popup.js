// popup.js - UI controller for StampShot extension
document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup script loaded");

  const captureBtn = document.getElementById('captureBtn');
  const statusDiv = document.getElementById('status');
  const saveAsOption = document.getElementById('saveAsOption');
  const fullPageOption = document.getElementById('fullPageOption');
  const folderInfo = document.getElementById('folderInfo');

  // Check if extension runtime is available
  if (!chrome.runtime) {
    statusDiv.textContent = 'Extension runtime unavailable';
    return;
  }

  // Load saved preferences
  function updatePreferences() {
    chrome.storage.local.get(['saveAsEnabled', 'captureFullPage'], (result) => {
      if (result.saveAsEnabled !== undefined) {
        saveAsOption.checked = result.saveAsEnabled;
      }

      if (result.captureFullPage !== undefined) {
        fullPageOption.checked = result.captureFullPage;
      } else {
        // Default to true if not set
        fullPageOption.checked = true;
        chrome.storage.local.set({ captureFullPage: true });
      }
    });
  }

  // Verify background script is accessible
  chrome.runtime.sendMessage({action: "ping"}, response => {
    if (chrome.runtime.lastError) {
      console.error("Background connection error:", chrome.runtime.lastError);
      statusDiv.textContent = 'Cannot connect to background script';
      return;
    }

    if (response && response.success) {
      console.log("Background connection successful");
      updateFolderInfo();
      updatePreferences();
    }
  });

  // Update folder path display
  function updateFolderInfo() {
    chrome.runtime.sendMessage({action: "getFolder"}, response => {
      if (response && response.folder) {
        folderInfo.innerHTML = `If disabled, screenshots will be saved to: <strong>${response.folder}</strong>`;
      } else {
        folderInfo.innerHTML = `If disabled, screenshots will be saved to default folder`;
      }
    });
  }

  // Initialize UI with saved preferences
  updatePreferences();

  // Save preferences when changed
  saveAsOption.addEventListener('change', () => {
    chrome.storage.local.set({ saveAsEnabled: saveAsOption.checked });
  });

  fullPageOption.addEventListener('change', () => {
    chrome.storage.local.set({ captureFullPage: fullPageOption.checked });
  });

  // Handle screenshot capture
  captureBtn.addEventListener('click', () => {
    captureBtn.disabled = true;
    statusDiv.textContent = 'Capturing...';

    chrome.runtime.sendMessage({
      action: "capture",
      saveAs: saveAsOption.checked,
      fullPage: fullPageOption.checked
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
        statusDiv.textContent = `Error: ${chrome.runtime.lastError.message}`;
        captureBtn.disabled = false;
        return;
      }

      if (response && response.success) {
        statusDiv.textContent = 'Screenshot saved!';

        // Update UI after download completes
        setTimeout(() => {
          updateFolderInfo();
          updatePreferences();
        }, 1000);

        // Auto-close popup after success
        setTimeout(() => window.close(), 1500);
      } else {
        statusDiv.textContent = `Error: ${response ? response.message : 'Unknown error'}`;
        captureBtn.disabled = false;
      }
    });
  });
});
