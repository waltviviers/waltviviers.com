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
 * Which posts to show on the site.
 * Add Instagram post IDs here to show only those posts (in that order).
 * Leave the array empty to show all posts from your feed.
 *
 * Find IDs in the browser console after loading the page —
 * each post logs: "Instagram post ID: 18089666612607170"
 *
 * Example:
 * const FEATURED_POSTS = [
 *   "18089666612607170",
 *   "18097241498136915",
 * ];
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
