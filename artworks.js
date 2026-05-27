/**
 * ARTWORKS CONFIG
 * ───────────────
 * 1. Paste your Behold Feed ID below (from behold.so → your feed → "Feed ID")
 * 2. Use OVERRIDES to manually set title, medium, dimensions, featured, or
 *    available for any post — keyed by Instagram post ID.
 *    Everything else is pulled live from your Instagram via Behold.
 *
 * Caption convention (optional):
 *   Start your Instagram caption with any of these lines and the site will
 *   pick them up automatically:
 *
 *     Title: Painting Name
 *     Medium: Oil on canvas
 *     Dimensions: 120 × 90 cm
 *     Available: yes | no | enquire
 */

const BEHOLD_FEED_ID = "XF2qeG8FeoVkeUAOOjI1";

/**
 * Hashtag filter — only posts whose caption contains this tag will appear.
 * Leave empty to show all posts.
 *
 * Example: const HASHTAG_FILTER = "#waltviviersgallery";
 * Then add that hashtag to any Instagram post you want on the site.
 */
const HASHTAG_FILTER = "#waltviviersgallery";

/**
 * Which posts to show on the site (alternative to HASHTAG_FILTER).
 * Add Instagram post IDs here to show only those posts (in that order).
 * Leave the array empty to show all posts from your feed.
 */
const FEATURED_POSTS = [];

/**
 * Manual overrides — keyed by Instagram post ID.
 * Find a post's ID in the browser console after loading the page
 * (each artwork card logs its ID), or from the Behold dashboard.
 *
 * Example:
 * const OVERRIDES = {
 *   "17846368219941196": {
 *     title:      "Still Life with Shadow",
 *     medium:     "Oil on linen",
 *     dimensions: "90 × 70 cm",
 *     available:  true,
 *     featured:   true,
 *   }
 * };
 */
const OVERRIDES = {};
