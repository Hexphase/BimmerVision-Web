/* Camera frames and uploaded QR images are decoded locally. No uploads or CDN. */
(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.BVQRScanner=value;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const abortError=()=>new DOMException('QR scanning cancelled.','AbortError');
const CAMERA_HELP='Camera unavailable. Allow camera access in your browser, upload a QR image, or enter the car IP address and 8-digit code.';
const MAX_PIXELS=16000000,MAX_SIDE=1600;
function canvasFor(image,width,height){
  if(!width||!height||width*height>MAX_PIXELS)throw new Error('QR image is too large. Use an image under 16 million pixels.');
  const scale=Math.min(1,MAX_SIDE/Math.max(width,height));
  const canvas=root.document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Image decoding is unavailable. Enter the car address and code.');
  context.drawImage(image,0,0,canvas.width,canvas.height);return {canvas,context};
}
async function decode(image,width,height,detector){
  const {canvas,context}=canvasFor(image,width,height);
  if(detector){try{const results=await detector.detect(canvas);if(results[0]?.rawValue)return results[0].rawValue;}catch{/* Use the vendored fallback. */}}
  if(typeof root.jsQR!=='function')throw new Error('QR decoder is unavailable. Reload the page or enter the car address and code.');
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);return root.jsQR(pixels.data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'})?.data||null;
}
function nativeDetector(){try{return typeof root.BarcodeDetector==='function'?new root.BarcodeDetector({formats:['qr_code']}):null;}catch{return null;}}
async function loadImage(file){
  if(typeof root.createImageBitmap==='function')return root.createImageBitmap(file);
  return new Promise((resolve,reject)=>{
    const image=new root.Image(),url=root.URL.createObjectURL(file);
    const cleanup=()=>{clearTimeout(timer);root.URL.revokeObjectURL(url);image.onload=image.onerror=null;};
    const timer=setTimeout(()=>{cleanup();image.src='';reject(new Error('QR image decoding timed out. Try a smaller PNG or JPEG.'));},10000);
    image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(new Error('Cannot read that image. Try a PNG or JPEG of the QR code.'));};image.src=url;
  });
}
async function decodeFile(file){
  if(!file||!/^image\/(?:png|jpe?g|webp)$/.test(file.type||''))throw new Error('Choose a PNG, JPEG or WebP image of the QR code.');
  if(!Number.isFinite(file.size)||file.size<=0||file.size>10*1024*1024)throw new Error('Choose a QR image smaller than 10 MB.');
  let image;
  try{image=await loadImage(file);const result=await decode(image,image.width||image.naturalWidth,image.height||image.naturalHeight,nativeDetector());if(!result)throw new Error('No QR code found. Use a clear, uncropped image or enter the car address and code.');return result;}
  catch(error){throw new Error(error?.message||'Cannot read that QR image. Try a clearer PNG or JPEG.');}
  finally{image?.close?.();}
}
async function start(video,{onResult,onError,signal}={}){
  if(signal?.aborted)throw abortError();
  if(!video||!root.navigator?.mediaDevices?.getUserMedia)throw new Error(CAMERA_HELP);
  let stopped=false,stream,timer,rejectAbort;const detector=nativeDetector();
  const release=s=>{for(const track of s?.getTracks()||[])track.stop();};
  const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);root.removeEventListener?.('pagehide',stop);root.document?.removeEventListener('visibilitychange',visibility);release(stream);try{video.pause();video.srcObject=null;}catch{};};
  const aborted=()=>{stop();rejectAbort?.(abortError());};
  const visibility=()=>{if(root.document.hidden)stop();};
  signal?.addEventListener('abort',aborted,{once:true});root.addEventListener?.('pagehide',stop);root.document?.addEventListener('visibilitychange',visibility);
  const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
  try{
    // Permission prompts cannot be cancelled in every browser. Release any late stream.
    const permission=root.navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}}).then(s=>{if(stopped){release(s);throw abortError();}stream=s;return s;});
    await Promise.race([permission,cancelled]);
    if(stopped)throw abortError();video.srcObject=stream;video.muted=true;video.playsInline=true;
    await Promise.race([video.play(),cancelled]);if(stopped)throw abortError();
    const tick=async()=>{if(stopped)return;try{if(video.readyState>=2&&video.videoWidth&&video.videoHeight){const value=await decode(video,video.videoWidth,video.videoHeight,detector);if(stopped)return;if(value){stop();onResult?.(value);return;}}}catch(error){if(stopped)return;stop();onError?.(new Error(error.message||CAMERA_HELP));return;}if(!stopped)timer=setTimeout(tick,250);};
    timer=setTimeout(tick,0);return stop;
  }catch(error){stop();if(error?.name==='AbortError')throw error;throw new Error(CAMERA_HELP);}
}
return {start,decodeFile};
});
