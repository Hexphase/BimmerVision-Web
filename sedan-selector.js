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
        <div class="sedan-header-meta">
          <span class="sedan-panel-title">CAMERAS</span>
          <span class="sedan-hint-text">Tap a camera view to see</span>
        </div>
        <div class="sedan-view-switchers">
          <button id="sedanAllBtn" class="sedan-view-pill ${this.activeLayout === "quad" ? "active" : ""}" data-view="quad" title="All 4 cameras (2x2 quad grid composite)">
            <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
              <rect x="1" y="1" width="4" height="4" rx="0.5"></rect>
              <rect x="7" y="1" width="4" height="4" rx="0.5"></rect>
              <rect x="1" y="7" width="4" height="4" rx="0.5"></rect>
              <rect x="7" y="7" width="4" height="4" rx="0.5"></rect>
            </svg>
            All
          </button>
          <button id="sedanSourceBtn" class="sedan-view-pill ${this.activeLayout === "source" ? "active" : ""}" data-view="source" title="Raw unprocessed side-by-side camera streams">
            <svg viewBox="0 0 14 12" width="11" height="10" fill="currentColor">
              <rect x="1" y="1" width="5.5" height="10" rx="0.5"></rect>
              <rect x="7.5" y="1" width="5.5" height="10" rx="0.5"></rect>
            </svg>
            Source
          </button>
          <button id="sedanIdentifyBtn" class="sedan-view-pill" title="Calibrate camera assignments">
            <svg viewBox="0 0 14 12" width="11" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="7" cy="6" r="3.5"></circle>
              <line x1="7" y1="1" x2="7" y2="2.5"></line>
              <line x1="7" y1="9.5" x2="7" y2="11"></line>
            </svg>
            Calibrate
          </button>
        </div>
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

    // View switcher buttons (All and Source)
    const allBtn = this.container.querySelector("#sedanAllBtn");
    if (allBtn) {
      allBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setLayout("quad");
        this.onSelect("quad");
      });
    }

    const sourceBtn = this.container.querySelector("#sedanSourceBtn");
    if (sourceBtn) {
      sourceBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setLayout("source");
        this.onSelect("source");
      });
    }

    const identifyBtn = this.container.querySelector("#sedanIdentifyBtn");
    if (identifyBtn) {
      identifyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.onIdentify) this.onIdentify();
      });
    }

    this._updateActiveClasses();
  }

  _updateActiveClasses() {
    const isQuad = this.activeLayout === "quad";
    const isSource = this.activeLayout === "source";

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

    // Pills
    const allBtn = this.container.querySelector("#sedanAllBtn");
    if (allBtn) {
      if (isQuad) allBtn.classList.add("active");
      else allBtn.classList.remove("active");
    }

    const sourceBtn = this.container.querySelector("#sedanSourceBtn");
    if (sourceBtn) {
      if (isSource) sourceBtn.classList.add("active");
      else sourceBtn.classList.remove("active");
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SedanCameraSelector };
}