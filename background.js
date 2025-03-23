// background.js - Service worker

// Set up message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request);

  switch (request.action) {
    case "ping":
      sendResponse({ success: true, message: chrome.i18n.getMessage('backgroundRunning') });
      return false;

    case "capture":
      handleCaptureRequest(request, sendResponse);
      return true;

    case "getFolder":
      chrome.storage.local.get(['lastDownloadFolder'], (result) => {
        sendResponse({ folder: result.lastDownloadFolder || "" });
      });
      return true;

    case "getDefaultDownloadsFolder":
      getDefaultDownloadsFolder()
        .then(folder => sendResponse({ success: true, folder: folder }))
        .catch(error => sendResponse({ success: false, message: error.message }));
      return true;

    case "getPreferences":
      chrome.storage.local.get(['lastDownloadFolder', 'saveDestination'], (result) => {
        sendResponse({
          folder: result.lastDownloadFolder || "",
          saveDestination: result.saveDestination || "select"
        });
      });
      return true;
  }
});

// Handler for capture requests that manages async operations
async function handleCaptureRequest(request, sendResponse) {
  try {
    const result = await captureScreenshot(
      request.fullPage,
      request.saveAs,
      request.useDownloadsFolder
    );
    sendResponse(result);
  } catch (error) {
    console.error(chrome.i18n.getMessage('captureFailure', [error.message]), error);
    sendResponse({ success: false, message: error.message });
  }
}

// Main capture function for both full page and visible screenshots
async function captureScreenshot(fullPage = true, saveAs = true, useDownloadsFolder = false) {
  try {
    const tabs = await getActiveTabs();

    if (!tabs || tabs.length === 0) {
      throw new Error(chrome.i18n.getMessage('noActiveTab'));
    }

    const tab = tabs[0];
    const captureMethod = fullPage ? captureFullPageScreenshot : captureVisiblePageScreenshot;
    const canvas = await captureMethod(tab);
    const canvasWithHeader = await addHeaderToScreenshot(canvas, tab);
    const screenshotDataUrl = canvasWithHeader.toDataURL('image/png');

    return await saveScreenshot(screenshotDataUrl, saveAs, useDownloadsFolder, tab.url);
  } catch (error) {
    console.error(chrome.i18n.getMessage('captureFailure', [error.message]), error);
    return { success: false, message: error.message };
  }
}

// Capture entire page by scrolling and stitching
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

    // Capture screenshot sections by scrolling through the page
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
    console.error(chrome.i18n.getMessage('captureFailure', [error.message]), error);
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
async function captureVisiblePageScreenshot(tab) {
  try {
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
    throw error;
  }
}

// Chrome API promise wrappers
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

      // If using a custom folder (not default downloads folder and not saveAs dialog)
      if (!saveAs && !useDownloadsFolder && result.lastDownloadFolder) {
        let folderPath = result.lastDownloadFolder;

        // Clean folder path to be usable
        if (folderPath) {
          // Extract relative path
          let parts = [];
          if (folderPath.includes('/')) {
            parts = folderPath.split('/');
          } else if (folderPath.includes('\\')) {
            parts = folderPath.split('\\');
          }

          if (parts.length > 0) {
            // Use only the last non-empty segment of the path
            folderPath = parts.filter(part => part.trim() !== '').pop() || '';
          }

          // Add separator at the end if needed
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

// Get page dimensions for screenshot
async function getPageDimensions(tab) {
  const func = () => {
    return {
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      devicePixelRatio: window.devicePixelRatio || 1
    };
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
}

// Scroll position management
async function saveScrollPosition(tab) {
  const func = () => {
    window._originalScrollX = window.scrollX;
    window._originalScrollY = window.scrollY;
    return [window._originalScrollX, window._originalScrollY];
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
}

async function restoreScrollPosition(tab) {
  const func = () => {
    if (typeof window._originalScrollX !== 'undefined' &&
        typeof window._originalScrollY !== 'undefined') {
      window.scrollTo(window._originalScrollX, window._originalScrollY);
    }
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
}

async function getScrollPosition(tab) {
  const func = () => {
    return {
      x: window.scrollX,
      y: window.scrollY
    };
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
}

async function scrollTo(tab, x, y) {
  const func = (x, y) => {
    window.scrollTo(x, y);
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func,
    args: [x, y]
  });

  return result ? result.result : null;
}

// Hide fixed elements and scrollbars for clean screenshots
async function hideFixedElementsAndScrollbars(tab) {
  const func = () => {
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

    return true;
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
}

async function restoreFixedElementsAndScrollbars(tab) {
  const func = () => {
    if (window._originalScrollbarStyles) {
      document.documentElement.style.cssText = window._originalScrollbarStyles.html;
      document.body.style.cssText = window._originalScrollbarStyles.body;

      if (window._fixedElements && window._fixedElements.length > 0) {
        window._fixedElements.forEach(item => {
          if (item.element) {
            item.element.display = item.originalDisplay;
            item.element.position = item.originalPosition;
          }
        });
      }

      delete window._originalScrollbarStyles;
      delete window._fixedElements;
    }

    return true;
  };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: func
  });

  return result.result;
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
async function addHeaderToScreenshot(canvas, tab) {
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

  return newCanvas;
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

// Clean URL for valid filename
function cleanUrlForFilename(url, maxLength = 100) {
  try {
    // Extract domain from URL
    let hostname = "";
    try {
      const urlObj = new URL(url);
      hostname = urlObj.hostname;

      // Add path if present, limit length
      if (urlObj.pathname && urlObj.pathname !== "/") {
        let path = urlObj.pathname.replace(/^\//, "");
        // Limit total length
        const availableLength = maxLength - hostname.length - 1;
        if (availableLength > 3 && path.length > availableLength) {
          path = path.substring(0, availableLength);
        }
        hostname += "_" + path;
      }
    } catch (e) {
      // If URL parsing fails, use raw URL
      hostname = url;
    }

    // Clean URL for a valid filename
    let cleanUrl = hostname
      .replace(/^www\./, "")                    // Remove www.
      .replace(/[^a-zA-Z0-9_\-.]/g, "_")       // Replace special chars with underscores
      .replace(/_{2,}/g, "_")                  // Reduce consecutive underscores
      .replace(/^_+|_+$/g, "");                // Remove leading/trailing underscores

    // Limit total length
    if (cleanUrl.length > maxLength) {
      cleanUrl = cleanUrl.substring(0, maxLength);
    }

    return cleanUrl;
  } catch (e) {
    console.error("Error cleaning URL for filename:", e);
    return "webpage";
  }
}

// Save screenshot to downloads folder
async function saveScreenshot(dataUrl, saveAs = true, useDownloadsFolder = false, url = "") {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  const cleanUrl = cleanUrlForFilename(url);
  const filename = `screenshot-${year}${month}${day}-${hours}${minutes}-${cleanUrl}.png`;

  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);

  try {
    let downloadId;

    if (useDownloadsFolder) {
      // Use default downloads folder
      downloadId = await downloadFile(blobUrl, filename, false, true);
    } else {
      // Use last folder or saveAs dialog
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
            part.toLowerCase() === 'downloads');

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
        // Try to extract downloads folder path
        const path = downloads[0].filename || '';
        if (path) {
          // Extract download folder path
          let downloadsPath = '';
          if (path.includes('/')) {
            const parts = path.split('/');
            parts.pop(); // Remove filename
            downloadsPath = parts.join('/');
          } else if (path.includes('\\')) {
            const parts = path.split('\\');
            parts.pop(); // Remove filename
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

// Get default font from the page
async function getDefaultFont(tab) {
  const func = () => {
    const bodyStyles = window.getComputedStyle(document.body);
    return bodyStyles.font || (bodyStyles.fontSize + ' ' + bodyStyles.fontFamily);
  };

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: func
    });

    return result.result || '14px Arial, sans-serif';
  } catch (error) {
    console.error("Error getting default font:", error);
    return '14px Arial, sans-serif';
  }
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
              let folderPath = '';

              if (download.filename.includes('/')) {
                const parts = download.filename.split('/');
                parts.pop();
                folderPath = parts.length > 0 ? parts[parts.length - 1] : '';

                if (!folderPath && parts.length > 0) {
                  folderPath = parts.join('/');
                }
              } else if (download.filename.includes('\\')) {
                const parts = download.filename.split('\\');
                parts.pop();
                folderPath = parts.length > 0 ? parts[parts.length - 1] : '';

                if (!folderPath && parts.length > 0) {
                  folderPath = parts.join('\\');
                }
              }

              if (folderPath) {
                console.log("Saving folder path:", folderPath);
                chrome.storage.local.set({
                  lastDownloadFolder: folderPath,
                  saveDestination: 'current'  // Auto-select current folder option
                });
              }
            }
          }

          chrome.storage.local.remove('pendingDownloadId');
        });
      }
    }
  });
});
