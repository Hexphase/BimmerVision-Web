/* Top-down camera picker with soft coverage fields and camera buttons. */
class SedanCameraSelector {
  constructor(containerEl, onSelect, onIdentify) {
    this.container = containerEl;
    this.onSelect = onSelect || (() => {});
    this.onIdentify = onIdentify || (() => {});
    this.activeLayout = "quad"; // "quad", "source", "front", "rear", "left", "right"
    this._render();
  }

  setLayout(layout) {
    this.activeLayout = layout;
    this._updateActiveClasses();
  }

  _render() {
    this.container.innerHTML = `
      <div class="sedan-panel-header">
        <span class="sedan-panel-title">Cameras</span>
        <button id="cameraViewMode" type="button" aria-haspopup="dialog" aria-controls="cameraModeSheet">
          <span>All Cameras</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 10 5-5 5 5"/></svg>
        </button>
      </div>

      <div class="sedan-stage-wrapper">
        <div class="sedan-stage-box">
          <svg class="sedan-beams" viewBox="0 0 200 240" aria-hidden="true">
            <defs>
              <filter id="cameraFieldSoftEdge" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8"/></filter>
              <radialGradient id="beamGradFront" cx="100" cy="91" r="86" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#2065db" stop-opacity=".48"/>
                <stop offset=".5" stop-color="#2065db" stop-opacity=".22"/>
                <stop offset="1" stop-color="#2065db" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="beamGradRear" cx="100" cy="166" r="68" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#2065db" stop-opacity=".48"/>
                <stop offset=".5" stop-color="#2065db" stop-opacity=".22"/>
                <stop offset="1" stop-color="#2065db" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="beamGradLeft" cx="68" cy="100" r="63" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#2065db" stop-opacity=".48"/>
                <stop offset=".5" stop-color="#2065db" stop-opacity=".22"/>
                <stop offset="1" stop-color="#2065db" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="beamGradRight" cx="132" cy="100" r="63" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#2065db" stop-opacity=".48"/>
                <stop offset=".5" stop-color="#2065db" stop-opacity=".22"/>
                <stop offset="1" stop-color="#2065db" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <path id="coneFront" class="beam-cone clickable-cone" data-cam="front" d="M100 110 0 0H200Z" fill="url(#beamGradFront)"/>
            <path id="coneRear" class="beam-cone clickable-cone" data-cam="rear" d="M100 148 200 240H0Z" fill="url(#beamGradRear)"/>
            <path id="coneLeft" class="beam-cone clickable-cone" data-cam="left" d="M68 100 0 38V162Z" fill="url(#beamGradLeft)"/>
            <path id="coneRight" class="beam-cone clickable-cone" data-cam="right" d="M132 100 200 162V38Z" fill="url(#beamGradRight)"/>
          </svg>

          <!-- Side camera origins align with the rendered mirror centers at (68,100)/(132,100). -->
          <img class="sedan-img" src="assets/sedan-topdown.png" alt="BMW Sedan">

          <!-- Generous Invisible Touch / Click Hit Zones for Instant Switching -->
          <div class="cam-hit-zone hit-front" data-cam="front" title="Front Camera View"></div>
          <div class="cam-hit-zone hit-rear" data-cam="rear" title="Rear Camera View"></div>
          <div class="cam-hit-zone hit-left" data-cam="left" title="Left Camera View"></div>
          <div class="cam-hit-zone hit-right" data-cam="right" title="Right Camera View"></div>

          <button type="button" class="camera-target target-front" data-cam="front" title="Front camera" aria-label="Front camera" aria-pressed="false"><span class="cam-dot" aria-hidden="true"></span></button>
          <button type="button" class="camera-target target-rear" data-cam="rear" title="Rear camera" aria-label="Rear camera" aria-pressed="false"><span class="cam-dot" aria-hidden="true"></span></button>
          <button type="button" class="camera-target target-left" data-cam="left" title="Left camera" aria-label="Left camera" aria-pressed="false"><span class="cam-dot" aria-hidden="true"></span></button>
          <button type="button" class="camera-target target-right" data-cam="right" title="Right camera" aria-label="Right camera" aria-pressed="false"><span class="cam-dot" aria-hidden="true"></span></button>

          <!-- Clickable Car Body for Quad / All -->
          <div class="target-center-car" data-cam="quad" title="All Cameras (Quad Grid)"></div>
        </div>
      </div>
    `;

    // Click event listeners on all camera-selectable elements
    this.container.querySelectorAll("[data-cam]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const cam = el.dataset.cam;
        if (!cam) return;
        this.setLayout(cam);
        this.onSelect(cam);
      });
    });

    const trigger = this.container.querySelector('#cameraViewMode');
    const sheet = this.container.ownerDocument.getElementById('cameraModeSheet');
    this.modeLabel = trigger.querySelector('span');
    this.modeOptions = sheet.querySelectorAll('[aria-pressed]');
    trigger.addEventListener('click', () => sheet.showModal());
    sheet.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button && event.target !== sheet) return;
      sheet.close();
      const mode = button?.dataset.mode;
      if (mode === 'calibrate') this.onIdentify();
      else if (mode) {
        this.setLayout(mode);
        this.onSelect(mode);
      }
    });

    this._updateActiveClasses();
  }

  _updateActiveClasses() {
    const isQuad = this.activeLayout === "quad";
    const names = {quad:'All Cameras',source:'Source',front:'Front',rear:'Rear',left:'Left',right:'Right'};
    this.modeLabel.textContent = names[this.activeLayout];
    for (const option of this.modeOptions) option.setAttribute('aria-pressed', String(option.dataset.mode === this.activeLayout));

    // Cones
    const cFront = this.container.querySelector("#coneFront");
    const cRear = this.container.querySelector("#coneRear");
    const cLeft = this.container.querySelector("#coneLeft");
    const cRight = this.container.querySelector("#coneRight");

    if (cFront) cFront.style.opacity = this.activeLayout === "front" ? "1" : isQuad ? "0.35" : "0";
    if (cRear) cRear.style.opacity = this.activeLayout === "rear" ? "1" : isQuad ? "0.35" : "0";
    if (cLeft) cLeft.style.opacity = this.activeLayout === "left" ? "1" : isQuad ? "0.35" : "0";
    if (cRight) cRight.style.opacity = this.activeLayout === "right" ? "1" : isQuad ? "0.35" : "0";

    // Targets
    this.container.querySelectorAll(".camera-target").forEach((t) => {
      const cam = t.dataset.cam;
      t.setAttribute("aria-pressed", String(this.activeLayout === cam || isQuad));
      if (this.activeLayout === cam || isQuad) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });


  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SedanCameraSelector };
}