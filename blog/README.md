# Journal (blog)

Written essays for waltviviers.com. Authored in Markdown, published as static
HTML — no build step runs on the live site.

## Add a new essay

1. Create `blog/posts/my-essay-title.md` with front-matter:

   ```markdown
   ---
   title: My Essay Title
   date: 2026-09-15
   description: One-sentence summary used for previews, SEO, and the RSS feed.
   ---

   Your essay in Markdown. Headings (##, ###), **bold**, *italic*,
   [links](https://example.com), > blockquotes, lists, `code`, images, and
   horizontal rules (---) are all supported.
   ```

   - `title` and `date` (YYYY-MM-DD) are required; `description` is recommended.
   - `slug` is optional — by default it's derived from the title
     (e.g. `blog/my-essay-title/`).

2. Regenerate the pages and feed:

   ```bash
   node scripts/generate-blog.js
   ```

   This writes `blog/<slug>/index.html`, rebuilds `blog/index.html`, and
   updates `/feed.xml`.

3. Add the new post's URL to `sitemap.xml` (one `<url>` block under the
   Journal section).

4. Commit the `.md` source **and** the generated HTML + `feed.xml`, then push.

Posts are sorted newest-first automatically by their `date`.
