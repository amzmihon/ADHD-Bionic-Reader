// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  fixationRatio: 0.4,
  bionicBoldness: 1.2,
  blacklist: [],
  showFloatingTTS: true,
  voiceSpeed: 1.0,
  allowedScripts: ['Latin'],
  primaryMode: 'light',
  focusEnabled: false,
  bwEnabled: false,
  hcEnabled: false,
  nightLightEnabled: false,
  adhdEnabled: false,
  readerModeEnabled: false
};

let currentSettings = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let observer = null;
let lastUrl = location.href;

// Performance Optimization: Queue for debouncing and yielding
let pendingNodes = new Set();
let debounceTimeout = null;

// Floating TTS UI Elements
let ttsHost = null;
let ttsShadow = null;
let ttsContainer = null;
let currentSelectedText = "";

function setupTTSUI() {
  if (ttsHost) return;
  ttsHost = document.createElement('bionic-tts-host');
  // Position absolutely out of the way initially
  ttsHost.style.position = 'absolute';
  ttsHost.style.top = '-9999px';
  ttsHost.style.left = '-9999px';
  ttsHost.style.zIndex = '2147483647';
  ttsHost.style.display = 'none';

  // Phase 5: Complete Isolation via Shadow DOM
  ttsShadow = ttsHost.attachShadow({ mode: 'closed' });
  
  ttsContainer = document.createElement('div');
  ttsContainer.innerHTML = `
    <style>
      .tts-btn {
        background: #2196F3;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        margin-right: 4px;
        display: inline-flex;
        align-items: center;
        transition: 0.2s;
      }
      .tts-btn.stop {
        background: #f44336;
      }
      .tts-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      }
      .wrapper {
        display: flex;
        animation: slideUp 0.2s ease-out;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-color-scheme: dark) {
        .tts-btn { box-shadow: 0 2px 6px rgba(0,0,0,0.6); }
      }
    </style>
    <div class="wrapper">
      <button class="tts-btn play">▶ Play</button>
      <button class="tts-btn stop">■ Stop</button>
    </div>
  `;
  
  ttsShadow.appendChild(ttsContainer);
  document.documentElement.appendChild(ttsHost);

  ttsContainer.querySelector('.play').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      action: "PLAY_TTS", 
      text: currentSelectedText,
      rate: currentSettings.voiceSpeed
    });
  });

  ttsContainer.querySelector('.stop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "STOP_TTS" });
  });

  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('mousedown', (e) => {
    // Hide UI if clicked outside
    if (e.target !== ttsHost) {
      hideTTSUI();
    }
  });
  
  // Recalculate floating UI position on scroll
  window.addEventListener('scroll', handleScroll, { passive: true });
}

let scrollAF = null;
function handleScroll() {
  if (ttsHost && ttsHost.style.display !== 'none' && currentSelectedText) {
    if (scrollAF) cancelAnimationFrame(scrollAF);
    scrollAF = requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (selection.rangeCount > 0 && selection.toString().trim() === currentSelectedText) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          hideTTSUI();
        } else {
          ttsHost.style.top = `${window.scrollY + rect.bottom + 8}px`;
          let left = window.scrollX + rect.left;
          if (left + 150 > window.innerWidth) left = window.innerWidth - 150;
          ttsHost.style.left = `${left}px`;
        }
      } else {
        hideTTSUI();
      }
    });
  }
}

function handleSelection(e) {
  if (!currentSettings.showFloatingTTS || !currentSettings.enabled) return;
  if (e.target === ttsHost) return;

  setTimeout(() => {
    const selection = window.getSelection();
    currentSelectedText = selection.toString().trim();
    
    if (currentSelectedText.length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      ttsHost.style.display = 'block';
      ttsHost.style.top = `${window.scrollY + rect.bottom + 8}px`;
      
      // Keep it within screen bounds
      let left = window.scrollX + rect.left;
      if (left + 150 > window.innerWidth) left = window.innerWidth - 150;
      ttsHost.style.left = `${left}px`;
    } else {
      hideTTSUI();
    }
  }, 10);
}

function hideTTSUI() {
  if (ttsHost) {
    ttsHost.style.display = 'none';
  }
}

function getBoldLength(word) {
  if (word.length <= 1) return word.length;

  let boldLength = 0;
  if (word.length <= 3) {
    boldLength = 1;
  } else if (word.length === 4) {
    boldLength = 2;
  } else {
    boldLength = Math.ceil(word.length * currentSettings.fixationRatio);
  }

  if (boldLength === 0) boldLength = 1;
  return boldLength;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'TR', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'DD', 'DT', 'DL', 'HR']);

// CSS Custom Highlight API — zero DOM mutation, SPA-safe
// Graceful degradation: fall back to no bolding on unsupported browsers
const HIGHLIGHT_SUPPORTED = (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined');
const bionicHighlight = HIGHLIGHT_SUPPORTED ? new Highlight() : null;
if (bionicHighlight) CSS.highlights.set('bionic-highlight', bionicHighlight);

// Track ranges per subtree root for surgical cleanup
const rangesByRoot = new WeakMap();
// Track which nodes have been processed to avoid re-processing
const processedRoots = new WeakSet();

function processNode(node) {
  if (!currentSettings.enabled) return;
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Clear any existing ranges for this subtree before re-processing
    clearRangesForNode(node);

    const scripts = currentSettings.allowedScripts || ['Latin'];
    let regexPattern;
    if (scripts.includes('Experimental (All other scripts)')) {
      regexPattern = `(?:[\\p{L}\\p{N}]+)`;
    } else {
      const scriptPattern = scripts.map(s => `\\p{Script=${s}}`).join('');
      regexPattern = `(?:[${scriptPattern}\\p{N}]+)`;
    }
    const compiledRegex = new RegExp(regexPattern, 'gu');

    let virtualText = "";
    const nodeMap = [];

    function traverse(curr) {
      if (curr.nodeType === Node.ELEMENT_NODE) {
        const tag = curr.tagName;
        if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'CODE', 'PRE', 'BIONIC-TTS-HOST', 'ADHD-BORDER-HOST'].includes(tag)) return;

        const isBlock = BLOCK_TAGS.has(tag) || tag === 'BR';
        if (isBlock) virtualText += " ";
        
        for (let child of curr.childNodes) {
          traverse(child);
        }
        
        if (isBlock) virtualText += " ";
      } else if (curr.nodeType === Node.TEXT_NODE) {
        if (curr.nodeValue.trim() !== '') {
          const start = virtualText.length;
          virtualText += curr.nodeValue;
          nodeMap.push({
            node: curr,
            start: start,
            end: virtualText.length
          });
        } else {
          virtualText += curr.nodeValue;
        }
      }
    }

    traverse(node);

    const boldRanges = [];
    let match;
    while ((match = compiledRegex.exec(virtualText)) !== null) {
      const word = match[0];
      const boldLen = getBoldLength(word);
      boldRanges.push({
        start: match.index,
        end: match.index + boldLen
      });
    }

    let rangeIndex = 0;
    const rangesByParent = new Map();

    nodeMap.forEach(item => {
      const { node: textNode, start, end } = item;
      const textLen = textNode.textContent.length;
      
      while (rangeIndex < boldRanges.length && boldRanges[rangeIndex].end <= start) {
        rangeIndex++;
      }
      
      let currRangeIdx = rangeIndex;
      while (currRangeIdx < boldRanges.length && boldRanges[currRangeIdx].start < end) {
        const r = boldRanges[currRangeIdx];
        const localStart = Math.max(0, r.start - start);
        const localEnd = Math.min(textLen, r.end - start);
        
        // GC Safety: Validate bounds before creating Range
        if (localStart < textLen && localEnd <= textLen && localStart < localEnd && bionicHighlight) {
          try {
            const range = new Range();
            range.setStart(textNode, localStart);
            range.setEnd(textNode, localEnd);
            bionicHighlight.add(range);
            
            const parentEl = textNode.parentElement;
            if (parentEl) {
              if (!rangesByParent.has(parentEl)) {
                rangesByParent.set(parentEl, new Set());
              }
              rangesByParent.get(parentEl).add(range);
            }
          } catch (e) {
            // Silently skip invalid ranges (node was removed by SPA)
          }
        }
        
        currRangeIdx++;
      }
    });

    // Track ranges for each parent element for future cleanup
    rangesByParent.forEach((ranges, parentEl) => {
      const existingRanges = rangesByRoot.get(parentEl);
      if (existingRanges) {
        ranges.forEach(r => existingRanges.add(r));
      } else {
        rangesByRoot.set(parentEl, ranges);
      }
      processedRoots.add(parentEl);
    });

  } finally {
    isProcessing = false;
  }
}

function clearRangesForNode(node) {
  const ranges = rangesByRoot.get(node);
  if (ranges && bionicHighlight) {
    ranges.forEach(range => {
      try { bionicHighlight.delete(range); } catch (e) {}
    });
    rangesByRoot.delete(node);
  }
  processedRoots.delete(node);
}

// Memory and Performance Management
function queueNodeForProcessing(node) {
  pendingNodes.add(node);
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(processQueue, 150);
}

function processQueue() {
  if (pendingNodes.size === 0) return;
  const nodesToProcess = Array.from(pendingNodes);
  pendingNodes.clear();

  if ('requestIdleCallback' in window) {
    requestIdleCallback((deadline) => {
      processNodesIdle(nodesToProcess, deadline);
    });
  } else {
    nodesToProcess.forEach(n => processNode(n));
  }
}

function processNodesIdle(nodes, deadline) {
  while (nodes.length > 0 && deadline.timeRemaining() > 0) {
    const node = nodes.shift();
    if (document.body && document.body.contains(node)) {
      processNode(node);
    }
  }
  
  if (nodes.length > 0) {
    requestIdleCallback((newDeadline) => {
      processNodesIdle(nodes, newDeadline);
    });
  }
}

function undoBionicInNode(node) {
  clearRangesForNode(node);
}

function undoBionic() {
  if (bionicHighlight) bionicHighlight.clear();
  // WeakMap entries will be GC'd automatically
}

function checkUrlChange() {
  if (lastUrl !== location.href) {
    lastUrl = location.href;
    const isBlacklisted = currentSettings.blacklist.includes(window.location.hostname);
    
    if (isBlacklisted || !currentSettings.enabled) {
      pendingNodes.clear();
      undoBionic();
      hideTTSUI();
    } else {
      if (document.body) processNode(document.body);
    }
  }
}

function injectStyles(settings) {
  let style = document.getElementById('bionic-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'bionic-styles';
    if (document.head) document.head.appendChild(style);
  }
  
  const strokeWidth = settings ? settings.bionicBoldness : 1.2;
  
  style.textContent = `
    ::highlight(bionic-highlight) {
      /* Chromium ignores font-weight in ::highlight() to prevent layout shifts. 
         We simulate bolding using a sub-pixel stroke and shadow. */
      -webkit-text-stroke: ${strokeWidth}px currentColor !important;
      text-shadow: 0 0 1px currentColor !important;
    }
  `;
  if (document.body) document.body.classList.toggle('bionic-force-repaint');
}

let ioSoft = null;
let ioHard = null;

function startObserver() {
  if (observer) return;
  
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', startObserver);
    return;
  }

  injectStyles(currentSettings);

  if (!ioSoft) {
    ioSoft = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          // Soft tier: clear ranges to reduce paint cost
          clearRangesForNode(entry.target);
          entry.target.dataset.bionicPaused = "true";
        } else {
          if (entry.target.dataset.bionicPaused === "true") {
            entry.target.dataset.bionicPaused = "false";
            queueNodeForProcessing(entry.target);
          }
        }
      });
    }, {
      rootMargin: "2000px 0px 2000px 0px"
    });
  }

  if (!ioHard) {
    ioHard = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          clearRangesForNode(entry.target);
          entry.target.dataset.bionicDestroyed = "true";
        }
      });
    }, {
      rootMargin: "10000px 0px 10000px 0px"
    });
  }

  observer = new MutationObserver((mutations) => {
    checkUrlChange();
    
    if (!currentSettings.enabled || currentSettings.blacklist.includes(window.location.hostname)) return;

    const topLevelNodes = new Set();
    const textNodesToReprocess = new Set();

    mutations.forEach(mutation => {
      // Eager GC: Clean up ranges for nodes removed from the DOM, including all descendants
      mutation.removedNodes.forEach(removedNode => {
        if (removedNode.nodeType === Node.ELEMENT_NODE) {
          clearRangesForNode(removedNode);
          // Deep GC: traverse subtree
          removedNode.querySelectorAll('*').forEach(childNode => {
            clearRangesForNode(childNode);
          });
        }
      });

      // Track new element nodes for processing
      mutation.addedNodes.forEach(addedNode => {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          if (addedNode.tagName === 'HEAD' || addedNode.tagName === 'BIONIC-TTS-HOST' || addedNode.tagName === 'ADHD-BORDER-HOST' || (document.head && document.head.contains(addedNode))) return;
          if (!processedRoots.has(addedNode)) {
            topLevelNodes.add(addedNode);
          }
        }
      });

      // Handle characterData mutations (silent text swaps by React/i18n)
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        const parentEl = mutation.target.parentElement;
        if (parentEl && parentEl.closest && !parentEl.closest('script, style, textarea, input, noscript, code, pre, bionic-tts-host, adhd-border-host')) {
          textNodesToReprocess.add(parentEl);
        }
      }
    });

    // Re-process parents of mutated text nodes
    textNodesToReprocess.forEach(parentEl => {
      clearRangesForNode(parentEl);
      queueNodeForProcessing(parentEl);
    });

    const filteredNodes = Array.from(topLevelNodes).filter(node => {
      let parent = node.parentNode;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (topLevelNodes.has(parent)) return false;
        parent = parent.parentNode;
      }
      return true;
    });

    filteredNodes.forEach(node => {
      if (ioSoft) ioSoft.observe(node);
      if (ioHard) ioHard.observe(node);
      queueNodeForProcessing(node);
    });
  });
  
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (ioSoft) {
    ioSoft.disconnect();
    ioSoft = null;
  }
  if (ioHard) {
    ioHard.disconnect();
    ioHard = null;
  }
  pendingNodes.clear();
}

// ============================================================
// VISUAL ENVIRONMENT ENGINE (Completely Isolated from Bionic)
// Patterns adapted from: DarkReader (MIT), AccessibleWeb Widget (MIT), Sienna (MIT)
// ============================================================

let adhdBorderHost = null;

function applyVisualSettings(settings) {
  // CRITICAL CLEANUP: Always tear down ADHD overlays first
  removeADHDOverlays();

  const mode = settings.primaryMode || 'light';
  
  if (typeof DarkReader !== 'undefined') {
    let isDarkReaderNeeded = false;
    let theme = {
      brightness: 100,
      contrast: settings.hcEnabled ? 150 : 100,
      sepia: settings.nightLightEnabled ? 40 : 0,
      grayscale: settings.bwEnabled ? 100 : 0,
      mode: (mode === 'gray' || mode === 'black') ? 1 : 0
    };

    if (mode === 'gray') {
      theme.darkSchemeBackgroundColor = '#363636';
      theme.darkSchemeTextColor = '#e8e6e3';
    } else if (mode === 'black') {
      theme.darkSchemeBackgroundColor = '#000000';
      theme.darkSchemeTextColor = '#e8e6e3';
    }

    if (mode === 'gray' || mode === 'black' || settings.bwEnabled || settings.nightLightEnabled || settings.hcEnabled) {
      isDarkReaderNeeded = true;
    }

    if (isDarkReaderNeeded) {
      DarkReader.enable(theme);
    } else {
      DarkReader.disable();
    }
  }

  // Focus: AccessibleWeb pattern (modified — opacity instead of display:none)
  let focusStyleEl = document.getElementById('adhd-focus-engine');
  if (settings.focusEnabled) {
    if (!focusStyleEl) {
      focusStyleEl = document.createElement('style');
      focusStyleEl.id = 'adhd-focus-engine';
      if (document.head) document.head.appendChild(focusStyleEl);
    }
    focusStyleEl.textContent = `
      img, video, iframe, canvas, svg, picture {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
  } else if (focusStyleEl) {
    focusStyleEl.remove();
  }

  // ADHD: Peripheral breathing animation via Shadow DOM
  if (settings.adhdEnabled) {
    setupADHDOverlays();
  }
}

function setupADHDOverlays() {
  if (adhdBorderHost) return;
  adhdBorderHost = document.createElement('adhd-border-host');
  adhdBorderHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;';

  const shadow = adhdBorderHost.attachShadow({ mode: 'closed' });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .border-bar {
        position: fixed;
        background: linear-gradient(90deg, #000, #fff, #000);
        background-size: 200% 100%;
        animation: breathe 4s ease-in-out infinite;
        pointer-events: none;
        opacity: 0.35;
      }
      @keyframes breathe {
        0%, 100% { background-position: 0% 50%; opacity: 0.35; }
        50% { background-position: 100% 50%; opacity: 0.15; }
      }
      .top    { top: 0; left: 0; right: 0; height: 6px; }
      .bottom { bottom: 0; left: 0; right: 0; height: 6px; }
      .left   { top: 0; bottom: 0; left: 0; width: 6px; background: linear-gradient(180deg, #000, #fff, #000); background-size: 100% 200%; animation: breatheV 4s ease-in-out infinite; }
      .right  { top: 0; bottom: 0; right: 0; width: 6px; background: linear-gradient(180deg, #000, #fff, #000); background-size: 100% 200%; animation: breatheV 4s ease-in-out infinite; }
      @keyframes breatheV {
        0%, 100% { background-position: 50% 0%; opacity: 0.35; }
        50% { background-position: 50% 100%; opacity: 0.15; }
      }
    </style>
    <div class="border-bar top"></div>
    <div class="border-bar bottom"></div>
    <div class="border-bar left"></div>
    <div class="border-bar right"></div>
  `;
  shadow.appendChild(wrapper);
  document.documentElement.appendChild(adhdBorderHost);
}

function removeADHDOverlays() {
  if (adhdBorderHost) {
    adhdBorderHost.remove();
    adhdBorderHost = null;
  }
}

// ============================================================
// READER MODE ENGINE (Mozilla Readability)
// ============================================================

let readerModeOverlay = null;

function enableReaderMode() {
  if (readerModeOverlay || typeof Readability === 'undefined') return;

  const documentClone = document.cloneNode(true);
  let article;
  try {
    article = new Readability(documentClone).parse();
  } catch (e) {
    console.warn("Readability parsing failed", e);
    return;
  }
  
  if (!article) return;

  // Safely hide original body children without destroying DOM state (preserves SPA)
  Array.from(document.body.children).forEach(child => {
    if (child.id !== 'bionic-reader-overlay' && !child.tagName.includes('HOST')) {
      child.dataset.bionicOriginalDisplay = child.style.display || '';
      child.style.display = 'none';
    }
  });

  readerModeOverlay = document.createElement('div');
  readerModeOverlay.id = 'bionic-reader-overlay';
  
  // Clean, distraction-free styling that inherits Dark Reader automatically
  readerModeOverlay.innerHTML = `
    <style>
      #bionic-reader-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; min-height: 100vh;
        background-color: transparent;
        z-index: 2147483645; /* Below TTS and ADHD borders */
        padding: 40px 20px;
        box-sizing: border-box;
      }
      #bionic-reader-overlay .reader-content-wrapper {
        max-width: 800px;
        margin: 0 auto;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 18px;
        line-height: 1.6;
      }
      #bionic-reader-overlay h1 {
        font-size: 2.2em;
        margin-bottom: 0.5em;
        line-height: 1.2;
      }
      #bionic-reader-overlay img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 16px 0;
      }
      #bionic-reader-overlay hr {
        border: 0;
        border-top: 1px solid #ccc;
        margin: 32px 0;
      }
    </style>
    <div class="reader-content-wrapper">
      <h1>${article.title}</h1>
      <hr>
      ${article.content}
    </div>
  `;
  
  document.body.appendChild(readerModeOverlay);
  
  // The Bionic Text MutationObserver will automatically detect this new DOM node
  // and process it. TTS will work because it's standard text selection.
}

function disableReaderMode() {
  if (!readerModeOverlay) return;

  // Restore original body children
  Array.from(document.body.children).forEach(child => {
    if (child.dataset.bionicOriginalDisplay !== undefined) {
      child.style.display = child.dataset.bionicOriginalDisplay;
      delete child.dataset.bionicOriginalDisplay;
    }
  });

  readerModeOverlay.remove();
  readerModeOverlay = null;
}


// ============================================================
// SETTINGS LIFECYCLE
// ============================================================

function applySettingsAndRender(settings) {
  const previousSettings = { ...currentSettings };
  currentSettings = settings;

  // Update dynamic styles
  injectStyles(currentSettings);

  // Visual Environment Engine (isolated)
  applyVisualSettings(currentSettings);

  const isBlacklisted = currentSettings.blacklist.includes(window.location.hostname);
  const shouldBeActive = currentSettings.enabled && !isBlacklisted;
  const wasBlacklisted = previousSettings.blacklist && previousSettings.blacklist.includes(window.location.hostname);
  const wasActive = previousSettings.enabled && !wasBlacklisted;

  if (shouldBeActive) {
    // Reader Mode logic
    if (currentSettings.readerModeEnabled) {
      enableReaderMode();
    } else {
      disableReaderMode();
    }

    const scriptsChanged = JSON.stringify(previousSettings.allowedScripts || ['Latin']) !== JSON.stringify(currentSettings.allowedScripts || ['Latin']);
    const fixationChanged = previousSettings.fixationRatio !== currentSettings.fixationRatio;
    const toggledOn = !wasActive;
    const readerModeChanged = previousSettings.readerModeEnabled !== currentSettings.readerModeEnabled;

    const needsHardUpdate = toggledOn || fixationChanged || scriptsChanged || readerModeChanged;
    
    if (needsHardUpdate) {
      undoBionic();
      pendingNodes.clear();
      if (document.body) {
        processNode(document.body);
      }
    }
    
    if (currentSettings.showFloatingTTS) {
      setupTTSUI();
    } else {
      hideTTSUI();
    }
    
    startObserver();
  } else {
    disableReaderMode();
    stopObserver();
    undoBionic();
    pendingNodes.clear();
    hideTTSUI();
  }
}

function init() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    applySettingsAndRender(settings);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ status: "ok" });
  } else if (request.action === "settings_updated" && request.settings) {
    applySettingsAndRender(request.settings);
  }
});

const originalPushState = history.pushState;
history.pushState = function() {
  originalPushState.apply(this, arguments);
  checkUrlChange();
};

const originalReplaceState = history.replaceState;
history.replaceState = function() {
  originalReplaceState.apply(this, arguments);
  checkUrlChange();
};

window.addEventListener('popstate', checkUrlChange);

init();

document.addEventListener('DOMContentLoaded', () => {
  const isBlacklisted = currentSettings.blacklist.includes(window.location.hostname);
  if (currentSettings.enabled && !isBlacklisted) {
    processNode(document.body);
    setupTTSUI();
  }
});
