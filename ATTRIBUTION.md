# Attribution

## Assets

Every icon, image and screenshot in this repository was made for Daftar.

| Asset | Origin |
|---|---|
| `app/public/icon.svg` | Drawn for Daftar |
| `desktop/icon.png` | Rendered from `icon.svg` by `scripts/icon.ts` |
| `docs/images/*.png` | Screenshots of Daftar's sample company, made by `scripts/screenshots.ts` |

No fonts are bundled; the app uses the system's own fonts.

## Software

| Package | Licence | Used for |
|---|---|---|
| [Preact](https://preactjs.com) | MIT | The interface (shipped in the app) |
| [Electron](https://www.electronjs.org) | MIT | The desktop program (shipped in the installer) |
| [Vite](https://vite.dev), [@preact/preset-vite](https://github.com/preactjs/preset-vite) | MIT | Building the app |
| [electron-builder](https://www.electron.build) | MIT | Building the Windows installer |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Type checking |
| [Playwright](https://playwright.dev) (`playwright-core`) | Apache-2.0 | Screenshots and the desktop smoke test |

## Formats

QuickBooks IIF support follows Intuit's published description of the IIF format and files that
QuickBooks itself exports. QuickBooks is a trademark of Intuit Inc.; Daftar is not affiliated with
Intuit.
