// popup.js - UI controller

document.addEventListener('DOMContentLoaded', () => {
  // Constants for destination options
  const DEST_SELECT = 'select';
  const DEST_CURRENT = 'current';
  const DEST_DOWNLOADS = 'downloads';

  // UI Elements
  const capturePageBtn = document.getElementById('capturePageBtn');
  const captureFullPageBtn = document.getElementById('captureFullPageBtn');
  const statusDiv = document.getElementById('status');
  const selectDestOption = document.getElementById('selectDestOption');
  const currentFolderOption = document.getElementById('currentFolderOption');
  const downloadsFolderOption = document.getElementById('downloadsFolderOption');
  const currentFolderText = document.getElementById('currentFolderText');

  // Extension version
  let extensionVersion = '';

  // Localization - Apply translations
  function applyTranslations() {
    document.getElementById('captureVisiblePage').textContent = chrome.i18n.getMessage('captureVisiblePage');
    document.getElementById('captureFullPage').textContent = chrome.i18n.getMessage('captureFullPage');
    document.getElementById('saveTo').textContent = chrome.i18n.getMessage('saveTo');
    document.getElementById('selectDestination').textContent = chrome.i18n.getMessage('selectDestination');
    document.getElementById('downloadsFolder').textContent = chrome.i18n.getMessage('downloadsFolder');
  }

  // Helper function to create translated error messages
  function getErrorMessage(error) {
    return chrome.i18n.getMessage('error', [error || chrome.i18n.getMessage('unknownError')]);
  }

  // Apply localization
  applyTranslations();

  // Get extension version from manifest
  chrome.runtime.getManifest && chrome.runtime.getManifest().version
    ? extensionVersion = chrome.runtime.getManifest().version
    : extensionVersion = '';

  // Set default status to version number
  function setDefaultStatus() {
    if (!statusDiv.textContent || statusDiv.textContent.trim() === '') {
      // Création sécurisée de l'élément span au lieu d'utiliser innerHTML
      statusDiv.textContent = ''; // Effacer le contenu existant
      const versionSpan = document.createElement('span');
      versionSpan.className = 'version-info';
      versionSpan.textContent = 'v' + extensionVersion;
      statusDiv.appendChild(versionSpan);
    }
  }

  // Initial setup of version in status
  setDefaultStatus();

  // Check if extension runtime is available
  if (!chrome.runtime) {
    statusDiv.textContent = chrome.i18n.getMessage('extensionUnavailable');
    return;
  }

  // Load saved preferences and update UI
  function updatePreferences() {
    chrome.storage.local.get(['saveDestination', 'lastDownloadFolder'], (result) => {
      // Set default destination if not set
      if (!result.saveDestination) {
        result.saveDestination = DEST_SELECT;
        chrome.storage.local.set({ saveDestination: DEST_SELECT });
      }

      // Update radio buttons based on saved destination
      selectDestOption.checked = result.saveDestination === DEST_SELECT;
      currentFolderOption.checked = result.saveDestination === DEST_CURRENT;
      downloadsFolderOption.checked = result.saveDestination === DEST_DOWNLOADS;

      // Update current folder text
      if (result.lastDownloadFolder) {
        const folderName = getFolderNameFromPath(result.lastDownloadFolder);
        currentFolderText.textContent = folderName || chrome.i18n.getMessage('currentFolder');
        currentFolderOption.disabled = !folderName;
      } else {
        currentFolderText.textContent = chrome.i18n.getMessage('noFolderSelected');
        currentFolderOption.disabled = true;
      }

      // Check if default downloads folder is accessible
      chrome.runtime.sendMessage({action: "getDefaultDownloadsFolder"}, response => {
        if (response && response.success && response.folder) {
          downloadsFolderOption.disabled = false;
        } else {
          // If default folder is not accessible, disable this option
          if (downloadsFolderOption.checked) {
            selectDestOption.checked = true;
            chrome.storage.local.set({ saveDestination: DEST_SELECT });
          }
          downloadsFolderOption.disabled = true;
        }

        // Update disabled state for UI
        updateDisabledState();
      });
    });
  }

  // Extract folder name from path
  function getFolderNameFromPath(path) {
    if (!path) return null;

    path = path.trim();

    let folderName;
    if (path.includes('/')) {
      const parts = path.split('/').filter(part => part.trim() !== '');
      folderName = parts.length > 0 ? parts[parts.length - 1] : null;
    } else if (path.includes('\\')) {
      const parts = path.split('\\').filter(part => part.trim() !== '');
      folderName = parts.length > 0 ? parts[parts.length - 1] : null;
    } else {
      folderName = path;
    }

    return folderName || null;
  }

  // Update disabled classes when options change
  function updateDisabledState() {
    document.querySelectorAll('.dest-item').forEach(item => {
      const radio = item.querySelector('input[type="radio"]');
      if (radio) {
        if (radio.disabled) {
          item.classList.add('disabled');
        } else {
          item.classList.remove('disabled');
        }
      }
    });

    // Restore default status if no message is currently shown
    setDefaultStatus();
  }

  // Handle screenshot capture
  function captureScreenshot(fullPage) {
    // Disable buttons during capture
    capturePageBtn.disabled = true;
    captureFullPageBtn.disabled = true;
    statusDiv.textContent = chrome.i18n.getMessage('capturing');

    // Add active class to show which button is active
    if (fullPage) {
      captureFullPageBtn.classList.add('active');
      capturePageBtn.classList.remove('active');
    } else {
      capturePageBtn.classList.add('active');
      captureFullPageBtn.classList.remove('active');
    }

    // Determine save options based on selected destination
    let saveAs = selectDestOption.checked;
    let useDownloadsFolder = downloadsFolderOption.checked;

    chrome.runtime.sendMessage({
      action: "capture",
      saveAs: saveAs,
      fullPage: fullPage,
      useDownloadsFolder: useDownloadsFolder
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
        statusDiv.textContent = getErrorMessage(chrome.runtime.lastError.message);
        capturePageBtn.disabled = false;
        captureFullPageBtn.disabled = false;
        return;
      }

      if (response && response.success) {
        statusDiv.textContent = chrome.i18n.getMessage('screenshotSaved');

        setTimeout(() => {
          chrome.storage.local.get(['saveDestination', 'lastDownloadFolder'], (result) => {
            console.log("Updated preferences after capture:", result);
            updatePreferences();
          });
          capturePageBtn.classList.remove('active');
          captureFullPageBtn.classList.remove('active');
        }, 1000);

        // Auto-close popup after success
        setTimeout(() => window.close(), 2000);
      } else {
        statusDiv.textContent = getErrorMessage(response ? response.message : null);
        capturePageBtn.disabled = false;
        captureFullPageBtn.disabled = false;

        // Restore default status after a delay
        setTimeout(() => {
          setDefaultStatus();
        }, 3000);
      }
    });
  }

  // Verify background script is accessible
  chrome.runtime.sendMessage({action: "ping"}, response => {
    if (chrome.runtime.lastError) {
      console.error("Background connection error:", chrome.runtime.lastError);
      statusDiv.textContent = chrome.i18n.getMessage('cannotConnectBackground');
      return;
    }

    if (response && response.success) {
      console.log("Background connection successful");
      updatePreferences();
    }
  });

  // Save preferences when destination option changes
  selectDestOption.addEventListener('change', () => {
    if (selectDestOption.checked) {
      chrome.storage.local.set({ saveDestination: DEST_SELECT });
    }
  });

  currentFolderOption.addEventListener('change', () => {
    if (currentFolderOption.checked) {
      chrome.storage.local.set({ saveDestination: DEST_CURRENT });
    }
  });

  downloadsFolderOption.addEventListener('change', () => {
    if (downloadsFolderOption.checked) {
      chrome.storage.local.set({ saveDestination: DEST_DOWNLOADS });
    }
  });

  // Make labels clickable for radio options
  document.querySelectorAll('.dest-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const radio = item.querySelector('input[type="radio"]');
      if (radio && !radio.disabled) {
        radio.checked = true;
        // Manually trigger change event
        const event = new Event('change');
        radio.dispatchEvent(event);
      }
    });
  });

  // Button event listeners
  capturePageBtn.addEventListener('click', () => captureScreenshot(false));
  captureFullPageBtn.addEventListener('click', () => captureScreenshot(true));
});
