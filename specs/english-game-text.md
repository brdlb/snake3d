# English game text

## Title and scope

Translate every user-facing in-game label and message to English, including the tutorial and document metadata presented when the game is shared or opened. Keep gameplay behavior, timing, and message flow unchanged.

## Planning anchor

- Anchor: `src/core/Game.ts` tutorial prompts and `src/ui/TutorialUI.ts` tutorial chrome.
- Connected surfaces: `index.html` page title/description/social metadata and `AGENTS.md` project rule.
- Existing room, pause, leaderboard, settings, network, and game-over UI strings are already English and require no wording changes.
- No existing localization specification covers this slice; this specification is the authoritative note for the change.

## Connected groups or observed existing logic

### Frontend user-facing text

- `Game` creates tutorial prompts and hints through `TutorialUI.show`; only the text values change.
- `TutorialUI` renders the tutorial heading and continue button; the callbacks and visibility behavior remain unchanged.
- `index.html` contains user-visible browser/social metadata and will be translated for language consistency.

### Validation

- Search runtime source and HTML for Cyrillic characters after the change.
- Run `npm run build` and `npm run cf:test`.

## Use cases

### 1. Show English game text

game starts or advances through the tutorial -- render the same prompt, hint, heading, and action in English --> English-only user-facing game text

#### Requirements

- `ENG-TEXT-1`: All user-facing tutorial labels, prompts, hints, and buttons MUST be in English.
- `ENG-TEXT-2`: Existing tutorial callbacks, phases, and visibility behavior MUST remain unchanged.
- `ENG-TEXT-3`: Game-facing page and social metadata MUST be in English.

#### Files And Functions

- `src/core/Game.ts#Game` - tutorial prompt and hint literals.
- `src/ui/TutorialUI.ts#TutorialUI` - tutorial heading and action label.
- `index.html` - title and metadata.
- `AGENTS.md` - project language rule.

#### Tests

- Search `src`, `worker`, `shared`, and `index.html` for Cyrillic text; no user-facing Cyrillic literals remain.
- `npm run build` succeeds.
- `npm run cf:test` succeeds.

## Implementation checklist

1. [x] Record the localization scope and connected surfaces.
2. [x] Translate tutorial literals and page/social metadata.
3. [x] Add the English-only project rule to `AGENTS.md`.
4. [x] Run source scan, build, lint, and Cloudflare tests.

## Open questions

- None; code comments and deployment documentation are outside the user-facing game text scope.

## Decision log

- Preserve all existing tutorial behavior and change only displayed language.
- Treat browser/social metadata as part of the game's user-facing presentation and translate it together with in-game text.
