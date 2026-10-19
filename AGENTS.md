# AGENTS.md

Working notes for AI agents (and humans) changing this repository. It records the
things that are **not** obvious from reading the code — the invariants that will
silently break if you get them wrong.

## What this is

A local desktop/CLI tool that fills Markdown articles into the editors of Chinese
content platforms (少数派 / 知乎 / 公众号 / 什么值得买 / 掘金 / X). It never clicks
"publish" — it fills the form and leaves the final click to the user.

## Commands

```bash
npm run lint        # ESLint over src/ electron/ test/ e2e/ brand/
npm run lint:fix    # same, auto-fixing what is mechanically fixable
npm test            # node --test (unit)
npm run check       # lint + unit tests — run this before claiming done
npm run gui         # GUI server on 127.0.0.1:9870
npm run web:build   # tsc --noEmit + vite build into src/public/
npm run test:e2e    # launches real Electron (needs a desktop session)
npm run dist        # package the current OS
```

`web/` has its own `package.json`; install it separately (`npm run web:install`,
or `npm run web:ci` for the lockfile-pinned variant the CI uses).

## Invariants that will bite you

**`src/public/` is a committed build artifact.** `npm run web:build` overwrites it
and the result is meant to be committed. If you change anything under `web/`, you
must rebuild and commit `src/public/` too — otherwise the packaged app ships stale
UI while the source looks correct.

**The GUI server binds loopback only.** `src/gui.js` listens on `HOST`
(default `127.0.0.1`) and rejects any `/api` request carrying a non-local
`Origin`. The API has **no authentication**: it can browse the filesystem,
publish drafts, drive the logged-in Chrome, and shut the app down. Do not widen
the bind or drop the Origin check without treating it as a security change.
`HOST=0.0.0.0` is an explicit, warned-about opt-in.

**Electron identifies its own server by token.** `electron/main.cjs` generates a
per-boot `MDPUB_TOKEN`, passes it to the `src/gui.js` child, and only opens the
window after `/api/handshake` answers 200 with that token (or the child's
`listening` message echoes it). This is what stops a port collision from loading a
foreign page into a window that carries the app preload. Don't "simplify" the
fallback back to a plain `GET /`.

**Publishing is serialised and user-initiated.** Never add an auto-publish step,
and never call a platform's "发布/确定并发布" button. The whole product promise is
that the last click is the user's.

**Platform modules must never throw on cover/formatting failures.** Each platform
catches its own cover path and returns a boolean; a failed cover still counts as a
successful publish. Only infrastructure failures (login, navigation, editor not
found) should reject.

## Frontmatter

`src/parser.js` has its own frontmatter splitter. It replaced `gray-matter`,
which is unmaintained and pinned an EOL `js-yaml@3` whose CLI chain
(argparse → sprintf-js) carried an unfixed DoS advisory. It reads the `---` block
with `js-yaml` directly.

Deliberate behaviours to preserve:
- Malformed YAML **throws** (so the file is reported and skipped) rather than
  silently publishing an article with dropped metadata.
- An empty `---`/`---` block is valid frontmatter meaning "no keys". `loadYaml('')`
  throws, so the body must not be handed an empty string.
- The closing fence regex needs the `m` flag — without it `^` anchors to the start
  of the string and a non-empty block is never found.
- A `---` in the body is not a fence; only the first line after the opening fence
  closes it.

## The X platform is the fragile one

`src/platforms/x.js` drives DraftJS through React internals
(`__reactFiber`, `memoizedProps.editorState`). Things that are easy to break:

- **Positional pairing.** `replaceMarkers` maps images to markers by *position*.
  A phantom "image inserted" therefore shifts every later image into the wrong
  slot. That is why `insertImage` verifies the image count actually grew and
  throws otherwise — do not remove that check.
- **The rotation invariant.** DraftJS leaves the *first* uploaded image last and
  the rest in upload order, so a single `unshift(pop())` restores order for any N.
  This is pinned by the n=3 cases in `test/x-platform.test.js`; if you
  change the rotation, those tests are the thing that will tell you.
- **`replaceMarkers` takes the selector that actually matched** in Phase 1. It
  must not hardcode `[data-testid="composer"]`.
- If positioning fails, the article is reported as **not** successful — the raw
  `___IMG_n___` markers are still in the document.

`test/x-platform.test.js` tests a *replica* of the loop, not the product
(the real one runs inside `page.evaluate` and cannot be imported). If you touch
that algorithm, keep the replica byte-faithful or extract the loop into a pure
module.

## Platform selectors

Selectors for remote sites live in `src/config.js` (login checks) and inside each
platform module (editor/upload flows). They go stale silently. The failure mode
to watch for is **false success**, not a crash — which is why the newer code paths
verify an outcome (image count, preview rendered, dialog closed) rather than
assuming. Prefer verifying over trusting.

## Conventions

- Backend is ESM (`"type": "module"`); Electron shell is CommonJS (`.cjs`).
- Comments explain **why**, especially when behaviour was chosen to work around a
  platform quirk. If you change such behaviour, update the comment and, where it
  is an assumption about a third party, say that it was not re-verified.
- User-facing strings are Chinese; the established word for an article is 「稿件」.
- Do not commit `settings.json`, `user-data/`, `.uploads/`, or `release/`.
- Commit messages: Conventional Commits, English, no AI attribution lines.

## Brand assets are rendered by the html-shot skill, not by a local script

`brand/` is a self-contained source folder (its own `fonts/` and `icons/`), and the
committed PNGs are produced by the **html-shot** skill. There is deliberately no
`brand/render.mjs` — it used to be a hand-rolled copy of the skill's own engine,
including its own `png-to-ico` / `png2icons` dependencies. To regenerate:

```bash
SKILL=<html-shot skill dir>          # reports its own path when loaded
node $SKILL/render.mjs brand/social-card.html brand/social-card.png
mkdir -p build
node $SKILL/icons.mjs brand/logo.svg build --preset electron \
     --small brand/logo-mark-small.svg
```

`--preset electron` writes `build/icon.ico` · `build/icon.icns` · `build/icon.png`(1024)
— exactly the three files electron-builder consumes. `--small` gives the 16/32px
`.ico` entries a simpler drawing, which is what keeps them legible.

**The mark's geometry lives in five places and must be changed together:**

| Where | Which |
| --- | --- |
| `brand/logo.svg` | the main mark — source of truth |
| `brand/logo-mark-small.svg` | simplified variant for 16/32px |
| `brand/social-card.html` | inlined into the card |
| `web/index.html` | favicon, as a `data:` URI (cannot be generated from the SVG) |
| `web/src/components/BrandMark.tsx` | `BrandMark`, rendered in the app header |

There is no build step that keeps them in sync. Changing one and not the others
is exactly how this repo ended up showing three different marks across the
README, the favicon and the app header — if you redesign the mark, update all
five in the same commit.

**Read the PNG back after rendering.** The renderer reports missing assets on
stderr and exits non-zero, but only the image shows a font that silently fell
back or a mark clipped off the canvas. `brand/` being self-contained is what makes
this work: html-shot serves only the HTML's own directory (plus `--base`), so a
`../` reference to `web/node_modules` is refused rather than silently substituted.

## The README hero image goes stale before anything else

`docs/images/hero.png` is the first-screen screenshot of the GUI. Text changes
get updated along with the code; a screenshot does not — **re-shoot it whenever
the UI changes**, otherwise the README shows controls that no longer exist.

```bash
node tools/capture-hero.mjs <一个装了几篇 .md 的目录> docs/images/hero.png [publish|settings]
```

The optional third argument picks the top-level tab to show — the settings view
is only reachable by switching to it, so a shot without it can never verify
changes made there.

It launches the real app against a throwaway userData dir, so it never touches
your real settings or browser profile. Keep the aspect ratio wide: the README
renders the image at the full column width, so a tall shot pushes the first body
paragraph off the first screen. **Do not widen the viewport to chase a wider
ratio** — the shell has a max content width, so a wider window only adds
whitespace and cuts the shot.

`brand/social-card.png` is a *different* asset for a *different* job — the
social card, uploaded by hand in Settings → Social preview. Redrawing it does
**not** change what GitHub shows until it is re-uploaded there (`gh` cannot set
it).

## Before you finish

Run `npm run check` and `npm run web:build`. If you touched `electron/` or
packaging, `npm run test:e2e` needs a real desktop session and is worth running.
