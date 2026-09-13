/* ==========================================================================
   PENGUIN FUN — shared, purely-decorative chat command easter egg.
   Triggered by chat/host text "!penguin" and "!fish". Used identically by
   every game on this platform via a single <script> include.

   Design constraints this file is built around:
   - Never touches any game's DOM, state, or scoring — it only ever reads
     chat text handed to it and creates its own elements in its own layer.
   - Its overlay layer is pointer-events:none, so it can NEVER block a tap
     on game controls — the only interactive part is the penguin itself,
     which deliberately re-enables pointer events so the host can drag it.
   - Cheap by design: at most one penguin, one fish in flight at a time,
     small emoji-based "sprites", CSS transitions/keyframes for the fades,
     requestAnimationFrame only for the handful of moving pieces.
   ========================================================================== */

(function () {
  if (window.PenguinFun) return; // don't double-init if included twice

  const STYLE_ID = "penguin-fun-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #penguin-fun-layer {
        position: fixed; inset: 0; z-index: 9000;
        pointer-events: none; overflow: hidden;
      }
      .pf-penguin {
        position: absolute; font-size: 32px; line-height: 1;
        transform: translate(-50%, -50%);
        pointer-events: auto; cursor: grab; user-select: none;
        touch-action: none; will-change: left, top;
        filter: drop-shadow(0 3px 3px rgba(0,0,0,.35));
      }
      .pf-penguin.pf-slide { transform: translate(-50%, -50%) rotate(85deg) scaleX(1.1); }
      .pf-penguin.pf-flip { transform: translate(-50%, -50%) scaleX(-1); }
      .pf-penguin.pf-bob { animation: pf-bob .5s ease-in-out infinite; }
      @keyframes pf-bob { 0%,100%{ margin-top:0; } 50%{ margin-top:-3px; } }
      .pf-penguin.pf-run { animation: pf-run .26s ease-in-out infinite; }
      @keyframes pf-run { 0%,100%{ margin-top:0; } 50%{ margin-top:-6px; } }
      .pf-bubble {
        position: absolute; left: 50%; top: -6px; transform: translateX(-50%);
        font-size: 15px; pointer-events: none; animation: pf-bubble-float 1.1s ease-out forwards;
      }
      @keyframes pf-bubble-float {
        from { opacity: 1; transform: translate(-50%, 0); }
        to   { opacity: 0; transform: translate(-50%, -16px); }
      }
      .pf-ice {
        position: absolute; width: 20px; height: 7px; border-radius: 6px;
        background: linear-gradient(180deg, #eaf7ff, #bfe9ff);
        box-shadow: 0 0 6px rgba(180,230,255,.8);
        transform: translate(-50%, -50%);
        opacity: .85; pointer-events: none;
        animation: pf-ice-fade 1s ease-out forwards;
      }
      @keyframes pf-ice-fade { to { opacity: 0; } }
      .pf-fish {
        position: absolute; font-size: 20px; line-height: 1;
        transform: translate(-50%, -50%); pointer-events: none;
        filter: drop-shadow(0 2px 2px rgba(0,0,0,.3));
      }
      .pf-pop {
        position: absolute; font-size: 18px; pointer-events: none; transform: translate(-50%, -50%);
        animation: pf-pop-anim .5s ease-out forwards;
      }
      @keyframes pf-pop-anim {
        0%   { opacity: 1; transform: translate(-50%, -50%) scale(.6); }
        100% { opacity: 0; transform: translate(-50%, -90%) scale(1.3); }
      }
    `;
    document.head.appendChild(style);
  }

  const layer = document.createElement("div");
  layer.id = "penguin-fun-layer";
  document.body.appendChild(layer);

  let penguin = null; // { el, x, y, state, timers, raf, dragging }
  let fishInFlight = false;

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const rand = (min, max) => min + Math.random() * (max - min);
  const setPos = (el, x, y) => { el.style.left = x + "px"; el.style.top = y + "px"; };

  function bubble(el, emoji) {
    const b = document.createElement("div");
    b.className = "pf-bubble";
    b.textContent = emoji;
    el.appendChild(b);
    setTimeout(() => b.remove(), 1100);
  }

  function spawnIce(x, y) {
    const ice = document.createElement("div");
    ice.className = "pf-ice";
    setPos(ice, x, y);
    layer.appendChild(ice);
    setTimeout(() => ice.remove(), 1000);
  }

  function popEmoji(x, y, emoji) {
    const p = document.createElement("div");
    p.className = "pf-pop";
    p.textContent = emoji;
    setPos(p, x, y);
    layer.appendChild(p);
    setTimeout(() => p.remove(), 500);
  }

  function clearPenguinTimers() {
    if (!penguin) return;
    Object.values(penguin.timers).forEach(clearTimeout);
    penguin.timers = {};
    if (penguin.raf) { cancelAnimationFrame(penguin.raf); penguin.raf = null; }
  }

  function removePenguin() {
    if (!penguin) return;
    clearPenguinTimers();
    penguin.el.remove();
    penguin = null;
  }

  function moveTo(target, speed, onArrive, runMode) {
    if (!penguin) return;
    penguin.state = runMode ? "running" : "walking";
    penguin.el.classList.toggle("pf-run", !!runMode);
    penguin.el.classList.toggle("pf-bob", !runMode);
    function step() {
      if (!penguin || penguin.dragging) return;
      const dx = target.x - penguin.x;
      const dy = target.y - penguin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        penguin.x = target.x; penguin.y = target.y;
        setPos(penguin.el, penguin.x, penguin.y);
        penguin.el.classList.remove("pf-run", "pf-bob");
        if (onArrive) onArrive();
        return;
      }
      penguin.el.classList.toggle("pf-flip", dx < 0);
      penguin.x += (dx / dist) * speed;
      penguin.y += (dy / dist) * speed;
      setPos(penguin.el, penguin.x, penguin.y);
      penguin.raf = requestAnimationFrame(step);
    }
    penguin.raf = requestAnimationFrame(step);
  }

  function scheduleWander() {
    if (!penguin) return;
    penguin.state = "standing";
    const delay = rand(1200, 3200);
    penguin.timers.wander = setTimeout(() => {
      if (!penguin || penguin.dragging) return;
      if (Math.random() < 0.22) { napPenguin(); return; }
      const target = { x: rand(40, vw() - 40), y: rand(vh() * 0.5, vh() - 60) };
      moveTo(target, 1.5, scheduleWander, false);
    }, delay);
  }

  function napPenguin() {
    if (!penguin) return;
    penguin.state = "sleeping";
    penguin.el.textContent = "😴";
    bubble(penguin.el, "💤");
    penguin.timers.nap = setTimeout(() => {
      if (!penguin) return;
      penguin.el.textContent = "🐧";
      scheduleWander();
    }, 3000);
  }

  function attachDrag(el) {
    el.addEventListener("pointerdown", (e) => {
      if (!penguin) return;
      penguin.dragging = true;
      clearPenguinTimers();
      el.classList.remove("pf-slide", "pf-run", "pf-bob");
      el.textContent = "🐧"; // wake it up if it was napping
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      if (!penguin || !penguin.dragging) return;
      penguin.x = e.clientX;
      penguin.y = e.clientY;
      setPos(el, penguin.x, penguin.y);
    });
    function endDrag() {
      if (!penguin || !penguin.dragging) return;
      penguin.dragging = false;
      el.style.cursor = "grab";
      scheduleWander();
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  function slideIn() {
    const startX = rand(vw() * 0.15, vw() * 0.85);
    const startY = rand(24, vh() * 0.12);
    const midX = vw() / 2 + rand(-40, 40);
    const midY = vh() / 2;
    const endX = rand(vw() * 0.15, vw() * 0.85);
    const endY = rand(vh() * 0.65, vh() - 80);

    const el = document.createElement("div");
    el.className = "pf-penguin pf-slide";
    el.textContent = "🐧";
    setPos(el, startX, startY);
    layer.appendChild(el);

    penguin = { el, x: startX, y: startY, state: "sliding", timers: {}, raf: null, dragging: false };
    attachDrag(el);

    const waypoints = [{ x: startX, y: startY }, { x: midX, y: midY }, { x: endX, y: endY }];
    let wpIndex = 0;
    let lastIceAt = 0;

    function slideStep() {
      if (!penguin || penguin.dragging) return;
      const target = waypoints[wpIndex + 1];
      if (!target) {
        penguin.el.classList.remove("pf-slide");
        scheduleWander();
        return;
      }
      const dx = target.x - penguin.x;
      const dy = target.y - penguin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) { wpIndex++; penguin.raf = requestAnimationFrame(slideStep); return; }
      penguin.x += (dx / dist) * 6.5;
      penguin.y += (dy / dist) * 6.5;
      setPos(penguin.el, penguin.x, penguin.y);
      const now = performance.now();
      if (now - lastIceAt > 60) { spawnIce(penguin.x, penguin.y + 10); lastIceAt = now; }
      penguin.raf = requestAnimationFrame(slideStep);
    }
    penguin.raf = requestAnimationFrame(slideStep);
  }

  function triggerPenguin() {
    removePenguin(); // only ever one on screen — a repeat command restarts the entrance
    slideIn();
  }

  function triggerFish() {
    if (fishInFlight) return; // one fish at a time keeps this readable
    fishInFlight = true;

    const startX = rand(vw() * 0.1, vw() * 0.9);
    const startY = -16;
    const landingY = vh() - 70;
    const fallMs = 2600;
    const t0 = performance.now();

    const fishEl = document.createElement("div");
    fishEl.className = "pf-fish";
    fishEl.textContent = "🐟";
    setPos(fishEl, startX, startY);
    layer.appendChild(fishEl);

    const chasing = !!(penguin && !penguin.dragging);
    const withinReach = chasing && Math.hypot(startX - penguin.x, landingY - penguin.y) < vw() * 0.9;
    const willMiss = withinReach && Math.random() < 0.18; // "less likely" to miss

    if (chasing && withinReach) {
      clearPenguinTimers();
      penguin.el.textContent = "🐧";
      penguin.state = "chasing";
    }

    let fx = startX, fy = startY;
    function fishStep() {
      const t = Math.min(1, (performance.now() - t0) / fallMs);
      fy = startY + (landingY + 40 - startY) * t;
      setPos(fishEl, fx, fy);

      if (penguin && withinReach && !willMiss) {
        const dx = fx - penguin.x, dy = landingY - penguin.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 3) {
          penguin.el.classList.add("pf-run");
          penguin.el.classList.toggle("pf-flip", dx < 0);
          penguin.x += (dx / dist) * 4.4;
          penguin.y += (dy / dist) * 4.4;
          setPos(penguin.el, penguin.x, penguin.y);
        }
      }

      if (t >= 1) { finishFish(); return; }
      requestAnimationFrame(fishStep);
    }
    requestAnimationFrame(fishStep);

    function finishFish() {
      fishInFlight = false;
      const caught = penguin && withinReach && !willMiss;
      const fx2 = fishEl.style.left, fy2 = fishEl.style.top;
      fishEl.remove();
      if (caught) {
        popEmoji(parseFloat(fx2), parseFloat(fy2), "✨");
        penguin.el.classList.remove("pf-run");
        bubble(penguin.el, "😋");
        penguin.timers.afterEat = setTimeout(() => { if (penguin) scheduleWander(); }, 600);
      } else if (penguin) {
        penguin.el.classList.remove("pf-run");
        penguin.state = "sad";
        bubble(penguin.el, "😢");
        penguin.timers.sad = setTimeout(() => { if (penguin) scheduleWander(); }, 3000);
      }
    }
  }

  window.PenguinFun = {
    // Call with any raw chat/host text. Returns true if it was a
    // recognized command (purely informational for the caller — the
    // calling game's own message/feed handling is never altered).
    handleChatText(text) {
      const t = String(text || "").trim().toLowerCase();
      if (t === "!penguin") { triggerPenguin(); return true; }
      if (t === "!fish") { triggerFish(); return true; }
      return false;
    },
  };
})();
