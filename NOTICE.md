# Third-party notices

This project includes the following third-party components.

## lamejs 1.2.1

- File: `extension/vendor/lame.min.js`
- Upstream: https://github.com/zhuker/lamejs
- Description: pure JavaScript MP3 encoder, a port of jump3r, which is a port
  of libmp3lame.
- License: **LGPL-3.0** (as declared by the upstream package)
- Modifications: none.
- Full license text: [licenses/LGPL-3.0.txt](licenses/LGPL-3.0.txt)
  and [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt).

Because the library is LGPL-3.0, parts of this work are derived from or
combined with code under LGPL-3.0. The library is kept in a separate,
unmodified file so that it can be replaced with a compatible version of the
same library. The rest of the project is licensed under the MIT License, see
[LICENSE](LICENSE).

To upgrade: download the desired build from the upstream repository and replace
`extension/vendor/lame.min.js`. No code changes are needed as long as the
`lamejs.Mp3Encoder` API stays the same.

## Chromium and Chrome APIs

The extension uses standard browser APIs and contains no Chromium code.
Chrome and Chromium are trademarks of Google LLC; this project is not
affiliated with, endorsed by, or sponsored by Google.
