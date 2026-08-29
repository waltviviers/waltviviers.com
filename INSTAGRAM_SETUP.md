# Instagram Setup via Behold.so

No developer app or API keys needed. Behold handles the Instagram connection
for you and gives you a simple feed URL the site fetches automatically.

---

## 1. Connect Instagram to Behold

1. Go to https://behold.so and create a free account
2. Click **Create Feed** and connect your Instagram account (@waltviviers)
3. Once connected, open the feed and copy your **Feed ID**
   (it looks like: `AbCdEfGhIjKlMnOp`)

---

## 2. Add your Feed ID to the site

Open `artworks.js` and replace the placeholder:

```js
const BEHOLD_FEED_ID = "AbCdEfGhIjKlMnOp";  // ← paste yours here
```

Save the file, commit, and push. Your artworks will load live from Instagram.

---

## 3. Control metadata from your captions (optional)

Start any Instagram caption with these lines and the site picks them up:

```
Title: Painting Name
Medium: Oil on canvas
Dimensions: 120 × 90 cm
Available: yes
```

Then write your normal caption below. Fields left out show as blank —
fill them in via OVERRIDES if you don't want to edit the caption.

---

## 4. Manual overrides (optional)

To set title, medium, dimensions, or mark a work as featured without
touching your Instagram caption, add an entry to `OVERRIDES` in `artworks.js`.

Find a post's Instagram ID in the browser console — the page logs each one
on load. Then:

```js
const OVERRIDES = {
  "17846368219941196": {
    title:      "Still Life with Shadow",
    medium:     "Oil on linen",
    dimensions: "90 × 70 cm",
    available:  true,
    featured:   true,   // ← this work appears first in the hero
  }
};
```

---

## 5. Set up GitHub Pages

1. In your GitHub repo go to **Settings → Pages**
2. Source: **Deploy from a branch** → `main` / `(root)`
3. Save — your site will be live at `https://waltviviers.github.io/waltviviers.com`
   (or your custom domain if configured)

---

That's it. Behold re-fetches your Instagram feed automatically, so new posts
appear on the site within a few hours of posting — no syncing required.
