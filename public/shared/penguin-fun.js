/* ==========================================================================
   PENGUIN FUN (3D) — shared, purely-decorative chat command easter egg.
   Triggered by chat/host text "!penguin" and "!fish". One shared file,
   included identically by every game on this platform.

   Design constraints this file is built around:
   - Never touches any game's DOM, state, or scoring — it only ever reads
     chat text handed to it and draws into its own canvas + a couple of
     small floating DOM "emotion bubbles".
   - The 3D canvas is pointer-events:none, so it can NEVER block a tap on
     game controls. Dragging the penguin is handled by a small *invisible*
     DOM hit-box that tracks the penguin's on-screen position every frame —
     that's the only interactive element, and it's tiny (roughly the
     penguin's own footprint), not a full-screen layer.
   - Kept deliberately low-poly / texture-free / shadow-free: this whole
     platform's design goal is staying smooth on a phone that's also
     encoding a live broadcast, so real 3D lighting/shading is used, but
     cheaply. The render loop itself skips actual WebGL rendering entirely
     whenever nothing is on screen, so there's zero ongoing cost until the
     first "!penguin".
   ========================================================================== */

(function () {
  if (window.PenguinFun) return; // don't double-init if included twice

  function loadThree(onReady) {
    if (window.THREE) { onReady(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
    s.onload = onReady;
    s.onerror = () => console.error("[PenguinFun] Could not load three.js from CDN — the penguin/fish commands will be unavailable this session, but the game itself is completely unaffected.");
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------
  // Small DOM "emotion bubble" layer (Zzz / 😋 / 😢) — real emoji are far
  // more reliable and instantly cute than trying to build 3D text.
  // ---------------------------------------------------------------
  const bubbleLayer = document.createElement("div");
  bubbleLayer.style.cssText = "position:fixed;inset:0;z-index:9001;pointer-events:none;overflow:hidden;";
  document.body.appendChild(bubbleLayer);

  const bubbleStyleId = "penguin-fun-bubble-style";
  if (!document.getElementById(bubbleStyleId)) {
    const style = document.createElement("style");
    style.id = bubbleStyleId;
    style.textContent = `
      .pf-bubble {
        position: absolute; font-size: 20px; transform: translate(-50%, -100%);
        animation: pf-bubble-float 1.1s ease-out forwards;
      }
      @keyframes pf-bubble-float {
        from { opacity: 1; transform: translate(-50%, -100%); }
        to   { opacity: 0; transform: translate(-50%, -160%); }
      }
    `;
    document.head.appendChild(style);
  }

  function showBubble(screenX, screenY, emoji) {
    const b = document.createElement("div");
    b.className = "pf-bubble";
    b.textContent = emoji;
    b.style.left = screenX + "px";
    b.style.top = screenY + "px";
    bubbleLayer.appendChild(b);
    setTimeout(() => b.remove(), 1100);
  }

  // ---------------------------------------------------------------
  // Invisible drag hit-box — the ONLY interactive element. Tracks the
  // penguin's projected screen position every frame while it exists.
  // ---------------------------------------------------------------
  const hitBox = document.createElement("div");
  hitBox.style.cssText = "position:fixed;width:70px;height:70px;transform:translate(-50%,-50%);z-index:9002;pointer-events:none;cursor:grab;touch-action:none;display:none;";
  document.body.appendChild(hitBox);

  // ---------------------------------------------------------------
  // Three.js scene — deferred until the first command actually needs it,
  // so pages that never trigger the easter egg never pay any cost at all.
  // ---------------------------------------------------------------
  let THREE_, scene, camera, renderer;
  let penguin = null;   // { group, x, y, dir, state, timers, dragging, userData }
  let activeFish = [];  // list of in-flight { group, x, y, ... }
  let clock;
  let sceneReady = false;
  let pendingAction = null; // "penguin" | "fish" queued while three.js loads

  function vw() { return window.innerWidth; }
  function vh() { return window.innerHeight; }
  function rand(min, max) { return min + Math.random() * (max - min); }

  function initScene() {
    if (sceneReady) return;
    THREE_ = window.THREE;
    scene = new THREE_.Scene();
    clock = new THREE_.Clock();

    const w = vw(), h = vh();
    camera = new THREE_.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 2000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    renderer = new THREE_.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.domElement.style.cssText = "position:fixed;inset:0;z-index:9000;pointer-events:none;";
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE_.AmbientLight(0xffffff, 0.8));
    const key = new THREE_.DirectionalLight(0xffffff, 0.55);
    key.position.set(120, 160, 220);
    scene.add(key);
    const fill = new THREE_.DirectionalLight(0xbfe0ff, 0.25);
    fill.position.set(-120, -60, 140);
    scene.add(fill);

    window.addEventListener("resize", () => {
      const w2 = vw(), h2 = vh();
      camera.left = -w2 / 2; camera.right = w2 / 2; camera.top = h2 / 2; camera.bottom = -h2 / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });

    sceneReady = true;
    requestAnimationFrame(loop);
  }

  // screen(px, y-down, origin top-left)  <->  world (units, y-up, origin center)
  function toWorld(x, y) { return { x: x - vw() / 2, y: vh() / 2 - y }; }
  function toScreen(x, y) { return { x: x + vw() / 2, y: vh() / 2 - y }; }

  // ---------------------------------------------------------------
  // Model builders — low-poly, texture-free, solid-colour "toy figurine"
  // style. Everything is a plain primitive; the cuteness comes from
  // proportion + soft Phong shading, not detail.
  // ---------------------------------------------------------------
  function buildPenguin() {
    const T = THREE_;
    const group = new T.Group();
    const bodyPivot = new T.Group();
    group.add(bodyPivot);

    const darkMat = new T.MeshPhongMaterial({ color: 0x232a3a, shininess: 30 });
    const bellyMat = new T.MeshPhongMaterial({ color: 0xfbfdff, shininess: 12 });
    const beakMat = new T.MeshPhongMaterial({ color: 0xffa236, shininess: 45 });
    const eyeMat = new T.MeshBasicMaterial({ color: 0x14171f });

    const torso = new T.Mesh(new T.SphereGeometry(15, 20, 16), darkMat);
    torso.scale.set(1, 1.25, 0.9);
    torso.position.y = 20;
    bodyPivot.add(torso);

    const belly = new T.Mesh(new T.SphereGeometry(10.5, 16, 14), bellyMat);
    belly.scale.set(0.82, 1.05, 0.5);
    belly.position.set(0, 17, 11.5);
    bodyPivot.add(belly);

    const headPivot = new T.Group();
    headPivot.position.set(0, 39, 3);
    bodyPivot.add(headPivot);

    const head = new T.Mesh(new T.SphereGeometry(10, 18, 14), darkMat);
    headPivot.add(head);

    const beak = new T.Mesh(new T.ConeGeometry(3.2, 7.5, 10), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -1, 8.5);
    headPivot.add(beak);

    const eyeGeo = new T.SphereGeometry(1.5, 8, 8);
    const eyeL = new T.Mesh(eyeGeo, eyeMat); eyeL.position.set(-3.8, 2, 6.8); headPivot.add(eyeL);
    const eyeR = new T.Mesh(eyeGeo, eyeMat); eyeR.position.set(3.8, 2, 6.8); headPivot.add(eyeR);

    function makeFlipper(sign) {
      const pivot = new T.Group();
      pivot.position.set(sign * 14, 30, 0);
      const geo = T.CapsuleGeometry ? new T.CapsuleGeometry(3, 13, 4, 8) : new T.BoxGeometry(5, 15, 3);
      const flip = new T.Mesh(geo, darkMat);
      flip.position.y = -8;
      pivot.add(flip);
      bodyPivot.add(pivot);
      return pivot;
    }
    const leftFlipper = makeFlipper(-1);
    const rightFlipper = makeFlipper(1);

    function makeFoot(sign) {
      const pivot = new T.Group();
      pivot.position.set(sign * 6, 2, 4);
      const foot = new T.Mesh(new T.BoxGeometry(7, 2.2, 10), beakMat);
      foot.position.z = 3;
      pivot.add(foot);
      bodyPivot.add(pivot);
      return pivot;
    }
    const leftFoot = makeFoot(-1);
    const rightFoot = makeFoot(1);

    group.userData = { bodyPivot, headPivot, leftFlipper, rightFlipper, leftFoot, rightFoot, eyeL, eyeR };
    return group;
  }

  function buildFish() {
    const T = THREE_;
    const group = new T.Group();
    const bodyMat = new T.MeshPhongMaterial({ color: 0x6fc3e8, shininess: 90, specular: 0xffffff });
    const finMat = new T.MeshPhongMaterial({ color: 0x3f8fc4, shininess: 60 });

    const body = new T.Mesh(new T.SphereGeometry(7.5, 16, 12), bodyMat);
    body.scale.set(1, 0.68, 0.48);
    group.add(body);

    const tail = new T.Mesh(new T.ConeGeometry(5.5, 9, 4), finMat);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-10.5, 0, 0);
    group.add(tail);

    const dorsal = new T.Mesh(new T.ConeGeometry(2.6, 5, 4), finMat);
    dorsal.position.set(0, 5.5, 0);
    group.add(dorsal);

    const eye = new T.Mesh(new T.SphereGeometry(1.1, 6, 6), new T.MeshBasicMaterial({ color: 0x14171f }));
    eye.position.set(5.5, 1.8, 3);
    group.add(eye);

    return group;
  }

  function buildIceChip() {
    const T = THREE_;
    const mat = new T.MeshPhongMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.85, shininess: 90, specular: 0xffffff });
    return new T.Mesh(new T.BoxGeometry(13, 3, 7), mat);
  }

  function spawnIce(x, y) {
    const ice = buildIceChip();
    ice.position.set(x, y, 0);
    scene.add(ice);
    const t0 = performance.now();
    (function fade() {
      const t = (performance.now() - t0) / 1000;
      if (t >= 1) { scene.remove(ice); return; }
      ice.material.opacity = 0.85 * (1 - t);
      requestAnimationFrame(fade);
    })();
  }

  function popSparkle(x, y) {
    const T = THREE_;
    const geo = new T.SphereGeometry(1.4, 6, 6);
    const mat = new T.MeshBasicMaterial({ color: 0xffe38a, transparent: true });
    const group = new T.Group();
    for (let i = 0; i < 5; i++) {
      const m = new T.Mesh(geo, mat.clone());
      m.userData.dir = { x: rand(-1, 1), y: rand(0.4, 1.4) };
      group.add(m);
    }
    group.position.set(x, y, 4);
    scene.add(group);
    const t0 = performance.now();
    (function anim() {
      const t = (performance.now() - t0) / 450;
      if (t >= 1) { scene.remove(group); return; }
      group.children.forEach((m) => {
        m.position.x = m.userData.dir.x * 14 * t;
        m.position.y = m.userData.dir.y * 14 * t;
        m.material.opacity = 1 - t;
      });
      requestAnimationFrame(anim);
    })();
  }

  // ---------------------------------------------------------------
  // Penguin pose + movement
  // ---------------------------------------------------------------
  function clearPenguinTimers() {
    if (!penguin) return;
    Object.values(penguin.timers).forEach(clearTimeout);
    penguin.timers = {};
  }

  function removePenguin() {
    if (!penguin) return;
    clearPenguinTimers();
    scene.remove(penguin.group);
    disarmHitBox();
    penguin = null;
  }

  function updateHitBox() {
    if (!penguin) return;
    const s = toScreen(penguin.x, penguin.y);
    hitBox.style.left = s.x + "px";
    hitBox.style.top = (s.y - 20) + "px";
    hitBox.style.display = "block";
  }

  function updatePenguinPose(t) {
    const u = penguin.group.userData;
    const st = penguin.state;
    const lerp = THREE_.MathUtils.lerp;

    if (st === "sliding") {
      u.bodyPivot.rotation.x = lerp(u.bodyPivot.rotation.x, 1.3, 0.15);
      u.leftFlipper.rotation.z = lerp(u.leftFlipper.rotation.z, -0.9, 0.15);
      u.rightFlipper.rotation.z = lerp(u.rightFlipper.rotation.z, 0.9, 0.15);
    } else if (st === "sleeping") {
      u.bodyPivot.rotation.x = lerp(u.bodyPivot.rotation.x, 1.15, 0.1);
      u.headPivot.rotation.x = lerp(u.headPivot.rotation.x, 0.35, 0.1);
      u.leftFlipper.rotation.z = lerp(u.leftFlipper.rotation.z, -0.1, 0.1);
      u.rightFlipper.rotation.z = lerp(u.rightFlipper.rotation.z, 0.1, 0.1);
    } else if (st === "sad") {
      u.bodyPivot.rotation.x = lerp(u.bodyPivot.rotation.x, 0, 0.15);
      u.headPivot.rotation.x = lerp(u.headPivot.rotation.x, 0.55, 0.15);
      u.leftFlipper.rotation.z = lerp(u.leftFlipper.rotation.z, -0.05, 0.1);
      u.rightFlipper.rotation.z = lerp(u.rightFlipper.rotation.z, 0.05, 0.1);
    } else if (st === "eating") {
      u.headPivot.rotation.x = 0.5 * Math.sin(t * 14);
      u.bodyPivot.rotation.x = lerp(u.bodyPivot.rotation.x, 0, 0.2);
    } else {
      u.bodyPivot.rotation.x = lerp(u.bodyPivot.rotation.x, 0, 0.15);
      u.headPivot.rotation.x = lerp(u.headPivot.rotation.x, 0, 0.15);
      const moving = st === "walking" || st === "running" || st === "chasing";
      if (moving) {
        const freq = st === "walking" ? 6 : 10;
        const w = Math.sin(t * freq);
        u.leftFoot.rotation.x = w * 0.5;
        u.rightFoot.rotation.x = -w * 0.5;
        u.leftFlipper.rotation.z = -0.15 - w * 0.25;
        u.rightFlipper.rotation.z = 0.15 + w * 0.25;
        u.bodyPivot.rotation.z = w * 0.06;
        u.bodyPivot.position.y = Math.abs(Math.cos(t * freq)) * (st === "running" ? 3 : 1.4);
      } else {
        u.leftFoot.rotation.x = lerp(u.leftFoot.rotation.x, 0, 0.1);
        u.rightFoot.rotation.x = lerp(u.rightFoot.rotation.x, 0, 0.1);
        u.leftFlipper.rotation.z = lerp(u.leftFlipper.rotation.z, -0.15, 0.1);
        u.rightFlipper.rotation.z = lerp(u.rightFlipper.rotation.z, 0.15, 0.1);
        u.bodyPivot.rotation.z = lerp(u.bodyPivot.rotation.z, 0, 0.1);
        u.bodyPivot.position.y = Math.sin(t * 2) * 1;
      }
    }
  }

  function faceDirection(dx) {
    if (Math.abs(dx) > 0.5) penguin.group.scale.x = dx < 0 ? -1 : 1;
  }

  function moveTo(target, speed, onArrive, stateName) {
    if (!penguin) return;
    penguin.state = stateName || "walking";
    function step() {
      if (!penguin || penguin.dragging) return;
      const dx = target.x - penguin.x, dy = target.y - penguin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        penguin.x = target.x; penguin.y = target.y;
        penguin.group.position.set(penguin.x, penguin.y, 0);
        if (onArrive) onArrive();
        return;
      }
      faceDirection(dx);
      penguin.x += (dx / dist) * speed;
      penguin.y += (dy / dist) * speed;
      penguin.group.position.set(penguin.x, penguin.y, 0);
      penguin.timers.moveRaf = requestAnimationFrame(step);
    }
    step();
  }

  function scheduleWander() {
    if (!penguin) return;
    penguin.state = "standing";
    const delay = rand(1200, 3200);
    penguin.timers.wander = setTimeout(() => {
      if (!penguin || penguin.dragging) return;
      if (Math.random() < 0.22) { napPenguin(); return; }
      const margin = 60;
      const target = { x: rand(-vw() / 2 + margin, vw() / 2 - margin), y: rand(-vh() / 2 + margin, vh() / 2 - 40) };
      moveTo(target, 1.5, scheduleWander, "walking");
    }, delay);
  }

  function napPenguin() {
    if (!penguin) return;
    penguin.state = "sleeping";
    const s = toScreen(penguin.x, penguin.y);
    showBubble(s.x, s.y - 45, "💤");
    penguin.timers.nap = setTimeout(() => { if (penguin) scheduleWander(); }, 3000);
  }

  function armHitBox() { hitBox.style.pointerEvents = "auto"; hitBox.style.cursor = "grab"; hitBox.style.display = "block"; }
  function disarmHitBox() { hitBox.style.pointerEvents = "none"; hitBox.style.display = "none"; }

  function attachDrag() {
    hitBox.addEventListener("pointerdown", (e) => {
      if (!penguin) return;
      penguin.dragging = true;
      clearPenguinTimers();
      penguin.state = "standing";
      try { hitBox.setPointerCapture(e.pointerId); } catch (err) {}
      hitBox.style.cursor = "grabbing";
    });
    hitBox.addEventListener("pointermove", (e) => {
      if (!penguin || !penguin.dragging) return;
      const w = toWorld(e.clientX, e.clientY);
      faceDirection(w.x - penguin.x);
      penguin.x = w.x; penguin.y = w.y;
      penguin.group.position.set(penguin.x, penguin.y, 0);
    });
    function endDrag() {
      if (!penguin || !penguin.dragging) return;
      penguin.dragging = false;
      hitBox.style.cursor = "grab";
      scheduleWander();
    }
    hitBox.addEventListener("pointerup", endDrag);
    hitBox.addEventListener("pointercancel", endDrag);
  }
  attachDrag();

  function slideIn() {
    const startWorld = toWorld(rand(vw() * 0.15, vw() * 0.85), rand(24, vh() * 0.12));
    const midWorld = { x: rand(-40, 40), y: 0 };
    const endWorld = toWorld(rand(vw() * 0.15, vw() * 0.85), rand(vh() * 0.65, vh() - 80));

    const group = buildPenguin();
    group.position.set(startWorld.x, startWorld.y, 0);
    scene.add(group);

    penguin = { group, x: startWorld.x, y: startWorld.y, state: "sliding", timers: {}, dragging: false };
    armHitBox();

    const waypoints = [startWorld, midWorld, endWorld];
    let wpIndex = 0, lastIceAt = 0;

    function step() {
      if (!penguin || penguin.dragging) return;
      const target = waypoints[wpIndex + 1];
      if (!target) { scheduleWander(); return; }
      const dx = target.x - penguin.x, dy = target.y - penguin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) { wpIndex++; penguin.timers.slideRaf = requestAnimationFrame(step); return; }
      faceDirection(dx);
      penguin.x += (dx / dist) * 6.2;
      penguin.y += (dy / dist) * 6.2;
      penguin.group.position.set(penguin.x, penguin.y, 0);
      const now = performance.now();
      if (now - lastIceAt > 55) { spawnIce(penguin.x, penguin.y - 10); lastIceAt = now; }
      penguin.timers.slideRaf = requestAnimationFrame(step);
    }
    step();
  }

  function triggerPenguin() {
    removePenguin();
    slideIn();
  }

  function triggerFish() {
    if (activeFish.length > 0) return; // one fish at a time keeps this readable
    const startWorld = toWorld(rand(vw() * 0.1, vw() * 0.9), -16);
    const landingWorld = toWorld(0, vh() - 70);
    const fallMs = 2600;
    const t0 = performance.now();

    const group = buildFish();
    group.position.set(startWorld.x, startWorld.y, 0);
    scene.add(group);
    const fish = { group, x: startWorld.x, y: startWorld.y };
    activeFish.push(fish);

    const chasing = !!(penguin && !penguin.dragging);
    const withinReach = chasing && Math.hypot(startWorld.x - penguin.x, landingWorld.y - penguin.y) < vw();
    const willMiss = withinReach && Math.random() < 0.18; // "less likely" to miss

    if (chasing && withinReach) { clearPenguinTimers(); penguin.state = "chasing"; }

    function step() {
      const t = Math.min(1, (performance.now() - t0) / fallMs);
      fish.y = startWorld.y + (landingWorld.y - 30 - startWorld.y) * t;
      fish.group.position.set(fish.x, fish.y, 0);
      fish.group.rotation.z = Math.sin(t * 10) * 0.25; // little swim wiggle

      if (penguin && withinReach && !willMiss) {
        const dx = fish.x - penguin.x, dy = landingWorld.y - penguin.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 3) {
          faceDirection(dx);
          penguin.x += (dx / dist) * 4.2;
          penguin.y += (dy / dist) * 4.2;
          penguin.group.position.set(penguin.x, penguin.y, 0);
        }
      }
      if (t >= 1) { finish(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    function finish() {
      activeFish = activeFish.filter((f) => f !== fish);
      const caught = penguin && withinReach && !willMiss;
      const sx = toScreen(fish.x, fish.y);
      scene.remove(fish.group);
      if (caught) {
        penguin.state = "eating";
        popSparkle(fish.x, fish.y);
        showBubble(sx.x, sx.y - 30, "😋");
        penguin.timers.afterEat = setTimeout(() => { if (penguin) scheduleWander(); }, 700);
      } else if (penguin) {
        penguin.state = "sad";
        const ps = toScreen(penguin.x, penguin.y);
        showBubble(ps.x, ps.y - 45, "😢");
        penguin.timers.sad = setTimeout(() => { if (penguin) scheduleWander(); }, 3000);
      }
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!penguin && activeFish.length === 0) return; // nothing to draw — skip the render entirely
    const t = clock.getElapsedTime();
    if (penguin) { updatePenguinPose(t); updateHitBox(); }
    renderer.render(scene, camera);
  }

  window.PenguinFun = {
    handleChatText(text) {
      const t = String(text || "").trim().toLowerCase();
      if (t !== "!penguin" && t !== "!fish") return false;
      if (!window.THREE) {
        pendingAction = t === "!penguin" ? "penguin" : "fish";
        loadThree(() => {
          initScene();
          if (pendingAction === "penguin") triggerPenguin();
          else if (pendingAction === "fish") triggerFish();
          pendingAction = null;
        });
        return true;
      }
      if (!sceneReady) initScene();
      if (t === "!penguin") triggerPenguin(); else triggerFish();
      return true;
    },
  };
})();
