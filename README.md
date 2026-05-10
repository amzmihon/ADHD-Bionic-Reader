# ADHD Bionic Reader Extension

A browser extension that boldens the first part of words to guide your eyes through text faster using the Bionic Reading method.

## Features
- **Bionic Reading Mode**: Automatically emboldens the start of words for quicker reading.
- **Focus & Accessibility**: Designed to help users with ADHD maintain focus and improve reading comprehension.
- **Text-to-Speech (TTS)**: Built-in support for reading text aloud.
- **Seamless Integration**: Works silently in the background across all your favorite websites.

## Installation (Developer Mode)
1. Clone this repository or download the source code.
2. Open Chrome (or any Chromium-based browser) and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click on the **Load unpacked** button.
5. Select the `ADHD_Bionic-Reader Extantion Unpacked Loader` directory from this project.
6. The extension is now active and ready to use!

## Permissions Used
- `storage`: For saving user preferences.
- `activeTab`: To interact with the currently active page.
- `tts`: To provide Text-to-Speech functionality.
- `contextMenus`: To add quick-access options to the right-click menu.

## Built With
- JavaScript (Service Workers, Content Scripts)
- HTML / Vanilla CSS
- Chrome Extensions API (Manifest V3)
