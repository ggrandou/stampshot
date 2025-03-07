// background.js - Main background script for StampShot extension
console.log("Background script loaded successfully!");

// Set up message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request);

  if (request.action === "ping") {
    sendResponse({ success: true, message: "Background script is running" });
    return false;
  }
  else if (request.action === "capture") {
    captureScreenshot(request.fullPage, request.saveAs, request.useDownloadsFolder)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({ success: false, message: error.message });
      });
    return true;
  }
  else if (request.action === "getFolder") {
    chrome.storage.local.get(['lastDownloadFolder'], (result) => {
      sendResponse({ folder: result.lastDownloadFolder || "" });
    });
    return true;
  }
  else if (request.action === "getDefaultDownloadsFolder") {
    getDefaultDownloadsFolder()
      .then(folder => {
        sendResponse({ success: true, folder: folder });
      })
      .catch(error => {
        sendResponse({ success: false, message: error.message });
      });
    return true;
  }
  else if (request.action === "getPreferences") {
    chrome.storage.local.get(['lastDownloadFolder', 'saveDestination'], (result) => {
      sendResponse({
        folder: result.lastDownloadFolder || "",
        saveDestination: result.saveDestination || "select"
      });
    });
    return true;
  }
});

// Main capture function for both full page and visible screenshots
async function captureScreenshot(fullPage = true, saveAs = true, useDownloadsFolder = false) {
  try {
    const tabs = await getActiveTabs();

    if (!tabs || tabs.length === 0) {
      throw new Error("No active tab found");
    }

    const tab = tabs[0];

    // Determine which capture method to use based on fullPage parameter
    const captureMethod = fullPage ? captureFullPageScreenshot : capturePageScreenshot;

    // Get canvas with the screenshot (either full page or visible only)
    const canvas = await captureMethod(tab);

    // Add header with URL and date
    const canvasWithHeader = await addHeaderToScreenshot(canvas, tab);
    const screenshotDataUrl = canvasWithHeader.toDataURL('image/png');

    return await saveScreenshot(screenshotDataUrl, saveAs, useDownloadsFolder);

  } catch (error) {
    console.error("Screenshot capture failed:", error);
    return { success: false, message: error.message };
  }
}

// Main function to capture full page screenshot
async function captureFullPageScreenshot(tab) {
  try {
    const dimensions = await getPageDimensions(tab);
    const { width, height } = dimensions;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    await saveScrollPosition(tab);

    let currentX = 0;
    let currentY = 0;
    let isFirstCapture = true;

    // Capture screenshot sections
    while (currentX < width) {
      currentY = 0;

      while (currentY < height) {
        await scrollTo(tab, currentX, currentY);
        await new Promise(resolve => setTimeout(resolve, 100));

        const scrollpos = await getScrollPosition(tab);

        // Hide UI elements after first capture
        if (!isFirstCapture) {
          await hideFixedElementsAndScrollbars(tab);
        }
        isFirstCapture = false;

        currentX = scrollpos.x;
        currentY = scrollpos.y;

        const dataUrl = await captureVisiblePart();
        const img = await loadImage(dataUrl);

        const viewportWidth = tab.width;
        const viewportHeight = tab.height;

        // Draw the captured section to the canvas
        ctx.drawImage(
          img,
          0, 0,
          img.width, img.height,
          currentX, currentY,
          viewportWidth, viewportHeight
        );

        currentY += tab.height;
      }

      currentX += tab.width;
    }

    // Restore page state
    await restoreFixedElementsAndScrollbars(tab);
    await restoreScrollPosition(tab);

    return canvas;

  } catch (error) {
    console.error("Error capturing full page screenshot:", error);
    try {
      // Attempt to restore page state on error
      await restoreFixedElementsAndScrollbars(tab);
      await restoreScrollPosition(tab);
    } catch (e) {
      console.error("Failed to restore page state:", e);
    }
    throw error;
  }
}

// Capture only the visible part of the page
async function capturePageScreenshot(tab) {
  try {
    // Capture the visible area
    const dataUrl = await captureVisiblePart();
    const img = await loadImage(dataUrl);

    // Create canvas with viewport dimensions
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = tab.width;
    canvas.height = tab.height;

    // Draw the captured image
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, tab.width, tab.height);

    return canvas;
  } catch (error) {
    console.error("Error capturing visible page screenshot:", error);
    try {
      // Attempt to restore page state on error
      await restoreFixedElementsAndScrollbars(tab);
      await restoreScrollPosition(tab);
    } catch (e) {
      console.error("Failed to restore page state:", e);
    }
    throw error;
  }
}

// Promise wrappers for Chrome API functions
function getActiveTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function downloadFile(url, filename, saveAs = true, useDownloadsFolder = false) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['lastDownloadFolder'], (result) => {
      let downloadOptions = {
        url: url,
        filename: filename,
        saveAs: saveAs
      };

      // Si on utilise le dossier de téléchargement par défaut, ne pas spécifier de chemin
      if (!saveAs && !useDownloadsFolder && result.lastDownloadFolder) {
        let folderPath = result.lastDownloadFolder;

        // Nettoyer le chemin du dossier pour qu'il soit utilisable
        if (folderPath) {
          // Supprimer les chemins absolus pour n'avoir que le dossier relatif
          let parts = [];
          if (folderPath.includes('/')) {
            parts = folderPath.split('/');
          } else if (folderPath.includes('\\')) {
            parts = folderPath.split('\\');
          }
          
          if (parts.length > 0) {
            // Utiliser uniquement le dernier segment non vide du chemin
            folderPath = parts.filter(part => part.trim() !== '').pop() || '';
          }
          
          // Ajouter le séparateur à la fin si nécessaire
          if (folderPath && !folderPath.endsWith('/')) {
            folderPath = folderPath + '/';
          }
          
          if (folderPath) {
            downloadOptions.filename = folderPath + filename;
          }
        }
      }

      chrome.downloads.download(downloadOptions, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Track download for folder location saving
        if (saveAs) {
          chrome.storage.local.set({ pendingDownloadId: downloadId });
        }

        resolve(downloadId);
      });
    });
  });
}

// Page state management
function executeScript(tabId, code) {
  return new Promise((resolve, reject) => {
    chrome.tabs.executeScript(tabId, { code }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results && results[0]);
    });
  });
}

// Get page dimensions for screenshot
function getPageDimensions(tab) {
  return executeScript(tab.id, `({
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    devicePixelRatio: window.devicePixelRatio || 1
  })`);
}

// Save and restore scroll position
function saveScrollPosition(tab) {
  return executeScript(tab.id, `
    window._originalScrollX = window.scrollX;
    window._originalScrollY = window.scrollY;
    [window._originalScrollX, window._originalScrollY];
  `);
}

function restoreScrollPosition(tab) {
  return executeScript(tab.id, `
    if (typeof window._originalScrollX !== 'undefined' &&
        typeof window._originalScrollY !== 'undefined') {
      window.scrollTo(window._originalScrollX, window._originalScrollY);
    }
  `);
}

function getScrollPosition(tab) {
  return executeScript(tab.id, `({
    x: window.scrollX,
    y: window.scrollY
  })`);
}

function scrollTo(tab, x, y) {
  return executeScript(tab.id, `window.scrollTo(${x}, ${y});`);
}

// Hide fixed elements and scrollbars for clean screenshots
function hideFixedElementsAndScrollbars(tab) {
  return executeScript(tab.id, `
    if (!window._originalScrollbarStyles) {
      window._originalScrollbarStyles = {};
      window._originalScrollbarStyles.html = document.documentElement.style.cssText;
      window._originalScrollbarStyles.body = document.body.style.cssText;

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      window._fixedElements = [];
    }

    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);

      if (style.position === 'fixed' && style.display !== 'none') {
        const isAlreadyStored = window._fixedElements.some(
          item => item.element === el
        );
        if (!isAlreadyStored) {
          window._fixedElements.push({
            element: el,
            originalDisplay: style.display,
            originalPosition: style.position
          });
        }
        el.style.display = 'none';
      }
    });

    true
  `);
}

function restoreFixedElementsAndScrollbars(tab) {
  return executeScript(tab.id, `
    if (window._originalScrollbarStyles) {
      document.documentElement.style.cssText = window._originalScrollbarStyles.html;
      document.body.style.cssText = window._originalScrollbarStyles.body;

      if (window._fixedElements && window._fixedElements.length > 0) {
        window._fixedElements.forEach(item => {
          if (item.element) {
            item.element.style.display = item.originalDisplay;
            item.element.style.position = item.originalPosition;
          }
        });
      }

      delete window._originalScrollbarStyles;
      delete window._fixedElements;
    }

    true;
  `);
}

// Capture visible part of the tab
function captureVisiblePart() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, {format: "png"}, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(dataUrl);
    });
  });
}

// Load image from data URL
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

// Add header with URL and date to screenshot
function addHeaderToScreenshot(canvas, tab) {
  return new Promise(async (resolve) => {
    const defaultFont = await getDefaultFont(tab);
    const headerHeight = 50;
    const newCanvas = document.createElement('canvas');
    const ctx = newCanvas.getContext('2d');

    // Set new canvas dimensions
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height + headerHeight;

    // Fill header background
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(0, 0, newCanvas.width, headerHeight);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, newCanvas.width, headerHeight);

    // Configure text style
    ctx.fillStyle = '#333333';
    ctx.font = defaultFont;

    // Format date
    const now = new Date();
    const pad = (num) => num.toString().padStart(2, '0');

    // Format timezone offset
    const tzOffset = now.getTimezoneOffset();
    const tzOffsetHours = Math.abs(Math.floor(tzOffset / 60));
    const tzOffsetMinutes = Math.abs(tzOffset % 60);
    const tzOffsetSign = tzOffset <= 0 ? '+' : '-';
    const tzOffsetFormatted = `${tzOffsetSign}${pad(tzOffsetHours)}:${pad(tzOffsetMinutes)}`;

    // Format date as YYYY-MM-DD HH:MM:SS +/-HH:MM
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${tzOffsetFormatted}`;

    // Calculate available width
    const padding = 20;
    const availableWidth = newCanvas.width - padding;

    // Truncate URL if needed
    const urlText = tab.url;
    const urlWidth = ctx.measureText(urlText).width;

    let displayUrl = urlText;
    if (urlWidth > availableWidth) {
      let truncatedUrl = urlText;
      const ellipsis = "...";
      const ellipsisWidth = ctx.measureText(ellipsis).width;

      while (ctx.measureText(truncatedUrl).width + ellipsisWidth > availableWidth && truncatedUrl.length > 0) {
        truncatedUrl = truncatedUrl.substring(0, truncatedUrl.length - 1);
      }

      displayUrl = truncatedUrl + ellipsis;
    }

    // Calculate line height
    const fontSize = parseInt(defaultFont.match(/\d+/)[0]) || 14;
    const lineHeight = fontSize + 4;

    // Draw URL and date
    ctx.fillText(displayUrl, 10, lineHeight);
    ctx.fillText(date, 10, lineHeight * 2);

    // Draw the original screenshot
    ctx.drawImage(canvas, 0, headerHeight);

    resolve(newCanvas);
  });
}

// Convert data URL to Blob for download
function dataUrlToBlob(dataUrl) {
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);

  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ab], {type: mimeString});
}

// Save screenshot to downloads folder
async function saveScreenshot(dataUrl, saveAs = true, useDownloadsFolder = false) {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").slice(0, 15);
  const filename = "screenshot_" + timestamp + ".png";

  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);

  try {
    let downloadId;
    
    if (useDownloadsFolder) {
      // Utiliser le dossier de téléchargement par défaut
      downloadId = await downloadFile(blobUrl, filename, false, true);
    } else {
      // Utiliser le dernier dossier ou la boîte de dialogue saveAs
      downloadId = await downloadFile(blobUrl, filename, saveAs, false);
    }
    
    return { success: true, downloadId };
  } catch (error) {
    console.error("Error saving screenshot:", error);
    throw error;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// Get download folder path
function getDownloadFolder() {
  return new Promise((resolve) => {
    chrome.downloads.search({limit: 1, orderBy: ['-startTime']}, (downloads) => {
      if (downloads && downloads.length > 0) {
        try {
          const lastDownloadPath = downloads[0].filename;
          const pathParts = lastDownloadPath.split('/');
          const downloadIndex = pathParts.findIndex(part =>
            part.toLowerCase() === 'downloads' ||
            part.toLowerCase() === 'téléchargements');

          if (downloadIndex !== -1) {
            const downloadRoot = pathParts.slice(0, downloadIndex + 1).join('/');
            resolve(downloadRoot);
          } else {
            resolve(null);
          }
        } catch (e) {
          console.error("Error parsing download path:", e);
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

// Check if path is in download folder
function isInDownloadFolder(path, downloadRoot) {
  if (!downloadRoot || !path) return false;
  return path.startsWith(downloadRoot);
}

// Get default downloads folder
function getDefaultDownloadsFolder() {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({
      limit: 1,
      orderBy: ['-startTime']
    }, (downloads) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (downloads && downloads.length > 0) {
        // Essayer d'extraire le chemin du dossier de téléchargement
        const path = downloads[0].filename || '';
        if (path) {
          // Extraire le dossier de téléchargement du chemin
          let downloadsPath = '';
          if (path.includes('/')) {
            const parts = path.split('/');
            parts.pop(); // Retirer le nom de fichier
            downloadsPath = parts.join('/');
          } else if (path.includes('\\')) {
            const parts = path.split('\\');
            parts.pop(); // Retirer le nom de fichier
            downloadsPath = parts.join('\\');
          }
          
          resolve(downloadsPath);
        } else {
          resolve('');
        }
      } else {
        resolve('');
      }
    });
  });
}

// Listen for download completion
chrome.downloads.onChanged.addListener((downloadDelta) => {
  chrome.storage.local.get(['pendingDownloadId'], (result) => {
    if (result.pendingDownloadId && downloadDelta.id === result.pendingDownloadId) {
      if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        chrome.downloads.search({id: downloadDelta.id}, async (downloads) => {
          if (downloads && downloads.length > 0) {
            const download = downloads[0];

            if (download.filename) {
              const downloadRoot = await getDownloadFolder();

              if (downloadRoot && isInDownloadFolder(download.filename, downloadRoot)) {
                let folderPath = '';

                if (download.filename.includes('/')) {
                  const parts = download.filename.split('/');
                  if (parts.length >= 2) {
                    folderPath = parts[parts.length - 2];
                  }
                }

                if (folderPath) {
                  chrome.storage.local.set({
                    lastDownloadFolder: folderPath,
                    saveDestination: 'current'  // Auto-select current folder option
                  });
                }
              }
            }
          }

          chrome.storage.local.remove('pendingDownloadId');
        });
      }
    }
  });
});

// Get default font from the page
function getDefaultFont(tab) {
  return executeScript(tab.id, `
    (function() {
      const bodyStyles = window.getComputedStyle(document.body);
      return bodyStyles.font || (bodyStyles.fontSize + ' ' + bodyStyles.fontFamily);
    })();
  `).then(result => result || '14px Arial, sans-serif');
}
