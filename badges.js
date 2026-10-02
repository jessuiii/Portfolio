/* jesu.devs: 3D credential badges.
   The face of each badge is the official badge image, unaltered and unlit (so its colours stay exact).
   It sits on a solid extruded body cut to the badge's own outline, with a gloss layer on top that
   catches the light as the badge moves.

   Loading: the official image is in the HTML, so the badge is visible immediately. three.js is
   fetched once the page is idle, both badges share one WebGL canvas (one context, one environment,
   shaders compiled once, off the main thread where supported), and the 3D badge fades in over the
   image when its first frame is ready. */

const grid = document.querySelector(".certs__grid");
const stages = grid ? [...grid.querySelectorAll(".cert__stage[data-badge]")] : [];
const Q = window.__jjgQuality || { tier: 3, on() {} };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;

const hexPts = (r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 2 + (i * TAU) / 6; return [Math.cos(a) * r, Math.sin(a) * r]; });

/* Each badge: its official image (square, transparent outside the badge), the badge outline in
   badge units (or a JSON file traced from the image), and `span` = how far the image's half-width
   reaches in those units. */
const SPECS = {
  aws: { img: "assets/badge-aws.webp", outline: hexPts(1), round: 0.03, span: 150 / 145.5, edge: "#3c92f9" },
  // outline and ribbon traced from the official image (assets/badge-azure.json)
  azure: { img: "assets/badge-azure.webp", data: "assets/badge-azure.json", round: 0.004, edge: "#0b254a",
    layers: [{ key: "ribbon", lift: 0.05, edge: "#8c8d8a" }] },
};

// polygon with softly rounded corners
function trace(path, pts, r) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i < n; i++) {
    const p = P(i), a = P(i - 1), b = P(i + 1);
    const s = lerp(p, a, Math.min(0.45, r / Math.hypot(p[0] - a[0], p[1] - a[1])));
    const e = lerp(p, b, Math.min(0.45, r / Math.hypot(b[0] - p[0], b[1] - p[1])));
    i === 0 ? path.moveTo(s[0], s[1]) : path.lineTo(s[0], s[1]);
    path.quadraticCurveTo(p[0], p[1], e[0], e[1]);
  }
  path.closePath();
}

async function boot() {
  const THREE = await import("three");

  const cv = document.createElement("canvas"); cv.className = "cert__gl"; cv.setAttribute("aria-hidden", "true"); grid.appendChild(cv);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: Q.tier >= 2, powerPreference: "low-power" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // a small studio for reflections: dim walls, a soft key panel overhead and a few light strips
  const env = (() => {
    const s = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
    const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x1a2a38, side: THREE.BackSide })); room.scale.setScalar(20); s.add(room);
    const panel = (c, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4) })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); s.add(m); };
    panel(0xffffff, 0, 9, 2, 10, 0.2, 6); panel(0xbfe9ff, -9, 1, 3, 0.2, 6, 2); panel(0xffffff, 9, 2, 4, 0.2, 4, 2); panel(0x7dd3fc, 0, -3, 9, 6, 2, 0.2);
    const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, 0.04).texture; pm.dispose();
    return tex;
  })();

  const loader = new THREE.TextureLoader();
  const badges = await Promise.all(stages.map(async (stage) => {
    const spec = SPECS[stage.dataset.badge]; if (!spec) return null;
    const [map, data] = await Promise.all([loader.loadAsync(spec.img), spec.data ? fetch(spec.data).then((r) => r.json()) : null]);
    if (data) Object.assign(spec, { span: data.span, outline: data.outline, layers: (spec.layers || []).map((l) => ({ ...l, outline: data[l.key] })) });
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = aniso;

    const scene = new THREE.Scene(); scene.environment = env;
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50); camera.position.set(0, 0, 6.4);
    const torch = new THREE.PointLight(0xa5f3fc, 4, 12, 1.6); torch.position.set(1.5, 1.2, 3); scene.add(torch);
    const key = new THREE.DirectionalLight(0xffffff, 1); key.position.set(-2, 3, 4); scene.add(key);
    const pivot = new THREE.Group(), badge = new THREE.Group(); pivot.add(badge); scene.add(pivot);

    const faceMat = new THREE.MeshBasicMaterial({ map, toneMapped: false });
    // gloss: adds only reflections and highlights on top of the artwork, never changes its colours
    const gloss = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const B = 0.025;
    // one solid slab: extruded outline with a rounded bevel in the badge's edge colour, and the
    // official image on both faces (mapped 1:1, unlit, so it matches the original exactly)
    const slab = (pts, z0, depth, edge) => {
      const sh = new THREE.Shape(); trace(sh, pts, spec.round);
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: B, bevelSize: B * 0.6, bevelOffset: -B * 0.6, bevelSegments: 5, curveSegments: 10 }),
        new THREE.MeshStandardMaterial({ color: edge, metalness: 0.55, roughness: 0.26 }));
      body.position.z = z0; badge.add(body);
      const cap = new THREE.ShapeGeometry(sh, 10), p = cap.attributes.position, uv = cap.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) / spec.span + 1) / 2, (p.getY(i) / spec.span + 1) / 2);
      const zf = z0 + depth + B + 0.001, zb = -zf;
      [[faceMat, zf, 0], [faceMat, zb, Math.PI], [gloss, zf + 0.001, 0], [gloss, zb - 0.001, Math.PI]].forEach(([m, z, ry]) => {
        const mesh = new THREE.Mesh(cap, m); mesh.position.z = z; mesh.rotation.y = ry; badge.add(mesh);
      });
    };
    const D = 0.1;
    slab(spec.outline, -D / 2, D, spec.edge);
    // raised layers (e.g. the Azure ribbon) stand proud of the face on both sides
    (spec.layers || []).forEach((l) => slab(l.outline, -D / 2 - l.lift, D + 2 * l.lift, l.edge));

    return { stage, card: stage.closest(".cert"), scene, camera, pivot, badge, torch,
      visible: false, entered: false, spin: -TAU, spinTarget: -TAU, vel: 0, drag: null, moved: 0,
      tilt: { x: 0, y: 0 }, tiltT: { x: 0, y: 0 }, phase: Math.random() * TAU, x: 0, y: 0, w: 0, h: 0 };
  }));
  const list = badges.filter(Boolean);
  if (!list.length) return cv.remove();

  // compile every shader up front (in parallel where the browser supports it) so the first frame doesn't stall
  const parallel = renderer.compileAsync && renderer.extensions.has("KHR_parallel_shader_compile");
  await Promise.all(list.map((b) => (parallel ? renderer.compileAsync(b.scene, b.camera) : renderer.compile(b.scene, b.camera))));

  /* ── layout: one canvas over the grid, one viewport per stage ── */
  const dpr = () => Math.min(devicePixelRatio || 1, [1.25, 1, 1.5, 2][Q.tier]);
  let gh = 0;
  const layout = () => {
    const g = grid.getBoundingClientRect(); if (!g.width) return;
    gh = g.height;
    renderer.setPixelRatio(dpr()); renderer.setSize(g.width, g.height, false);
    list.forEach((b) => {
      const r = b.stage.getBoundingClientRect();
      Object.assign(b, { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height });
      b.camera.aspect = r.width / r.height;
      const halfH = Math.tan((b.camera.fov * Math.PI) / 360) * b.camera.position.z;
      b.pivot.scale.setScalar(halfH * 0.8 * Math.min(1, (halfH * b.camera.aspect) / 1.05));
      b.camera.updateProjectionMatrix();
    });
    draw(0);
  };

  /* ── interaction ── */
  list.forEach((b) => {
    b.card.addEventListener("pointermove", (e) => {
      const r = b.stage.getBoundingClientRect();
      b.tiltT.y = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))) * 0.45;
      b.tiltT.x = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2))) * 0.35;
      // the diver's torch follows the pointer across the badge
      b.torch.position.set(((e.clientX - r.left) / r.width - 0.5) * 5, -((e.clientY - r.top) / r.height - 0.5) * 3, 2.6);
      wake();
    });
    b.card.addEventListener("pointerleave", () => { b.tiltT.x = b.tiltT.y = 0; b.torch.position.set(1.5, 1.2, 3); wake(); });
    b.stage.addEventListener("pointerdown", (e) => {
      b.drag = { x: e.clientX, t: performance.now() }; b.moved = 0; b.vel = 0;
      b.stage.setPointerCapture(e.pointerId); wake();
    });
    b.stage.addEventListener("pointermove", (e) => {
      if (!b.drag) return;
      const now = performance.now(), dx = e.clientX - b.drag.x, dt = Math.max(1, now - b.drag.t);
      const d = (dx / Math.max(160, b.w * 0.5)) * Math.PI;
      b.spin += d; b.spinTarget = b.spin; b.vel = (d / dt) * 16; b.moved += Math.abs(dx);
      b.drag.x = e.clientX; b.drag.t = now; wake();
    });
    const end = () => { if (!b.drag) return; b.drag = null; if (!animated()) b.vel = 0; wake(); };
    b.stage.addEventListener("pointerup", end); b.stage.addEventListener("pointercancel", end);
    // a spin is not a click: don't follow the verify link after dragging
    b.card.addEventListener("click", (e) => { if (b.moved > 6) { e.preventDefault(); b.moved = 0; } }, true);
  });

  /* ── loop: only runs while a badge is on screen and something is moving ── */
  let raf = 0, last = 0, t = 0;
  const animated = () => !reduce && Q.tier > 0;
  function step(b, dt) {
    const k = (s) => 1 - Math.exp(-dt * s);
    if (!b.drag) {
      if (Math.abs(b.vel) > 0.0015) { b.spin += b.vel * dt * 60; b.vel *= Math.exp(-dt * 2.2); b.spinTarget = b.spin; }
      else { b.vel = 0; b.spinTarget = Math.round(b.spinTarget / TAU) * TAU; b.spin += (b.spinTarget - b.spin) * k(animated() ? 2.6 : 60); }
    }
    b.tilt.x += (b.tiltT.x - b.tilt.x) * k(6); b.tilt.y += (b.tiltT.y - b.tilt.y) * k(6);
    const a = animated() ? t + b.phase : 0;
    b.pivot.position.y = Math.sin(a * 1.1) * 0.05;
    b.pivot.rotation.set(b.tilt.x + Math.sin(a * 0.7) * 0.05, b.tilt.y + Math.sin(a * 0.45) * 0.28, Math.sin(a * 0.6) * 0.02);
    b.badge.rotation.y = b.spin;
  }
  function draw(dt) {
    renderer.setScissorTest(false); renderer.clear();
    renderer.setScissorTest(true);
    list.forEach((b) => {
      step(b, dt);
      const y = gh - b.y - b.h;
      renderer.setViewport(b.x, y, b.w, b.h); renderer.setScissor(b.x, y, b.w, b.h);
      renderer.render(b.scene, b.camera);
    });
  }
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
    if (!list.some((b) => b.visible)) { last = 0; return; }
    draw(dt);
    const busy = animated() || list.some((b) => b.drag || b.vel !== 0 || Math.abs(b.spinTarget - b.spin) > 0.001 || Math.abs(b.tiltT.x - b.tilt.x) + Math.abs(b.tiltT.y - b.tilt.y) > 0.001);
    if (busy && !document.hidden) raf = requestAnimationFrame(frame); else last = 0;
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }
  document.addEventListener("visibilitychange", wake);

  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const b = list.find((x) => x.stage === e.target); if (!b) return;
    b.visible = e.isIntersecting;
    // entrance: the badge spins in once, the first time it's seen
    if (b.visible && !b.entered) { b.entered = true; b.spinTarget = 0; if (!animated()) b.spin = 0; }
    if (b.visible) wake();
  }), { threshold: 0.15 });
  list.forEach((b) => io.observe(b.stage));

  new ResizeObserver(layout).observe(grid);
  Q.on?.(layout);
  layout();
  grid.classList.add("is-3d");   // swap the flat images for the live badges
}

/* Start once the page has settled (or right away if the section is already close),
   so the 3D is usually ready before anyone scrolls down to it. */
if (stages.length) {
  let started = false;
  const go = () => {
    if (started) return; started = true;
    let ok = false;
    try { ok = !!document.createElement("canvas").getContext("webgl2"); } catch (e) {}
    if (ok) boot().catch((e) => { console.warn("badges:", e); grid.classList.remove("is-3d"); grid.querySelector(".cert__gl")?.remove(); });
  };
  const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); go(); } }, { rootMargin: "1200px 0px" });
  stages.forEach((s) => near.observe(s));
  const c = navigator.connection;
  if (!(c && (c.saveData || /2g/.test(c.effectiveType || "")))) {
    const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1500));
    document.readyState === "complete" ? idle() : addEventListener("load", idle, { once: true });
  }
}
