# Package Audit: pi-themes-rose-pine@0.1.0

Date: 2026-07-04

Decision: ADOPT BY VENDORING THEME JSON ONLY.

Helix vendors the three theme JSON files with `helix-`-prefixed theme names and
preserves the upstream MIT license. Helix does not auto-install the npm package
at project startup.

## Source

- Pi package page: https://pi.dev/packages/pi-themes-rose-pine?page=59
- npm registry package: `pi-themes-rose-pine@0.1.0`
- npm tarball:
  `https://registry.npmjs.org/pi-themes-rose-pine/-/pi-themes-rose-pine-0.1.0.tgz`

## Commands

```bash
npm view pi-themes-rose-pine@0.1.0 name version license dependencies peerDependencies dist.unpackedSize dist.tarball --json
npm view pi-themes-rose-pine@0.1.0 dist --json
npm pack pi-themes-rose-pine@0.1.0 --pack-destination /tmp/helix-rose-pine-audit --json
```

## Registry Facts

- Version: `0.1.0`
- License: `MIT`
- Dependencies: none reported
- Peer dependencies: none reported
- File count: `6`
- Unpacked size: `8821`
- Shasum: `6ada4fd3f8620938a11b7c5c92acf4e17fbad987`
- Integrity:
  `sha512-kYqkn/vt8SM9TG3nv3lrVKji9f+oJ9N/Y/BSSQpKfNxz7jPG9VkV3Wa4/eh0qwmsDPw0S8qwEinsAuXh9BTStA==`

## Tarball Inventory

```text
LICENSE
README.md
package.json
themes/rose-pine.json
themes/rose-pine-dawn.json
themes/rose-pine-moon.json
```

The tarball contains no JavaScript entrypoint, install scripts, runtime
dependencies, or network-capable code. The package manifest only declares:

```json
{
  "pi": {
    "themes": [
      "./themes"
    ]
  }
}
```

## Local Modifications

- `rose-pine` -> `helix-rose-pine`
- `rose-pine-moon` -> `helix-rose-pine-moon`
- `rose-pine-dawn` -> `helix-rose-pine-dawn`
- Theme schema URL updated from the package's older repository path to Pi's
  current documented schema URL.

No palette values were changed.
