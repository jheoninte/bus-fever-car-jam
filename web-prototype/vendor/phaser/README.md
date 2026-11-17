# Phaser 3.80.1

Runtime and MIT license copied from the official npm package. `manifest.json` records the package archive SHA-512 and the SHA-256 of each included file. The download script checks the pinned archive integrity before extracting these two files.

The files are checked in, so playing, checking, and building the game do not download Phaser. Regenerate only when intentionally refreshing the vendor copy:

```sh
npm run vendor:phaser
```

Regeneration requires network access, Node.js 18+, and `tar`. Normal development requires Node.js 18+ and the files already in the repository. Preserve the exact file bytes across platforms; `.gitattributes` disables newline conversion for the two checksummed files.
