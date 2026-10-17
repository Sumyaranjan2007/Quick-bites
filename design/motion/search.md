# Motion — Search

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../../docs/FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../../docs/README.md).

Search lives in `DiscoveryFeedScreen.tsx` (and voice in `components/VoiceSearchSheet.tsx`). Tokens: [`README.md`](README.md).

| Element | Trigger | Motion | Haptic |
|---|---|---|---|
| Search field | tap on the home search bar | field stays in place (no jump); the page below cross-fades to the search page `standard`; keyboard opens | – |
| Recent searches | page opens | chips fade in, 30 ms apart | – |
| "What's on your mind" dish grid | page opens | fades in and rises 8 px after the chips | – |
| Suggestions | typing (after 250 ms pause) | list cross-fades `quick`; matched letters in bold; no per-row animation while typing | – |
| Clear (×) | tap | text clears, × fades out `quick` | select |
| Voice mic | listening | maroon ring pulses (scale 1→1.15, opacity 0.6→0) every 900 ms until speech ends | tap on start |
| No results | empty | our own small illustration fades in `standard` | – |
