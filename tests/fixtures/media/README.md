# Synthetic media fixtures

These two-second, silent color-pattern fixtures are generated from FFmpeg's `testsrc2` filter.
They contain no third-party footage, audio or user data. They exercise real browser MP4 decoding
and HLS fragmented-MP4 loading without a network service. `sample.m3u8` is a finite HLS test stream,
not proof of a real live ingest service.

Generation commands, run from this folder:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=8' -t 2 -an -c:v libx264 -profile:v baseline -pix_fmt yuv420p -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart sample.mp4
ffmpeg -i sample.mp4 -c copy -hls_time 1 -hls_list_size 0 -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename 'segment-%d.m4s' -hls_flags independent_segments sample.m3u8
```

Run the export and browser checks from the repository root:

```sh
OPENPENCIL_MEDIA_EXPORT_ROOT=/tmp/openpencil-media-export bun test tests/engine/app/lowcode/backend/business/exports/media.test.ts
OPENPENCIL_MEDIA_EXPORT_ROOT=/tmp/openpencil-media-export OPENPENCIL_TEST_PORT=1457 OPENPENCIL_TEST_MCP_PORT=7757 bunx playwright test --project=openpencil tests/e2e/compiler/media/playback.spec.ts
```

The browser uses the actual built React/Vue application, hls.js and browser decoder. Only account
authentication, business HTTP responses and the media host are scripted. These checks cover playback,
resource disposal, boolean favorite filters and submission conditions; they do not verify a real
identity service, database or streaming provider. Both test ports must be free.
