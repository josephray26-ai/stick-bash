import * as THREE from 'three';

// Unified controls: desktop (pointer lock + WASD + mouse) and mobile (touch).
export class Controls {
  constructor(domElement, { onSwing, onThrow, onJump, onInteract } = {}) {
    this.dom = domElement;
    this.onSwing = onSwing || (() => {});
    this.onThrow = onThrow || (() => {});
    this.onJump = onJump || (() => {});
    this.onInteract = onInteract || (() => {});

    this.yaw = 0;
    this.pitch = 0;
    this.move = new THREE.Vector2(0, 0); // x = strafe, y = forward
    this.enabled = false;
    this.locked = false;
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.keys = {};
    this._lookTouchId = null;
    this._moveTouchId = null;
    this._joyOrigin = new THREE.Vector2();

    this._initKeyboard();
    this._initMouse();
    if (this.isTouch) this._initTouch();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.move.set(0, 0); this.keys = {}; }
  }

  // ---- Keyboard / mouse (desktop) ----
  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const repeat = e.repeat;
      this.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); if (this.enabled && !repeat) this.onJump(); }
      if (e.code === 'KeyR') { e.preventDefault(); if (this.enabled && !repeat) this.onSwing(); }
      if (e.code === 'KeyF' || e.code === 'KeyQ') { e.preventDefault(); if (this.enabled && !repeat) this.onThrow(); }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  requestLock() {
    if (!this.isTouch && this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  _initMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0022;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this._clampPitch();
    });
    this.dom.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0 && this.enabled) this.onSwing();
      if (e.button === 2 && this.enabled) this.onThrow();
    });
    // right-click throws, so suppress the browser context menu over the game
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _clampPitch() {
    const lim = Math.PI / 2 - 0.15;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  // ---- Touch (mobile) ----
  _initTouch() {
    const opts = { passive: false };
    this.dom.addEventListener('touchstart', (e) => this._onTouchStart(e), opts);
    this.dom.addEventListener('touchmove', (e) => this._onTouchMove(e), opts);
    this.dom.addEventListener('touchend', (e) => this._onTouchEnd(e), opts);
    this.dom.addEventListener('touchcancel', (e) => this._onTouchEnd(e), opts);
  }

  _onTouchStart(e) {
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      const leftHalf = t.clientX < window.innerWidth * 0.5;
      if (leftHalf && this._moveTouchId === null) {
        this._moveTouchId = t.identifier;
        this._joyOrigin.set(t.clientX, t.clientY);
        this._showJoystick(t.clientX, t.clientY);
      } else if (!leftHalf && this._lookTouchId === null) {
        this._lookTouchId = t.identifier;
        this._lastLook = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _onTouchMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._moveTouchId) {
        const dx = t.clientX - this._joyOrigin.x;
        const dy = t.clientY - this._joyOrigin.y;
        const max = 55;
        const len = Math.hypot(dx, dy) || 1;
        const cl = Math.min(len, max);
        const nx = (dx / len) * (cl / max);
        const ny = (dy / len) * (cl / max);
        this.move.set(nx, -ny); // forward = up
        this._moveJoystick(dx, dy, max);
      } else if (t.identifier === this._lookTouchId) {
        const dx = t.clientX - this._lastLook.x;
        const dy = t.clientY - this._lastLook.y;
        this._lastLook = { x: t.clientX, y: t.clientY };
        const s = 0.005;
        this.yaw -= dx * s;
        this.pitch -= dy * s;
        this._clampPitch();
      }
    }
  }

  _onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._moveTouchId) {
        this._moveTouchId = null;
        this.move.set(0, 0);
        this._hideJoystick();
      } else if (t.identifier === this._lookTouchId) {
        this._lookTouchId = null;
      }
    }
  }

  _showJoystick(x, y) {
    if (!this._joyEl) {
      this._joyEl = document.getElementById('joystick');
      this._joyKnob = document.getElementById('joystick-knob');
    }
    if (!this._joyEl) return;
    this._joyEl.style.left = `${x}px`;
    this._joyEl.style.top = `${y}px`;
    this._joyEl.classList.add('active');
  }
  _moveJoystick(dx, dy, max) {
    if (!this._joyKnob) return;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, max);
    this._joyKnob.style.transform = `translate(${(dx / len) * cl}px, ${(dy / len) * cl}px)`;
  }
  _hideJoystick() {
    if (this._joyEl) this._joyEl.classList.remove('active');
    if (this._joyKnob) this._joyKnob.style.transform = 'translate(0,0)';
  }

  // ---- Per-frame movement input vector ----
  readMove() {
    if (this.isTouch) return this.move;
    let x = 0, y = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) y += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) y -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
    return this.move;
  }

  get sprint() { return !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']); }
}
