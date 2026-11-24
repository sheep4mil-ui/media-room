# Media Room

GitHub Pages hosts the interface. The storage service uses a private R2 bucket. Visitors enter the room code and can upload or play files. The same library appears on every device.

## Deploying a separate copy

1. Configure `SITE_ORIGIN` in `worker/wrangler.toml` for the Pages domain.
2. In the `worker` directory, sign in with Wrangler and create the R2 bucket with `npx wrangler r2 bucket create media-room`.
3. Set `ENTRANCE_CODE` and `SESSION_SECRET` through `npx wrangler secret put NAME`. Use the requested room code for the first secret and a random value of at least 32 bytes for the second. Deploy with `npx wrangler deploy`.
4. Put the Worker URL in `config.js`. Commit and publish the frontend with GitHub Pages.

MP3s can be up to 95 MB. MP4s can be up to 5 GB (5,000,000,000 bytes). Keep the tab open until the upload finishes. MP4 playback depends on browser codec support. Everyone with the room code can access and add to the shared library.

Give split MP4s the same title and unique part numbers, such as `Movie Part 1.mp4` and `Movie Part 2.mp4`. They appear as one Watch entry and play in numeric order, looping back to the first part after the last one ends.

Anyone with room access can permanently delete shared uploads. Choose Delete next to a file or open Manage parts to delete one video in a series.

