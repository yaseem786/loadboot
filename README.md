# Loadboot — website source

Static marketing site + carrier portal for Loadboot (US truck dispatch service).

## How it works
- `build_site.py` is the generator. Run `python3 build_site.py` → it regenerates all
  HTML/CSS/JS into the `site/` folder (images already live in `site/` and are kept).
- `tools_module.py` and `load_score_module.py` provide the calculator tools.
- Netlify serves the `site/` folder directly (see `netlify.toml`) — **no build step on Netlify**.

## Deploy
Netlify is connected to this repo for continuous deployment. **Every push to `main`
auto-publishes** the updated `site/` to loadboot.com.

## Adding an article (manual or automated)
1. Pick the first `TODO` in `content-queue.md`.
2. Add a premium `rich_article(...)` block in `build_site.py` (copy the cost / vs-broker
   pattern: feat SVG, custom diagram(s), 2–3 `svc_banner`s, outbound FMCSA links, FAQ).
3. Add its `THUMBS`, `blog_card`/`READTIME` entry, and add the slug to `PREMIUM_ARTICLES`.
4. Run `python3 build_site.py`, verify, mark the row `DONE` in `content-queue.md`.
5. Commit + push → Netlify deploys.

## Optional real photos
Any blog thumbnail auto-upgrades if you drop `site/thumb-<slug>.jpg`.
Any article hero auto-upgrades if you drop the hero filename named in its `rich_article` call.
Use unbranded photos (no watermark / competitor logos).
