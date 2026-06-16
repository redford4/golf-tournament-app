/*
 * config.js — Cloud configuration.
 *
 * Leave these blank to run the app fully on-device (local mode, the default).
 *
 * To enable shared cloud mode (everyone sees the same live tournament), paste
 * your Supabase project's URL and public "anon" key below. Find them in your
 * Supabase dashboard under: Project Settings → API.
 *
 * The anon key is designed to be used in a browser and is safe to publish.
 * See SETUP-CLOUD.md for the full walkthrough.
 */
window.GT = window.GT || {};
window.GT.CONFIG = {
  SUPABASE_URL: 'https://pmvfhvwgvifayeixdgmh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_cLRChcPyOoCeF5vS0H8ybw_AyHavm7j'
};
