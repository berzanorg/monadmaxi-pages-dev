# Monad Maxi PFP Maker

A web app that adds purple laser eyes to a PFP, built by
[Berzan](https://x.com/berzan) for the Monad community. Detection and
rendering both happen locally in the browser, so the photo is never uploaded
to a server. Hosted at https://monadmaxi.pages.dev.

## How it works

When you upload a photo, Google's MediaPipe FaceLandmarker model runs locally
inside the browser through WebAssembly. The model finds the largest face in the
image and returns the position of each iris. The lasers are then composited on
top of the photo using a canvas, with layered radial gradients producing the
soft purple bloom. If the model cannot find a face, two laser markers appear in
the middle and you place them on the eyes manually.

## Optimizations

To keep things smooth on mobile devices, the face model only ever sees a
downscaled copy of your photo capped at 1280 pixels on the long side, since
detection cost grows roughly with pixel count. While you drag the laser markers
around, only a small preview canvas re-renders, and the full-resolution image
is rebuilt once after you let go.

The exported JPEG is encoded in the background as you adjust the lasers. That
way, the iOS share sheet opens instantly when you tap Save, because the Web
Share API has to fire inside the original click event without any intervening
work.

## Development

Built with Bun and plain TypeScript, no framework. Run `bun install`,
`bun run build`, then `bun run preview`, and open http://localhost:5173.
MIT licensed.
