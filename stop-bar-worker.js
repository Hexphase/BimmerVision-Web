// Keep short-lived paint observations independent of the three-camera object model.
importScripts('stop-bar.js');
const canvas = new OffscreenCanvas(640, 480);
const context = canvas.getContext('2d', {willReadFrequently:true});
self.onmessage = ({data:bitmap}) => {
  try {
    context.drawImage(bitmap, 0, 0);
    self.postMessage(findStopBar(context.getImageData(0, 0, 640, 480).data));
  } finally {
    bitmap.close();
  }
};
