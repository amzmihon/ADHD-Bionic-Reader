chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-bionic-text",
    title: "Read Bionic Text",
    contexts: ["selection"]
  });
});

let currentSpeechQueue = [];
let isSpeaking = false;
let playbackGeneration = 0;

function saveState() {
  chrome.storage.session.set({ currentSpeechQueue, isSpeaking, playbackGeneration });
}

function loadState() {
  chrome.storage.session.get(['currentSpeechQueue', 'isSpeaking', 'playbackGeneration'], (result) => {
    if (result.currentSpeechQueue) currentSpeechQueue = result.currentSpeechQueue;
    if (result.isSpeaking !== undefined) isSpeaking = result.isSpeaking;
    if (result.playbackGeneration) playbackGeneration = result.playbackGeneration;
    
    if (isSpeaking && currentSpeechQueue.length > 0) {
      processTTSQueue(playbackGeneration);
    }
  });
}

loadState();

function splitIntoSentences(text) {
  return text.match(/[^.?!]+[.?!]+(?=\s|$)|[^.?!]+$/g) || [text];
}

function processTTSQueue(generation) {
  if (currentSpeechQueue.length === 0) {
    isSpeaking = false;
    saveState();
    return;
  }
  
  isSpeaking = true;
  const { text, rate, lang } = currentSpeechQueue.shift();
  saveState();
  
  chrome.tts.speak(text.trim(), {
    rate: rate || 1.0,
    lang: lang,
    enqueue: false,
    onEvent: (event) => {
      if (generation !== playbackGeneration) return;

      if (event.type === 'end' || event.type === 'interrupted' || event.type === 'cancelled' || event.type === 'error') {
        if (event.type === 'end') {
          processTTSQueue(generation);
        } else {
          currentSpeechQueue = [];
          isSpeaking = false;
          saveState();
        }
      }
    }
  });
}

function playTTS(text, rate, lang) {
  chrome.tts.stop();
  currentSpeechQueue = [];
  playbackGeneration++;
  const currentGen = playbackGeneration;
  saveState();
  
  const sentences = splitIntoSentences(text);
  sentences.forEach(sentence => {
    if (sentence.trim().length > 0) {
      currentSpeechQueue.push({ text: sentence, rate, lang });
    }
  });
  
  processTTSQueue(currentGen);
}

function stopTTS() {
  currentSpeechQueue = [];
  isSpeaking = false;
  saveState();
  chrome.tts.stop();
}

function handleTTSRequest(text, rate) {
  chrome.i18n.detectLanguage(text, (result) => {
    let detectedLangCode = 'en-US';
    if (result && result.languages && result.languages.length > 0) {
      detectedLangCode = result.languages[0].language;
    }
    playTTS(text, rate, detectedLangCode);
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-bionic-text" && info.selectionText) {
    chrome.storage.sync.get({ voiceSpeed: 1.0 }, (settings) => {
      handleTTSRequest(info.selectionText, settings.voiceSpeed);
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PLAY_TTS" && request.text) {
    handleTTSRequest(request.text, request.rate);
  } else if (request.action === "STOP_TTS") {
    stopTTS();
  }
});
