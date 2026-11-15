# BimmerVision Web

**Your BimmerVision recordings, directly in your browser.** A GitHub Pages edition of the BimmerVision player, with the same camera views, drive timeline, telemetry, maps and video export.

## Open the player

**[Launch BimmerVision Web](https://hexphase.github.io/BimmerVision-Web/)**

### From a USB drive

1. Connect your recording USB drive to your computer.
2. Choose **Choose USB folder** and select the **BimmerVision** folder on that drive.
3. Pick a drive or recording and press Play.

The browser reads your files locally. **Recordings are never uploaded to GitHub or a cloud server.** USB mode is view-only: it cannot erase footage or change the locks on your drive. Camera assignments are saved in this browser; your original files stay unchanged.

You can also select a folder containing a single completed recording. Incomplete clips and recordings whose files do not match their manifest are excluded.

### Directly from your car

Requires **BimmerVision 0.2.8 or newer** on a compatible iDrive 7 car with 360° Surround View cameras.

1. Open **Connect Phone** in the car app and keep that screen open.
2. Connect your device to the car’s BMW Wi-Fi / CarPlay connection.
3. In this web player, enter the car’s IP address and 8-digit code, paste the Connect link, or choose **Scan QR code**.
4. Allow local-network access if the browser asks.

You can scan the QR code with this page’s camera scanner or choose a saved QR-code image. Scanning inside this player keeps you in the hosted web app. Scanning the car’s QR with your phone’s normal camera app opens the car’s built-in player instead.

Use a current **Chrome or Edge** browser for direct car access. An HTTPS-hosted site connecting to the car’s local HTTP server depends on browser local-network permissions. Some browsers block this connection; the connection screen provides a link to the car’s built-in player when needed. Do not disable browser security or certificate checks.

Pairing stays between your device and the car. The web host does not proxy recordings or receive pairing credentials. The car still permits one paired device at a time; reopen Connect Phone for a fresh code if necessary.

## Features

- Front, rear, left and right camera views, or all four together.
- A fixed-scale timeline for scrubbing within and between recordings.
- BMW M colors to distinguish neighboring clips.
- Saved camera identification for each recording.
- Recorded speed, steering, blinkers, brake, accelerator and timestamped horn information.
- Recorded GPS routes and car-detected speed limits when available.
- Recorded parking and wide camera views, with playback and exports following view changes.
- Original BVR + metadata ZIP downloads from USB or a paired car (car app 0.2.15 or newer).
- Recording notices when a car download may interrupt capture.
- Customizable video exports, including date/time and driving overlays.
- Full recording download before playback, with visible progress and cancellation.
- Change between USB and car sources without leaving the app.

Player behavior matches the recording webserver in BimmerVision 0.2.36. The hosted player retains local USB access and direct paired-car access.

The device needs WebCodecs support for camera playback; current Chrome and Edge are recommended. Folder selection and camera-scanning support vary by browser. Maps and update checks use Internet services; unavailable location or speed-limit data stays blank.

## Hosting on GitHub Pages

This is a static website: there is no server process or runtime package installation.

In repository **Settings → Pages**, publish from **main / (root)**. All bundled assets use relative paths so the site works at `/BimmerVision-Web/`. `.nojekyll` keeps the files served directly.

No custom domain is configured by this repository. You can add one through GitHub Pages settings after configuring its DNS. The car companion currently allows the hosted origins `https://hexphase.github.io` and `https://bimmervision.app`; other origins require a corresponding companion update.

## Development

```sh
npm test
python3 -m http.server 8787 --bind 127.0.0.1
```

Open `http://127.0.0.1:8787/`. Localhost is a secure context for browser development. Tests use synthetic data; personal recordings and local exports are ignored by Git.

The player is copied from [BimmerVision](https://github.com/Hexphase/BimmerVision). QR decoding uses vendored [jsQR](https://github.com/cozmo/jsQR), with its Apache 2.0 license and pinned version recorded in `vendor/`.
