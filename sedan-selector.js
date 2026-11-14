/**
 * BimmerVision Interactive Sedan Camera Selector
 * Exact mathematical replication of CamGeo from SedanCameraPanel.axaml.cs.
 * Cones and markers are geometrically locked to the BMW sedan body.
 * Features:
 * - 'All' and 'Source' layout switcher buttons in the header
 * - 'Tap a camera view to see' hint indicator
 * - Fully clickable front, rear, left, right camera cones & hit zones with tactile pulse animation
 */
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
    this._triggerPulseAnimation(layout);
  }

  _triggerPulseAnimation(layout) {
    // Remove existing animation classes
    this.container.querySelectorAll(".anim-pulse, .anim-pop").forEach((el) => {
      el.classList.remove("anim-pulse", "anim-pop");
    });

    // Re-trigger animation on target elements
    requestAnimationFrame(() => {
      if (layout === "front") {
        const c = this.container.querySelector("#coneFront");
        const t = this.container.querySelector(".target-front");
        if (c) c.classList.add("anim-pulse");
        if (t) t.classList.add("anim-pop");
      } else if (layout === "rear") {
        const c = this.container.querySelector("#coneRear");
        const t = this.container.querySelector(".target-rear");
        if (c) c.classList.add("anim-pulse");
        if (t) t.classList.add("anim-pop");
      } else if (layout === "left") {
        const c = this.container.querySelector("#coneLeft");
        const t = this.container.querySelector(".target-left");
        if (c) c.classList.add("anim-pulse");
        if (t) t.classList.add("anim-pop");
      } else if (layout === "right") {
        const c = this.container.querySelector("#coneRight");
        const t = this.container.querySelector(".target-right");
        if (c) c.classList.add("anim-pulse");
        if (t) t.classList.add("anim-pop");
      } else if (layout === "quad") {
        this.container.querySelectorAll(".beam-cone").forEach((c) => c.classList.add("anim-pulse"));
      }
    });
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
          <button id="sedanIdentifyBtn" class="sedan-view-pill" title="Identify Camera Pairs">
            <svg viewBox="0 0 14 12" width="11" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="7" cy="6" r="3.5"></circle>
              <line x1="7" y1="1" x2="7" y2="2.5"></line>
              <line x1="7" y1="9.5" x2="7" y2="11"></line>
            </svg>
            Identify
          </button>
        </div>
      </div>

      <div class="sedan-stage-wrapper">
        <div class="sedan-stage-box">
          <!-- Exact CamGeo SVG Beams & Markers (viewBox 0 0 200 240) -->
          <svg class="sedan-beams" viewBox="0 0 200 240">
            <defs>
              <!-- Front Beam Radial Gradient (BMW M Red) -->
              <radialGradient id="beamGradFront" cx="100" cy="64" r="66" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#EE2440" stop-opacity="0.8"/>
                <stop offset="28%" stop-color="#EE2440" stop-opacity="0.55"/>
                <stop offset="62%" stop-color="#EE2440" stop-opacity="0.25"/>
                <stop offset="88%" stop-color="#EE2440" stop-opacity="0.08"/>
                <stop offset="100%" stop-color="#EE2440" stop-opacity="0"/>
              </radialGradient>

              <!-- Rear Beam Radial Gradient (BMW M Blue) -->
              <radialGradient id="beamGradRear" cx="100" cy="171" r="66" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3DA8F2" stop-opacity="0.8"/>
                <stop offset="28%" stop-color="#3DA8F2" stop-opacity="0.55"/>
                <stop offset="62%" stop-color="#3DA8F2" stop-opacity="0.25"/>
                <stop offset="88%" stop-color="#3DA8F2" stop-opacity="0.08"/>
                <stop offset="100%" stop-color="#3DA8F2" stop-opacity="0"/>
              </radialGradient>

              <!-- Left Beam Radial Gradient (BMW M Blue) -->
              <radialGradient id="beamGradLeft" cx="66" cy="97" r="66" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3DA8F2" stop-opacity="0.8"/>
                <stop offset="28%" stop-color="#3DA8F2" stop-opacity="0.55"/>
                <stop offset="62%" stop-color="#3DA8F2" stop-opacity="0.25"/>
                <stop offset="88%" stop-color="#3DA8F2" stop-opacity="0.08"/>
                <stop offset="100%" stop-color="#3DA8F2" stop-opacity="0"/>
              </radialGradient>

              <!-- Right Beam Radial Gradient (BMW M Blue) -->
              <radialGradient id="beamGradRight" cx="134" cy="97" r="66" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3DA8F2" stop-opacity="0.8"/>
                <stop offset="28%" stop-color="#3DA8F2" stop-opacity="0.55"/>
                <stop offset="62%" stop-color="#3DA8F2" stop-opacity="0.25"/>
                <stop offset="88%" stop-color="#3DA8F2" stop-opacity="0.08"/>
                <stop offset="100%" stop-color="#3DA8F2" stop-opacity="0"/>
              </radialGradient>
            </defs>

            <!-- Front Cone (Wedge from 64px up to 12px) - Clickable -->
            <path id="coneFront" class="beam-cone clickable-cone" data-cam="front" d="M 100 64 L 51 20 A 66 66 0 0 1 149 20 Z" fill="url(#beamGradFront)"/>

            <!-- Rear Cone (Wedge from 171px down to 226px) - Clickable -->
            <path id="coneRear" class="beam-cone clickable-cone" data-cam="rear" d="M 100 171 L 146 218 A 66 66 0 0 1 54 218 Z" fill="url(#beamGradRear)"/>

            <!-- Left Cone (Wedge from 66px left to 10px) - Clickable -->
            <path id="coneLeft" class="beam-cone clickable-cone" data-cam="left" d="M 66 97 L 18 52 A 66 66 0 0 0 18 142 Z" fill="url(#beamGradLeft)"/>

            <!-- Right Cone (Wedge from 134px right to 190px) - Clickable -->
            <path id="coneRight" class="beam-cone clickable-cone" data-cam="right" d="M 134 97 L 182 142 A 66 66 0 0 0 182 52 Z" fill="url(#beamGradRight)"/>
          </svg>

          <!-- Authentic BMW Sedan (Centered at 100, 120 with width 80, height 154) -->
          <img class="sedan-img" src="assets/sedan-topdown.png" alt="BMW Sedan">

          <!-- Generous Invisible Touch / Click Hit Zones for Instant Switching -->
          <div class="cam-hit-zone hit-front" data-cam="front" title="Front Camera View"></div>
          <div class="cam-hit-zone hit-rear" data-cam="rear" title="Rear Camera View"></div>
          <div class="cam-hit-zone hit-left" data-cam="left" title="Left Camera View"></div>
          <div class="cam-hit-zone hit-right" data-cam="right" title="Right Camera View"></div>

          <!-- Exact Hit Targets & Badges -->
          <div class="camera-target target-front" data-cam="front" title="Front Camera">
            <span class="cam-dot dot-front"></span>
            <span class="cam-badge">FRONT</span>
          </div>

          <div class="camera-target target-rear" data-cam="rear" title="Rear Camera">
            <span class="cam-badge">REAR</span>
            <span class="cam-dot dot-rear"></span>
          </div>

          <div class="camera-target target-left" data-cam="left" title="Left Camera">
            <span class="cam-dot dot-left"></span>
            <span class="cam-badge">LEFT</span>
          </div>

          <div class="camera-target target-right" data-cam="right" title="Right Camera">
            <span class="cam-dot dot-right"></span>
            <span class="cam-badge">RIGHT</span>
          </div>

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

    if (cFront) cFront.style.opacity = isQuad || this.activeLayout === "front" ? "1" : "0.08";
    if (cRear) cRear.style.opacity = isQuad || this.activeLayout === "rear" ? "1" : "0.08";
    if (cLeft) cLeft.style.opacity = isQuad || this.activeLayout === "left" ? "1" : "0.08";
    if (cRight) cRight.style.opacity = isQuad || this.activeLayout === "right" ? "1" : "0.08";

    // Targets
    this.container.querySelectorAll(".camera-target").forEach((t) => {
      const cam = t.dataset.cam;
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