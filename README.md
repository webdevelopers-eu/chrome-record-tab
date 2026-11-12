# RecordTab

A Chrome extension that records the audio of a single browser tab to MP3.
The file is named after the page title, and when the title changes the
extension closes the current MP3 and starts a new one automatically.
Useful for recording radio shows, DJ sets, online talks, or any tab where the
title acts as a track or episode marker.

Author: Daniel Sevcik

## Features

- Records only the audio of one tab, not the microphone and not the whole system.
- MP3 output, encoded locally in the browser. Nothing is uploaded anywhere.
- File name comes from the page title, with a timestamp so nothing gets overwritten.
- Automatic file rollover when the page title changes (e.g. a new song or episode).
- Files are written straight into a folder you choose, via the browser's File System API.
- Works with keyboard shortcuts, a toolbar popup, and an optional JavaScript API for localhost pages.
- No build step, no npm install, no server. Plain JavaScript.

## Before you install: legal notes (read this)

**Recording audio may be illegal where you live, or against the terms of the
website you are recording.** This extension is a tool, like a tape recorder.
Using it is your responsibility.

1. **Check your local law.** Recording audio can require the consent of the
   rights holder and, in some countries, of every person in the recording.
   Copyright rules for music and broadcasts differ a lot between countries.
2. **Check the site's terms of service.** Many streaming sites explicitly
   forbid capturing or downloading their streams.
3. **Spotify and similar services.** Spotify's terms of service do not permit
   capturing or downloading audio from the service, and this includes
   recording a Spotify web player tab. Do not use this extension to record
   Spotify. The same applies to other subscription streaming services (Apple
   Music, Tidal, Deezer, YouTube Music, Audible, and similar) unless their
   terms allow it.
4. **Only record what you are allowed to record.** A good default rule: your
   own content, content you have a license for, public domain or openly
   licensed material, or content where the rights holder has given permission.

The author of this software does not condone or support copyright
infringement, terms-of-service violations, or any other unlawful use. See
[Disclaimer and limitation of liability](#disclaimer-and-limitation-of-liability).

## How it works (short version)

1. Chrome captures the audio of the tab you choose.
2. An offscreen document encodes it to MP3 with `lamejs`.
3. A recorder page (an ordinary browser tab opened by the extension) writes the
   finished MP3 into the folder you picked.

Nothing leaves your computer. There is no analytics, no network request, no
account, no telemetry.

## Installation

There is no Chrome Web Store listing yet, so you install the folder as an
"unpacked extension". This takes about two minutes.

You need:

- Google Chrome (or a Chromium-based browser) version 116 or newer.
- The `extension` folder from this repository.

Steps:

1. Download this repository. Either click **Code → Download ZIP** on GitHub and
   unzip it, or clone it:
   ```
   git clone git@github.com:webdevelopers-eu/chrome-record-tab.git
   ```
   (or `https://github.com/webdevelopers-eu/chrome-record-tab.git` if you have
   no SSH key set up)
2. Remember where the `extension` folder ended up. Use the `extension` folder
   itself, not the repository root: it is the folder that contains
   `manifest.json`.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** (switch in the top right corner).
5. Click **Load unpacked** and select the `extension` folder.
6. The extension is now installed. Click the puzzle-piece icon in the toolbar
   and pin **Tab Audio Recorder** so its icon is always visible.

Updating later: replace the files, then click the reload arrow on the
extension card in `chrome://extensions`.

### First run

1. Open the page you want to record (for example a radio stream).
2. Click the extension icon and press **Open recorder page…**.
3. On that page click **Choose folder…** and pick where the MP3s should go
   (for example a `Music/Recordings` folder). Chrome asks once for permission.
4. Go back to the page you want to record and press **Start recording** in the
   popup, or press `Alt+Shift+R`.

You can close the recorder page; the extension reopens it when it needs to save
a file. If the folder permission is revoked, pick the folder again.

## Usage

- **Start:** extension icon → **Start recording**, or `Alt+Shift+R`.
- **Stop:** extension icon → **Stop recording**, or `Alt+Shift+S`.
- **Open recorder page:** shows the save folder and the running file list.
- The red `REC` badge on the extension icon means a recording is running.
- Closing the recorded tab stops the recording and saves the last file.

### File naming

```
<page title> - <YYYY-MM-DD_HH-MM-SS>.mp3
```

Example: `Morning Jazz - 2026-11-12_09-14-03.mp3`

Characters that are illegal in file names are replaced, very long titles are
shortened, and Windows-reserved names get a suffix. When the page title changes,
the current file is finished and a new file with the new title starts. A title
change loses no audio; only stopping loses the last few milliseconds.

### Notes and limitations

- Chrome mutes the captured tab while recording; the extension routes the audio
  back to your speakers so you can still hear it.
- Only one recording can run at a time, and only for one tab.
- Chrome's internal pages (`chrome://…`, the Web Store, `devtools://…`) cannot
  be recorded. This is a Chrome restriction.
- MP3 bitrate is 128 kbps by default.
- If Chrome is closed while recording, the current file is lost.
- Recording quality is what the tab produces; the extension does not improve it.

## JavaScript API (optional, localhost only)

For automated setups (a local page that starts and stops recordings), the
extension injects `window.tabAudioRecorder` into pages served from
`http://localhost` and `http://127.0.0.1`. No extension ID and no messaging
code needed.

```js
await tabAudioRecorder.capabilities();  // version + current session
await tabAudioRecorder.start();         // starts recording this tab
await tabAudioRecorder.state();         // { session }
await tabAudioRecorder.stop();          // stops and saves
await tabAudioRecorder.folder();        // asks for / reuses the save folder
```

A page can only control its own tab. The first start may fail with a gesture
error: Chrome requires one click on the extension icon (or `Alt+Shift+R`) for
that tab before a page-initiated capture is allowed.

## Project structure

```
extension/
  manifest.json      Manifest V3 definition, permissions, shortcuts
  background.js      Service worker: session state, tab capture, file routing
  offscreen.html/js  MP3 encoder; holds the MediaStream and blob URLs
  recorder.html/js   Folder picker and file writer (File System Access API)
  popup.html/js      Toolbar popup: start, stop, open recorder page
  bridge.js          Isolated-world content script for the page API
  page-api.js        MAIN-world content script defining window.tabAudioRecorder
  session.js         Session and title-rollover logic
  naming.js          File name sanitizing and timestamping
  vendor/lame.min.js MP3 encoder (lamejs, LGPL-3.0)
```

## License

The project code is released under the [MIT License](LICENSE). That is the most
permissive widely used open source license, and it is compatible with the one
LGPL component.

The bundled MP3 encoder `extension/vendor/lame.min.js` (`lamejs`, a port of
libmp3lame) is licensed under **LGPL-3.0**, not MIT. It is included unmodified
or in its original minified form as a separate file, so it can be replaced with
another build of the same library. Full texts:

- [licenses/LGPL-3.0.txt](licenses/LGPL-3.0.txt)
- [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt) (required by LGPL-3.0)

Details and third-party attribution: [NOTICE.md](NOTICE.md).

## Disclaimer and limitation of liability

This software is provided "as is", without warranty of any kind, express or
implied, including but not limited to the warranties of merchantability,
fitness for a particular purpose and noninfringement.

To the maximum extent permitted by applicable law, the author and copyright
holder take **no responsibility and assume no liability** for:

- any use of this software that violates copyright, neighbouring rights,
  database rights, privacy law, or any other law;
- any use that violates a website's or service's terms and conditions,
  including recording streams from Spotify or any other streaming service;
- any loss of data, including recordings lost because Chrome was closed,
  because a folder permission was revoked, or because of a crash;
- any direct, indirect, incidental, special, exemplary, or consequential
  damages arising from the use of or inability to use this software.

You, the user, are solely responsible for how you use this software and for
obtaining any permission or license required for the audio you record. If you
do not agree with this, do not install or use the software.

Nothing in this document is legal advice. If you are unsure whether a specific
recording is allowed, ask a lawyer or simply do not record it.
