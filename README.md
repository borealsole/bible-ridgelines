# bible-ridgelines

Web app for creating Bible ridgeline plots: one ridge per original-language word (Hebrew, Aramaic or Greek), showing where that word is concentrated through any passage or set of passages.

**Live site:** https://borealsole.github.io/bible-ridgelines/

## Features

- **Any passage, any length**: `Ruth`, `Gen 1-11`, `John 1:1-18, 3:16`, `Ps 23; John 10:1-18; Ezek 34`, `Matt-John`, and groups such as `Torah`, `Gospels`, `Pauline`, `OT`, `NT`, `Bible`. Separate passages with `;`. They are placed side by side on the x-axis.
- **Word filters**: minimum and maximum occurrences in the passage, minimum and maximum Bible-wide frequency (useful for hiding particles), skipping the N most frequent words, and a maximum number of ridges.
- **Choose the words**: list the words to plot, or to hide, by Strong's number (`G26`), original word (`ἀγάπη`, `אלהים`, with or without accents), transliteration (`agape`, `elohim`), English gloss (`love`), wildcard (`*love`), whole family (`fam:G25`) or shared root (`root:G26`). You can merge each entry into one ridge (`G4102 + G4100`) and keep the ridges in the order you typed.
- **Family grouping**, in four steps: none (each Strong's number on its own), direct root, root chain, or the whole Strong's family. Hebrew prefixes (and, the, in, to…) can be included as words.
- **Ordering** by where most occurrences fall (median, the default), mean position, peak concentration, first appearance, frequency, or the order of your word list.
- **Normalisation**: raw frequency on a shared scale, each ridge scaled to its own peak, or equal area.
- **Styling**: smoothing, ridge spacing, height and overlap, plot width, fill opacity, line width, palettes and colour modes (by order, position, frequency or language, or a single colour), background, line and text colours, style presets, and fonts with Hebrew and Greek coverage.
- **Labels**: the original word, an English gloss, both, a transliteration, or the Strong's number.
- **Export**: PNG at 1–4×, SVG, and a CSV of the plotted words. Settings are kept in the URL, so a link reproduces the plot.
- Hovering over a ridge shows the lemma, gloss, counts, the verse at the centre of its distribution, and the verse under the cursor.

## Data

`scripts/build_data.py` builds `site/data/` from the [sync.bible](https://github.com/borealsole/sync.bible) repository:

| Input | Used for |
|---|---|
| `public/bibles/accented.json` | Text: pointed WLC Hebrew and accented Tischendorf Greek, keyed to Strong's numbers. Hebrew prefixes are split into their own tokens. |
| `public/data/strongsDictionary.json` | Lemmas, transliterations, definitions and glosses |
| `public/data/strongsObjectWithFamilies.json` | Roots, families and Bible-wide counts |

Glosses come from the start of each Strong's definition. For about 750 common words where that definition opens with etymology or grammar ("superimposition" for ἐπί), a hand-checked gloss in `scripts/gloss_overrides.json` replaces it. Glosses for rarer words are still approximate.

The data is generated rather than committed. To run the app locally:

```sh
git clone https://github.com/borealsole/sync.bible ../sync.bible   # or use --download
python3 scripts/build_data.py --source ../sync.bible --out site/data
node scripts/test-passages.mjs
python3 -m http.server -d site 8000   # open http://localhost:8000
```

There are no build tools or npm dependencies. The site is plain HTML, CSS and ES modules in `site/`.

## Deployment

`.github/workflows/deploy.yml` checks out the three sync.bible data files, builds the dataset, runs the checks and deploys `site/` to GitHub Pages:

- on every push to `main`
- on pull requests (build and checks only)
- weekly, to pick up changes in sync.bible
- manually, or through a `repository_dispatch` event of type `sync-bible-updated`

One-time setup: under **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
