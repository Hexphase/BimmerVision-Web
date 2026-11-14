const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup({qrStart}={}){
 const nodes={};function node(id){return nodes[id]||(nodes[id]={id,hidden:false,files:[],value:'',listeners:{},addEventListener(n,f){this.listeners[n]=f;},focus(){},click(){}});}
 const windowListeners={};let load,options,paused=0,cancelled=0,closed=0;const source={kind:'usb',readOnly:true,name:'Drive',fetch:()=>{assert.equal(options.signal.aborted,false);},close(){closed++;}};
 const manager={source:null,setSource(s){this.source=s;this.listener?.(s);},subscribe(f){this.listener=f;}};
 const document={body:{dataset:{}},getElementById:node,querySelector:()=>node('shell'),addEventListener:(event,f)=>{load=f;}};
 const window={BVSourceManager:manager,player:{pause:()=>paused++,cancelLoad:()=>cancelled++},addEventListener:(n,f)=>{windowListeners[n]=f;},dispatchEvent(){}};
 const sandbox={BVQRScanner:{start:qrStart},DOMException,document,window,AbortController,Event,URLSearchParams,location:{search:'',pathname:'/'},BVLocalSource:{fromFiles:async(files,o)=>{options=o;return source;}},console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../source-controller'),'utf8'),sandbox);load();return {node,manager,source,windowListeners,options:()=>options,counts:()=>({paused,cancelled,closed})};
}
test('accepting a USB source leaves its cancellation signal live while showing the player',async()=>{const s=setup();s.node('usbFolderInput').files=[{}];await s.node('usbFolderInput').listeners.change();assert.equal(s.manager.source,s.source);assert.equal(s.options().signal.aborted,false);assert.equal(s.node('sourceScreen').hidden,true);assert.equal(s.node('shell').hidden,false);s.source.fetch();});
test('opening and cancelling the source picker preserves paused playback',async()=>{const s=setup();s.manager.source=s.source;s.node('changeSourceBtn').listeners.click();assert.equal(s.node('shell').hidden,true);assert.equal(s.counts().paused,1);assert.equal(s.counts().cancelled,0);s.node('returnToRecordingsBtn').listeners.click();assert.equal(s.node('shell').hidden,false);assert.equal(s.manager.source,s.source);});
test('a cancelled first camera request cannot abort the next camera scan',async()=>{
 const pending=[];const s=setup({qrStart:(video,options)=>new Promise((resolve,reject)=>{pending.push({resolve,reject,signal:options.signal});options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});})});
 const first=s.node('scanQrBtn').listeners.click();const second=s.node('scanQrBtn').listeners.click();await first;
 assert.equal(pending[1].signal.aborted,false);assert.equal(s.node('qrCameraPanel').hidden,false);pending[1].resolve(()=>{});await second;
});
test('BFCache navigation keeps the selected source usable while a real unload closes it',()=>{const s=setup();s.manager.source=s.source;s.windowListeners.pagehide({persisted:true});assert.equal(s.counts().closed,0);s.windowListeners.pagehide({persisted:false});assert.equal(s.counts().closed,1);});
