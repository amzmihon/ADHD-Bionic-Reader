const DEFAULT_SETTINGS = {
  enabled: true,
  fixationRatio: 0.4,
  blacklist: [],
  showFloatingTTS: true,
  voiceSpeed: 1.0,
  allowedScripts: ['Latin'],
  primaryMode: 'light',
  focusEnabled: false,
  bwEnabled: false,
  hcEnabled: false,
  nightLightEnabled: false,
  adhdEnabled: false
};

let currentSettings = { ...DEFAULT_SETTINGS };

const enableToggle = document.getElementById('enable-toggle');
const fixationSlider = document.getElementById('fixation-slider');
const fixationValue = document.getElementById('fixation-value');
const ttsToggle = document.getElementById('tts-toggle');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const blacklistBtn = document.getElementById('blacklist-btn');
const currentDomainEl = document.getElementById('current-domain');

const cyrillicToggle = document.getElementById('cyrillic-toggle');
const greekToggle = document.getElementById('greek-toggle');
const experimentalToggle = document.getElementById('experimental-toggle');

// Primary Mode Radio Buttons
const modeLight = document.getElementById('mode-light');
const modeGray = document.getElementById('mode-gray');
const modeBlack = document.getElementById('mode-black');

// Additive Feature Checkboxes
const focusToggle = document.getElementById('focus-toggle');
const bwToggle = document.getElementById('bw-toggle');
const hcToggle = document.getElementById('hc-toggle');
const nightLightToggle = document.getElementById('nightlight-toggle');
const adhdToggle = document.getElementById('adhd-toggle');

let currentHostname = '';
let saveTimeout = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
      currentDomainEl.textContent = currentHostname;

      chrome.tabs.sendMessage(tab.id, { action: "ping" }).catch(() => {
        currentDomainEl.textContent = "⚠️ Extension disabled on this page";
        currentDomainEl.style.color = "#d32f2f";
        disableAllInputs();
      });
    } catch (e) {
      currentDomainEl.textContent = "Invalid URL";
      blacklistBtn.disabled = true;
    }
  } else {
    currentDomainEl.textContent = "Cannot access tab";
    blacklistBtn.disabled = true;
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    currentSettings = settings;
    enableToggle.checked = settings.enabled;
    fixationSlider.value = settings.fixationRatio * 100;
    fixationValue.textContent = `${fixationSlider.value}%`;
    ttsToggle.checked = settings.showFloatingTTS;
    speedSlider.value = settings.voiceSpeed;
    speedValue.textContent = `${settings.voiceSpeed}x`;

    const scripts = settings.allowedScripts || ['Latin'];
    cyrillicToggle.checked = scripts.includes('Cyrillic');
    greekToggle.checked = scripts.includes('Greek');
    experimentalToggle.checked = scripts.includes('Experimental (All other scripts)');

    // Hydrate primary mode radio buttons
    const mode = settings.primaryMode || 'light';
    if (mode === 'gray') modeGray.checked = true;
    else if (mode === 'black') modeBlack.checked = true;
    else modeLight.checked = true;

    // Hydrate additive feature checkboxes
    focusToggle.checked = settings.focusEnabled || false;
    bwToggle.checked = settings.bwEnabled || false;
    hcToggle.checked = settings.hcEnabled || false;
    nightLightToggle.checked = settings.nightLightEnabled || false;
    adhdToggle.checked = settings.adhdEnabled || false;

    updateBlacklistBtnUI(settings.blacklist.includes(currentHostname));
  });

  enableToggle.addEventListener('change', (e) => {
    currentSettings.enabled = e.target.checked;
    queueSaveSettings();
  });

  fixationSlider.addEventListener('input', (e) => {
    fixationValue.textContent = `${e.target.value}%`;
    currentSettings.fixationRatio = parseInt(e.target.value) / 100;
    queueSaveSettings();
  });

  ttsToggle.addEventListener('change', (e) => {
    currentSettings.showFloatingTTS = e.target.checked;
    queueSaveSettings();
  });

  speedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    speedValue.textContent = `${val}x`;
    currentSettings.voiceSpeed = parseFloat(val);
    queueSaveSettings();
  });

  function toggleScript(scriptName, isEnabled) {
    if (!currentSettings.allowedScripts) currentSettings.allowedScripts = ['Latin'];
    if (isEnabled) {
      if (!currentSettings.allowedScripts.includes(scriptName)) {
        currentSettings.allowedScripts.push(scriptName);
      }
    } else {
      currentSettings.allowedScripts = currentSettings.allowedScripts.filter(s => s !== scriptName);
    }
    queueSaveSettings();
  }

  cyrillicToggle.addEventListener('change', (e) => toggleScript('Cyrillic', e.target.checked));
  greekToggle.addEventListener('change', (e) => toggleScript('Greek', e.target.checked));
  experimentalToggle.addEventListener('change', (e) => toggleScript('Experimental (All other scripts)', e.target.checked));

  // Primary Mode Radio Buttons (mutually exclusive)
  document.querySelectorAll('input[name="primary-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentSettings.primaryMode = e.target.value;
      queueSaveSettings();
    });
  });

  // Additive Feature Checkboxes (combinable)
  focusToggle.addEventListener('change', (e) => {
    currentSettings.focusEnabled = e.target.checked;
    queueSaveSettings();
  });

  bwToggle.addEventListener('change', (e) => {
    currentSettings.bwEnabled = e.target.checked;
    queueSaveSettings();
  });

  hcToggle.addEventListener('change', (e) => {
    currentSettings.hcEnabled = e.target.checked;
    queueSaveSettings();
  });

  nightLightToggle.addEventListener('change', (e) => {
    currentSettings.nightLightEnabled = e.target.checked;
    queueSaveSettings();
  });

  adhdToggle.addEventListener('change', (e) => {
    currentSettings.adhdEnabled = e.target.checked;
    queueSaveSettings();
  });

  blacklistBtn.addEventListener('click', () => {
    const isBlacklisted = currentSettings.blacklist.includes(currentHostname);
    if (isBlacklisted) {
      currentSettings.blacklist = currentSettings.blacklist.filter(h => h !== currentHostname);
    } else {
      if (currentHostname) currentSettings.blacklist.push(currentHostname);
    }
    updateBlacklistBtnUI(!isBlacklisted);
    queueSaveSettings();
  });
}

function updateBlacklistBtnUI(isBlacklisted) {
  if (isBlacklisted) {
    blacklistBtn.textContent = "Enable on this site";
    blacklistBtn.classList.add('blacklisted');
  } else {
    blacklistBtn.textContent = "Disable on this site";
    blacklistBtn.classList.remove('blacklisted');
  }
}

function queueSaveSettings() {
  notifyActiveTab(currentSettings);
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    chrome.storage.sync.set(currentSettings);
  }, 250);
}

function notifyActiveTab(settingsPayload) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "settings_updated",
        settings: settingsPayload 
      }).catch(() => {
        currentDomainEl.textContent = "⚠️ Cannot modify this page";
        currentDomainEl.style.color = "#d32f2f";
        disableAllInputs();
      });
    }
  });
}

function disableAllInputs() {
  document.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
  document.querySelectorAll('.slider').forEach(el => {
    el.style.backgroundColor = '#eaeaea';
    el.style.cursor = 'not-allowed';
  });
}

document.addEventListener('DOMContentLoaded', init);
