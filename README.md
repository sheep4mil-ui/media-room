# Media Room

GitHub Pages hosts the interface. A Cloudflare Worker stores the shared MP3 and MP4 library in a private R2 bucket. Visitors enter the room code and can upload or play files. The same library appears on every device.

## Deployment

1. Configure `SITE_ORIGIN` in `worker/wrangler.toml` for the Pages domain.
2. In the `worker` directory, sign in with Wrangler and create the R2 bucket with `npx wrangler r2 bucket create media-room`.
3. Set `ENTRANCE_CODE` and `SESSION_SECRET` through `npx wrangler secret put NAME`. Use the requested room code for the first secret and a random value of at least 32 bytes for the second. Deploy with `npx wrangler deploy`.
4. Put the Worker URL in `config.js`. Commit and publish the frontend with GitHub Pages.

Files can be up to 95 MB. MP4 playback depends on browser codec support. Everyone with the room code can access and add to the shared library.

