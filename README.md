## IMDb Import for Roam

Import film/TV metadata from OMDb/IMDb directly into your current Roam page.

### What it does

- Uses the current page title as the search query.
- Lets you pick a matching movie/series from a list.
- Supports fallback by direct IMDb ID (`tt...`) if title search is not enough.
- Inserts poster, metadata, IMDb link, and plot summary.
- Includes ratings when available (IMDb, Rotten Tomatoes, Metacritic).

You can trigger it via:

- Command Palette: `IMDb import`
- SmartBlocks: `<%IMDB%>`

---

## Setup

1. Get an API key from [OMDb](http://www.omdbapi.com/apikey.aspx).
2. Open Roam Depot settings for this extension.
3. Paste your key into `OMDb API key`.

---

## Settings

Top-level settings:

- `OMDb API key`
- `Output as attributes`
- `Insert position` (`top` or `last`)
- `Rewrite Roam Page Title` (toggle)
- `Advanced Output Options` (toggle)

When `Advanced Output Options` is ON:

- Custom labels for Director, Writer, Cast, Year, Genre, Ratings
- Per-field output order (`1` to `6`) for those six metadata rows

---

## Page title rewrite behaviour

When `Rewrite Roam Page Title` is ON:

- The extension asks for confirmation before renaming.
- Renaming is only attempted for page-level imports (not block-context imports).
- If confirmed, the page title is updated to the selected IMDb title.

This is a user-data mutation. Keep this OFF if you never want automatic page renaming.

---

## Notes and limitations

- Imports run one at a time; repeated triggers while running are ignored with a toast.
- `Insert position: top` prepends content and shifts existing top-level blocks down.
- `Insert position: last` appends at the end of the page.
- External metadata is normalised/sanitised, but source data quality still depends on OMDb.

---

## Example IMDb ID fallback

If you choose `None of these titles!`, enter an IMDb ID manually, e.g.:

- URL: `https://www.imdb.com/title/tt0088763/`
- ID: `tt0088763`
