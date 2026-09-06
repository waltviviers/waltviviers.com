# Journal (blog)

Written essays for waltviviers.com. Authored in Markdown, published as static
HTML. There are two ways to work with posts.

## Option A — the admin (recommended)

Open **/admin** and choose **Journal**. From there you can:

- **Create** a post, **edit** any existing post, or delete one.
- Keep it as a **Draft** (the toggle is on by default) — drafts are saved but
  never appear on the site or in the RSS feed.
- **Publish** by un-ticking Draft and saving.

Saving commits the post to `blog/posts/`, and a GitHub Action
(`.github/workflows/generate-blog-pages.yml`) automatically rebuilds the
journal pages and the RSS feed, then Vercel redeploys. No commands to run.

## Option B — by hand

1. Create `blog/posts/my-essay-title.md` with front-matter:

   ```markdown
   ---
   title: My Essay Title
   date: 2026-09-15
   description: One-sentence summary used for previews, SEO, and the RSS feed.
   draft: false
   ---

   Your essay in Markdown. Headings (##, ###), **bold**, *italic*,
   [links](https://example.com), > blockquotes, lists, `code`, images, and
   horizontal rules (---) are all supported.
   ```

   - `title` and `date` (YYYY-MM-DD) are required; `description` is recommended.
   - `draft: true` keeps a post hidden; `draft: false` (or omitting it) publishes.
   - `slug` is optional — by default the address is derived from the title
     (e.g. `blog/my-essay-title/`).

2. Regenerate the pages and feed:

   ```bash
   node scripts/generate-blog.js
   ```

   This writes `blog/<slug>/index.html` for each **published** post, rebuilds
   `blog/index.html`, updates `/feed.xml`, and removes the page of any post
   that has been drafted or deleted.

3. Commit the `.md` source **and** the generated HTML + `feed.xml`, then push.
   (Pushing the `.md` alone is enough — the Action regenerates the rest.)

Posts are sorted newest-first automatically by their `date`.
