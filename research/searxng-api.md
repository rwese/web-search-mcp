# SearXNG JSON API surface

Research ticket #2 — document the SearXNG `/search` JSON API and the `/config` endpoint, and live-probe the instance at `https://search.wze.nope.at/`.

Sources: official SearXNG docs ([dev/search_api](https://docs.searxng.org/dev/search_api.html), [admin/api](https://docs.searxng.org/admin/api.html), [dev/result_types](https://docs.searxng.org/dev/result_types/base_result.html)) + live probing of `search.wze.nope.at` (version `2026.8.29+d226b78bc`).

---

## 1. `/search` endpoint

Two endpoints, `GET /` and `GET /search` (and their POST equivalents), take parameters as URL query params (GET) or form data (POST, `application/x-www-form-urlencoded`).

### Query parameters

| Param | Required | Values / type | Notes |
|---|---|---|---|
| `q` | **required** | string | The search query. Passed through to each engine, so engine-specific syntax (e.g. `site:github.com`) is honored by engines that support it. Missing `q` → HTTP 400 `{"error": "No query"}`. |
| `categories` | optional | comma-separated list | Active search categories, e.g. `general`, `news`, `images`, `it`, `science`, ... (full set from `/config` below). |
| `engines` | optional | comma-separated list | Restrict the search to specific engines by name, e.g. `engines=wikipedia`. |
| `language` | optional | language code | e.g. `en`, `en-US`, `all`. Default from server `search` settings. |
| `time_range` | optional | `day` \| `month` \| `year` | Only honored by engines that support time-range search (see `/config` `time_range_support`). |
| `safesearch` | optional | `0` \| `1` \| `2` | Safe-search level. Only affects engines with safe-search support. Default from server settings (this instance: `0`). |
| `pageno` | optional, default `1` | int | Result page number. |
| `format` | optional | `json` \| `csv` \| `rss` | Output format. Must be enabled in server `settings.yml` `search:`; otherwise HTTP **403 Forbidden**. Many public instances disable non-HTML formats. |
| `theme` | optional, default `simple` | `simple` | Theme for HTML output. Irrelevant to JSON. |

Other params used in HTML/embed contexts (`locale`, `lang`) do not affect the JSON result schema. For JSON consumption, the important ones are `q`, `categories`, `engines`, `language`, `time_range`, `safesearch`, `pageno`, `format`.

`format=json` is required to get JSON — without it you get the HTML results page.

---

## 2. JSON response schema

### Top-level keys

Every successful `/search?format=json` response contains exactly these keys:

| Key | Type | Description |
|---|---|---|
| `query` | string | Echo of the search query (`q`). |
| `results` | list[result] | Main search result items (see per-result schema below). |
| `answers` | list | Direct answers (e.g. from answerer plugins like calculator/unit converter / self_info). Empty when none. |
| `corrections` | list | Spelling/query corrections. Empty when none. |
| `suggestions` | list[str] | Autocomplete / related-query suggestions. Empty when none. |
| `infoboxes` | list[infobox] | Structured infobox objects (e.g. from Wikipedia). Empty when none. |
| `unresponsive_engines` | list[[engine, reason]] | Engines that failed/timed out this query, each a 2-element array `["<engine name>", "<reason>"]`. |

### Per-result fields (main `results` items)

Confirmed live on `search.wze.nope.at` for a `general` query:

| Field | Type | Present | Notes |
|---|---|---|---|
| `url` | string | always | Result link. |
| `title` | string | always | Result title. |
| `content` | string | always | Snippet / description (may be empty). |
| `engine` | string | always | Name of the engine that produced this specific result item. |
| `template` | string | always | HTML template name, e.g. `default.html`. |
| `parsed_url` | list[str] | always | 6-element urllib `ParseResult` tuple: `[scheme, netloc, path, params, query, fragment]`. |
| `engines` | list[str] | always | All engines that returned this (deduped) result. |
| `positions` | list[int] | always | The rank position reported by each engine in `engines`. |
| `score` | float | always | Aggregated relevance score (higher = more relevant). |
| `category` | string | always | Category the result belongs to, e.g. `general`, `news`, `images`. |
| `priority` | string | always | Priority hint (often empty `""`). |
| `img_src` | string | always | Direct image URL (empty for non-image results). |
| `thumbnail` | string | always | Thumbnail URL (may be empty). |
| `iframe_src` | string | always | Iframe embed source (empty unless video/embed). |
| `audio_src` | string | always | Audio source URL (empty unless audio). |
| `publishedDate` | string \| null | always | Publication date (ISO) when the engine provides it, else `null`. |
| `pubdate` | string | always | Legacy alias for date (often empty `""`). |
| `length` | number \| null | always | Media length (video/audio), else `null`. |
| `views` | string | always | View count string (often empty). |
| `author` | string | always | Author name (often empty). |
| `metadata` | string | always | Extra metadata (often empty). |
| `open_group` | bool | always | Grouping flag. |
| `close_group` | bool | always | Grouping flag. |

**Image results** (`categories=images`) replace some fields and add media-specific ones:

`template`, `url`, `thumbnail_src`, `img_src`, `content`, `title`, `source`, `resolution`, `img_format`, `engine`, `parsed_url`, `thumbnail`, `priority`, `engines`, `positions`, `score`, `category`, `publishedDate`.

Note `img_src` carries the full-size image URL and `thumbnail_src`/`thumbnail` the thumbnail; `resolution` and `img_format` describe the media.

### Infobox fields (`infoboxes` items)

Confirmed live (Wikipedia infobox):

`infobox`, `id`, `content`, `img_src`, `urls` (list of `{title, url}`), `engine`, `url`, `template`, `parsed_url`, `title`, `thumbnail`, `priority`, `engines`, `positions`, `score`, `category`, `publishedDate`, `attributes`.

---

## 3. `/config` endpoint

`GET /config` returns instance configuration (no auth). Top-level keys (live from `search.wze.nope.at`):

| Key | Type | Description |
|---|---|---|
| `version` | string | SearXNG version, e.g. `2026.8.29+d226b78bc`. |
| `instance_name` | string | e.g. `SearXNG`. |
| `default_theme` | string | e.g. `simple`. |
| `default_locale` | string | e.g. `""`. |
| `autocomplete` | string | e.g. `google`. |
| `safe_search` | int | Default safe-search level (`0`). |
| `public_instance` | bool | `false` for this instance. |
| `limiter` | object | Rate-limit config (`enabled: false` here). |
| `categories` | list[str] | All configured categories (32 here — see below). |
| `engines` | list[object] | One object per configured engine (275 here). |
| `locales` | object | `{code: name}` map of supported languages (62 here). |
| `plugins` | list[object] | `[{name, enabled}]` per plugin. |
| `doi_resolvers` | list[str] | e.g. `["oadoi.org","doi.org","sci-hub.se",...]`. |
| `default_doi_resolver` | string | e.g. `oadoi.org`. |
| `brand` | object | `CONTACT_URL`, `DOCS_URL`, `GIT_URL`, `GIT_BRANCH`, `PRIVACYPOLICY_URL`. |

Each `engines[]` item:

`categories` (list), `enabled` (bool), `language_support` (bool), `languages` (list), `name` (string), `paging` (bool), `regions` (list), `safesearch` (bool), `shortcut` (string), `time_range_support` (bool), `timeout` (float).

---

## 4. Error / timeout behavior

- **Missing `q`** → HTTP 400 with body `{"error": "No query"}`.
- **`format` not enabled** → HTTP 403 Forbidden (not the case on this instance).
- **Unknown/unset `format`** (e.g. `format=xml`) → returns HTML page (format ignored), not JSON.
- **Engine failures are non-fatal.** A query still returns HTTP 200 and partial results; the failing engines are reported in the `unresponsive_engines` array as `["<engine>", "<reason>"]`. Observed reasons: `"Suspended: too many requests"`, `"HTTP error"`, `"CAPTCHA"`, `"Suspended: CAPTCHA"`.
- No engine returning results (e.g. restricted `engines=wikipedia` with no match) → `results` is an empty list; still HTTP 200 with the normal top-level keys.

---

## 5. Live probe: `https://search.wze.nope.at/`

All probes used `curl -s 'https://search.wze.nope.at/search?...&format=json'`, no auth.

### Parameter matrix (all HTTP 200)

| Request | Result |
|---|---|
| `q=test&format=json` | 200, `results` with general results |
| `&categories=general` | 200 |
| `&time_range=year` | 200 (33 results) |
| `&pageno=2` | 200 (20 results — paging works) |
| `&language=en` | 200 |
| `&language=en-US` | 200 |
| `&safesearch=1` | 200 |
| `&safesearch=2` | 200 |
| combined `categories=general&time_range=year&pageno=2&language=en&safesearch=1` | 200 |

`categories=general`, `time_range=year`, `pageno=2`, `language=en`, and `safesearch=1` all confirmed working.

### Top-level keys (every successful query)

`query`, `results`, `answers`, `corrections`, `infoboxes`, `suggestions`, `unresponsive_engines` — exactly the 7 documented keys.

### Result fields present (general query)

`template`, `title`, `content`, `img_src`, `iframe_src`, `audio_src`, `thumbnail`, `publishedDate`, `pubdate`, `length`, `views`, `author`, `metadata`, `priority`, `engines`, `open_group`, `close_group`, `positions`, `score`, `category`, `url`, `engine`, `parsed_url`.

### `/config` — what this instance exposes

- **Categories (32):** general, videos, images, social media, music, packages, it, files, books, news, apps, software wikis, science, scientific publications, web, repos, other, currency, icons, weather, map, dictionaries, shopping, lyrics, cargo, movies, translate, radio, blogs, q&a, wikimedia, define.
- **Engines: 275 configured, 86 enabled.** Enabled `general`/web engines include: brave, braveapi, exaapi, google cse, startpage, duckduckgo, wikipedia, wikidata, currency, lingva, dictzone, mymemory translated.
- Enabled engines span: `it` (arch linux wiki, github, stackoverflow, mdn, ...), `images` (bing images, duckduckgo images, flickr, unsplash, pexels, google cse images, brave.images, wikicommons.images, ...), `videos` (youtube, youtubeapi, bing videos, duckduckgo videos, dailymotion, vimeo, brave.videos, ...), `news` (bing news, google news, duckduckgo news, reuters, brave.news, ...), `science` (arxiv, pubmed, semantic scholar, google scholar, ...), `music` (soundcloud, bandcamp, genius, mixcloud, youtube, ...), `social media` (lemmy *, mastodon *, tootfinder), `map` (openstreetmap, photon), `weather` (wttr.in), `files` (kickass, piratebay, bt4g, solidtorrents, ...), `translate` (lingva, dictzone, mymemory translated), `q&a` (stackoverflow, askubuntu, superuser), `dictionaries` (wiktionary, etmyonline, wordnik, dictzone), `repos` (github), `packages` (docker hub, pypi, hoogle), `radio` (radio browser), `lyrics` (genius), `icons` (devicons, lucide), `currency` (currency), `define` (wordnik), `wikimedia` (wikinews, wiktionary, wikicommons.*), `blogs`/`apps`/`software wikis` etc.
- **Plugins (9):** calculator, self_info, time_zone, hash_plugin, unit_converter, tracker_url_remover (enabled); tor_check, infiniteScroll, oa_doi_rewrite (disabled).
- **Version:** `2026.8.29+d226b78bc`; `public_instance: false`; limiter disabled; autocomplete `google`; `safe_search: 0`; 62 locales.

### Notes from probing

- `unresponsive_engines` is populated on most queries (rate-limited/captcha engines). Example: `[["brave","Suspended: too many requests"],["braveapi","HTTP error"],["duckduckgo","CAPTCHA"],["startpage","Suspended: CAPTCHA"]]`.
- `answers`, `corrections`, `suggestions` were empty for the sampled queries but the keys are always present.
- Infoboxes appear (e.g. `engines=wikipedia&q=linux` returns one infobox object).
- `categories=images` returns 450 results with image-specific fields (`thumbnail_src`, `source`, `resolution`, `img_format`).
- `format=xml` (unknown format) returns the HTML page, not an error.
