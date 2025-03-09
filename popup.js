// popup.js - UI controller for StampShot extension
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

  // Check if extension runtime is available
  if (!chrome.runtime) {
    statusDiv.textContent = 'Extension runtime unavailable';
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
        currentFolderText.textContent = folderName || 'Current folder';
        currentFolderOption.disabled = !folderName;
      } else {
        currentFolderText.textContent = 'No folder selected';
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
    
    // Handle different path formats
    let folderName;
    if (path.includes('/')) {
      const parts = path.split('/');
      folderName = parts[parts.length - 1] || parts[parts.length - 2];
    } else if (path.includes('\\')) {
      const parts = path.split('\\');
      folderName = parts[parts.length - 1] || parts[parts.length - 2];
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
  }

  // Handle screenshot capture
  function captureScreenshot(fullPage) {
    // Disable buttons during capture
    capturePageBtn.disabled = true;
    captureFullPageBtn.disabled = true;
    statusDiv.textContent = 'Capturing...';
    
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
        statusDiv.textContent = `Error: ${chrome.runtime.lastError.message}`;
        capturePageBtn.disabled = false;
        captureFullPageBtn.disabled = false;
        return;
      }

      if (response && response.success) {
        statusDiv.textContent = 'Screenshot saved!';

        // Update UI after download completes
        setTimeout(() => {
          updatePreferences();
          capturePageBtn.classList.remove('active');
          captureFullPageBtn.classList.remove('active');
        }, 1000);

        // Auto-close popup after success
        setTimeout(() => window.close(), 1500);
      } else {
        statusDiv.textContent = `Error: ${response ? response.message : 'Unknown error'}`;
        capturePageBtn.disabled = false;
        captureFullPageBtn.disabled = false;
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
