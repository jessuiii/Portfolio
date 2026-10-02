/* jesu.devs: 3D credential badges.
   Each .cert__stage gets a real-time Three.js badge: an extruded metal body with a raised rim,
   a printed clear-coated face, an engraved back, and (for Azure) a curved ribbon.
   three.js is only fetched when the credentials section gets close to the viewport. */

const stages = [...document.querySelectorAll(".cert__stage[data-badge]")];
const Q = window.__jjgQuality || { tier: 3, on() {} };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;
const TEX = 1024;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/* ── shapes (badge space: roughly x,y ∈ [-1, 1]) ── */
function hexPts(r) {
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 2 + (i * TAU) / 6; return [Math.cos(a) * r, Math.sin(a) * r]; });
}
function shieldPts(s) {
  const pts = [[-0.78, 0.92], [0.78, 0.92], [0.82, -0.12]];
  for (let i = 1; i < 8; i++) { const t = i / 8; pts.push([0.82 * (1 - t) ** 1.35, -0.12 - 0.86 * Math.sin((t * Math.PI) / 2)]); }
  pts.push([0, -1]);
  for (let i = 7; i > 0; i--) { const t = i / 8; pts.push([-0.82 * (1 - t) ** 1.35, -0.12 - 0.86 * Math.sin((t * Math.PI) / 2)]); }
  pts.push([-0.82, -0.12]);
  return pts.map(([x, y]) => [x * s, y * s + (1 - s) * 0.04]);
}
// polygon with softly rounded corners, traced onto a Shape/Path or a 2D canvas context
function trace(ctx, pts, r, map = (p) => p) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i < n; i++) {
    const p = P(i), a = P(i - 1), b = P(i + 1);
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const s = lerp(p, a, Math.min(0.45, r / la)), e = lerp(p, b, Math.min(0.45, r / lb));
    const [sx, sy] = map(s), [px, py] = map(p), [ex, ey] = map(e);
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    ctx.quadraticCurveTo(px, py, ex, ey);
  }
  ctx.closePath?.();
}
const toPx = ([x, y]) => [((x + 1) / 2) * TEX, (1 - (y + 1) / 2) * TEX];

/* ── printed faces (2D canvas → texture) ── */
function canvas() { const c = document.createElement("canvas"); c.width = c.height = TEX; return c; }
function spaced(g, text, x, y, sp) {
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width, 0) + sp * (text.length - 1);
  let cx = x - w / 2;
  for (const ch of text) { g.fillText(ch, cx + g.measureText(ch).width / 2, y); cx += g.measureText(ch).width + sp; }
}
function sheen(g, clip) {
  g.save(); clip(); g.clip();
  const l = g.createLinearGradient(0, 0, TEX, TEX);
  l.addColorStop(0, "rgba(255,255,255,.10)"); l.addColorStop(0.45, "rgba(255,255,255,0)"); l.addColorStop(1, "rgba(0,0,0,.18)");
  g.fillStyle = l; g.fillRect(0, 0, TEX, TEX);
  g.restore();
}

function awsFace() {
  const c = canvas(), g = c.getContext("2d");
  const clip = () => { g.beginPath(); trace(g, hexPts(0.92), 0.06, toPx); };
  clip();
  const bg = g.createLinearGradient(TEX * 0.2, TEX * 0.1, TEX * 0.8, TEX * 0.95);
  bg.addColorStop(0, "#3d3ff7"); bg.addColorStop(0.55, "#2a2bd6"); bg.addColorStop(1, "#14138a");
  g.fillStyle = bg; g.fill();
  g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillStyle = "#fff";
  // aws wordmark + orange check
  g.font = `700 112px ${SANS}`; g.fillText("aws", TEX / 2 - 22, 300);
  g.save(); g.translate(TEX / 2 + 98, 228); g.beginPath(); trace(g, hexPts(34), 6, ([x, y]) => [x, -y]); g.fillStyle = "#ff9900"; g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = 8; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.moveTo(-14, 0); g.lineTo(-3, 11); g.lineTo(16, -11); g.stroke(); g.restore();
  g.font = `400 84px ${SANS}`; g.fillText("certified", TEX / 2, 382);
  g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(TEX * 0.24, 430, TEX * 0.52, 3);
  g.fillStyle = "#fff"; g.font = `700 96px ${SANS}`;
  g.fillText("Solutions", TEX / 2, 540); g.fillText("Architect", TEX / 2, 644);
  g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(TEX * 0.24, 690, TEX * 0.52, 3);
  g.fillStyle = "#fff"; g.font = `700 50px ${SANS}`; spaced(g, "ASSOCIATE", TEX / 2, 776, 14);
  sheen(g, clip);
  return c;
}

function msLogo(g, x, y, s) {
  const gap = s * 0.08, q = (s - gap) / 2;
  [["#f25022", 0, 0], ["#7fba00", 1, 0], ["#00a4ef", 0, 1], ["#ffb900", 1, 1]].forEach(([c, i, j]) => { g.fillStyle = c; g.fillRect(x + i * (q + gap), y + j * (q + gap), q, q); });
}
function azureFace() {
  const c = canvas(), g = c.getContext("2d");
  const clip = () => { g.beginPath(); trace(g, shieldPts(0.92), 0.08, toPx); };
  clip();
  const bg = g.createLinearGradient(0, TEX * 0.05, 0, TEX * 0.95);
  bg.addColorStop(0, "#1a8fe6"); bg.addColorStop(0.5, "#0b5cad"); bg.addColorStop(1, "#06306b");
  g.fillStyle = bg; g.fill();
  // fine radial burst
  g.save(); clip(); g.clip(); g.translate(TEX / 2, TEX * 0.42);
  for (let i = 0; i < 72; i++) { g.rotate(TAU / 72); g.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : "rgba(255,255,255,0)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(-30, -900); g.lineTo(30, -900); g.fill(); }
  g.restore();
  g.textAlign = "center"; g.fillStyle = "#fff";
  msLogo(g, TEX / 2 - 44, 150, 88);
  g.font = `600 56px ${SANS}`; g.fillText("Microsoft", TEX / 2, 320);
  g.font = `700 40px ${SANS}`; spaced(g, "CERTIFIED", TEX / 2, 374, 12);
  g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(TEX * 0.3, 410, TEX * 0.4, 3);
  g.fillStyle = "#fff"; g.font = `700 76px ${SANS}`;
  g.fillText("Azure AI Apps", TEX / 2, 504); g.fillText("& Agents", TEX / 2, 588); g.fillText("Developer", TEX / 2, 672);
  sheen(g, clip);
  return c;
}

function ribbonTex() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 160; const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 0, 160);
  bg.addColorStop(0, "#5fb4ff"); bg.addColorStop(0.18, "#1f7fe0"); bg.addColorStop(0.82, "#0d58b4"); bg.addColorStop(1, "#083d82");
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(0, 14, 1024, 3); g.fillRect(0, 143, 1024, 3);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `700 64px ${SANS}`;
  spaced(g, "ASSOCIATE", 512, 84, 18);
  return c;
}

function backFace(shape, tint, code, issuer) {
  const c = canvas(), g = c.getContext("2d");
  const clip = () => { g.beginPath(); trace(g, shape, 0.07, toPx); };
  clip(); g.fillStyle = tint; g.fill();
  // brushed-metal grain
  g.save(); clip(); g.clip();
  for (let y = 0; y < TEX; y += 3) { g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`; g.fillRect(0, y, TEX, 1); }
  g.restore();
  g.textAlign = "center"; g.fillStyle = "rgba(225,240,255,.9)";
  g.font = `600 34px "JetBrains Mono", ui-monospace, monospace`;
  spaced(g, "VERIFIED CREDENTIAL", TEX / 2, 360, 6);
  g.font = `800 130px "Bricolage Grotesque", ${SANS}`; g.fillText(code, TEX / 2, 520);
  g.font = `500 44px "Bricolage Grotesque", ${SANS}`; g.fillText("Jesu Joel George", TEX / 2, 610);
  g.fillStyle = "rgba(225,240,255,.55)"; g.font = `500 28px "JetBrains Mono", ui-monospace, monospace`;
  spaced(g, issuer, TEX / 2, 670, 4);
  return c;
}

const SPECS = {
  aws: {
    outline: (s) => hexPts(s), r: 0.06,
    rim: "#5b8ef2", body: "#1b1c8c", face: awsFace,
    back: () => backFace(hexPts(0.95), "#1c2a7a", "SAA-C03", "AMAZON WEB SERVICES"),
  },
  azure: {
    outline: (s) => shieldPts(s), r: 0.08,
    rim: "#b9d7f5", body: "#0a3f82", face: azureFace, ribbon: true,
    back: () => backFace(shieldPts(0.95), "#0b3a73", "AI-103", "MICROSOFT"),
  },
};

/* ── build ── */
async function boot() {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");

  const shapeOf = (pts, r, holePts) => {
    const s = new THREE.Shape(); trace(s, pts, r);
    if (holePts) { const h = new THREE.Path(); trace(h, holePts, r * 0.8); s.holes.push(h); }
    return s;
  };
  // flat cap whose UVs line up with the 1024² face canvas
  const capGeo = (pts, r) => {
    const geo = new THREE.ShapeGeometry(shapeOf(pts, r), 12), p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 1) / 2, (p.getY(i) + 1) / 2);
    return geo;
  };
  const tex = (c, aniso) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };

  const badges = stages.map((stage) => {
    const spec = SPECS[stage.dataset.badge]; if (!spec) return null;
    const card = stage.closest(".cert");
    const cv = document.createElement("canvas"); cv.className = "cert__gl"; stage.appendChild(cv);
    const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: Q.tier >= 2, powerPreference: "low-power" });
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50); camera.position.set(0, 0, 6.4);

    const torch = new THREE.PointLight(0xa5f3fc, 6, 12, 1.6); torch.position.set(1.5, 1.2, 3); scene.add(torch);
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(-2, 3, 4); scene.add(key);

    const pivot = new THREE.Group(), badge = new THREE.Group(); pivot.add(badge); scene.add(pivot);
    const D = 0.12;
    const metal = (color, rough) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.15 });

    // body plate
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(spec.outline(0.95), spec.r), { depth: D, bevelEnabled: false, curveSegments: 8 }), metal(spec.body, 0.35));
    body.position.z = -D / 2; badge.add(body);
    // raised rim (a ring that stands proud of both faces)
    const rimGeo = new THREE.ExtrudeGeometry(shapeOf(spec.outline(1), spec.r, spec.outline(0.9)), { depth: D + 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 4, curveSegments: 8 });
    const rim = new THREE.Mesh(rimGeo, metal(spec.rim, 0.22)); rim.position.z = -(D + 0.04) / 2; badge.add(rim);
    // printed, clear-coated face with a faint holographic film
    const faceMat = new THREE.MeshPhysicalMaterial({ map: tex(spec.face(), aniso), metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.55, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520] });
    const face = new THREE.Mesh(capGeo(spec.outline(0.92), spec.r), faceMat); face.position.z = D / 2 + 0.002; badge.add(face);
    const backMat = new THREE.MeshPhysicalMaterial({ map: tex(spec.back(), aniso), metalness: 0.85, roughness: 0.4, clearcoat: 0.6 });
    const back = new THREE.Mesh(capGeo(spec.outline(0.95), spec.r), backMat); back.rotation.y = Math.PI; back.position.z = -D / 2 - 0.002; badge.add(back);

    if (spec.ribbon) {
      // curved band that wraps forward over the shield, with folded tails tucked behind
      const W = 1.9, H = 0.26, y = -0.5;
      const rg = new THREE.PlaneGeometry(W, H, 48, 1), rp = rg.attributes.position;
      for (let i = 0; i < rp.count; i++) { const x = rp.getX(i); rp.setZ(i, 0.2 - 0.16 * (x / (W / 2)) ** 2); }
      rg.computeVertexNormals();
      const ribbon = new THREE.Mesh(rg, new THREE.MeshPhysicalMaterial({ map: tex(ribbonTex(), aniso), roughness: 0.38, metalness: 0.15, clearcoat: 0.8, side: THREE.DoubleSide }));
      ribbon.position.y = y; badge.add(ribbon);
      const tailMat = new THREE.MeshStandardMaterial({ color: 0x06306b, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
      [-1, 1].forEach((sd) => {
        const ts = new THREE.Shape(); ts.moveTo(0, H / 2); ts.lineTo(0.34, H / 2); ts.lineTo(0.24, 0); ts.lineTo(0.34, -H / 2); ts.lineTo(0, -H / 2); ts.closePath();
        const tail = new THREE.Mesh(new THREE.ShapeGeometry(ts), tailMat);
        tail.scale.x = sd; tail.position.set(sd * (W / 2 - 0.12), y - 0.07, 0.0); tail.rotation.y = sd * -0.55; badge.add(tail);
      });
    }

    return { stage, card, cv, renderer, scene, camera, pivot, badge, torch, faceMat,
      visible: false, entered: false, spin: -TAU, spinTarget: -TAU, vel: 0, drag: null, moved: 0,
      tilt: { x: 0, y: 0 }, tiltT: { x: 0, y: 0 }, xOff: 0, halfW: 1, phase: Math.random() * TAU, w: 0, h: 0 };
  }).filter(Boolean);

  /* ── sizing / quality ── */
  const dpr = () => Math.min(devicePixelRatio || 1, [1.25, 1, 1.5, 2][Q.tier]);
  const resize = (b) => {
    const r = b.stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    b.w = r.width; b.h = r.height;
    b.renderer.setPixelRatio(dpr()); b.renderer.setSize(r.width, r.height, false);
    b.camera.aspect = r.width / r.height;
    // badge fills ~76% of the stage height; on wide stages it sits right of centre
    const halfH = Math.tan((b.camera.fov * Math.PI) / 360) * b.camera.position.z;
    const fit = Math.min(1, (halfH * b.camera.aspect) / 1.15);
    b.pivot.scale.setScalar((halfH * 0.76) * fit);
    b.halfW = halfH * b.camera.aspect;
    b.xOff = b.camera.aspect > 1.5 ? b.halfW * 0.38 : 0;
    b.camera.updateProjectionMatrix();
    paint(b, 0);
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => { const b = badges.find((x) => x.stage === e.target); b && resize(b); }));
  badges.forEach((b) => ro.observe(b.stage));
  Q.on?.(() => badges.forEach(resize));

  /* ── interaction ── */
  badges.forEach((b) => {
    b.card.addEventListener("pointermove", (e) => {
      const r = b.stage.getBoundingClientRect();
      const cx = r.left + r.width / 2 + (b.xOff / b.halfW) * (r.width / 2);
      b.tiltT.y = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2))) * 0.45;
      b.tiltT.x = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2))) * 0.35;
      // the diver's torch follows the pointer across the badge
      b.torch.position.set(((e.clientX - r.left) / r.width - 0.5) * 5, -((e.clientY - r.top) / r.height - 0.5) * 3, 2.6);
      wake();
    });
    b.card.addEventListener("pointerleave", () => { b.tiltT.x = b.tiltT.y = 0; b.torch.position.set(1.5, 1.2, 3); wake(); });
    b.cv.addEventListener("pointerdown", (e) => {
      b.drag = { x: e.clientX, t: performance.now() }; b.moved = 0; b.vel = 0;
      b.cv.setPointerCapture(e.pointerId); wake();
    });
    b.cv.addEventListener("pointermove", (e) => {
      if (!b.drag) return;
      const now = performance.now(), dx = e.clientX - b.drag.x, dt = Math.max(1, now - b.drag.t);
      const d = (dx / Math.max(160, b.w * 0.5)) * Math.PI;
      b.spin += d; b.spinTarget = b.spin; b.vel = (d / dt) * 16; b.moved += Math.abs(dx);
      b.drag.x = e.clientX; b.drag.t = now; wake();
    });
    const end = () => { if (!b.drag) return; b.drag = null; if (reduce || Q.tier === 0) { b.vel = 0; b.spinTarget = Math.round(b.spin / TAU) * TAU; } wake(); };
    b.cv.addEventListener("pointerup", end); b.cv.addEventListener("pointercancel", end);
    // a spin is not a click: don't follow the verify link after dragging
    b.card.addEventListener("click", (e) => { if (b.moved > 6) { e.preventDefault(); b.moved = 0; } }, true);
  });

  /* ── loop: only runs while a badge is on screen and something is moving ── */
  let raf = 0, last = 0, t = 0;
  const animated = () => !reduce && Q.tier > 0;
  function paint(b, dt) {
    const k = (s) => 1 - Math.exp(-dt * s);
    if (!b.drag) {
      if (Math.abs(b.vel) > 0.0015) { b.spin += b.vel * dt * 60; b.vel *= Math.exp(-dt * 2.2); b.spinTarget = b.spin; }
      else { b.vel = 0; b.spinTarget = Math.round(b.spinTarget / TAU) * TAU; b.spin += (b.spinTarget - b.spin) * k(animated() ? 2.6 : 60); }
    }
    b.tilt.x += (b.tiltT.x - b.tilt.x) * k(6); b.tilt.y += (b.tiltT.y - b.tilt.y) * k(6);
    const a = animated() ? t + b.phase : 0;
    b.pivot.position.set(b.xOff, Math.sin(a * 1.1) * 0.05, 0);
    b.pivot.rotation.set(b.tilt.x + Math.sin(a * 0.7) * 0.05, b.tilt.y + Math.sin(a * 0.45) * 0.28, Math.sin(a * 0.6) * 0.02);
    b.badge.rotation.y = b.spin;
    b.renderer.render(b.scene, b.camera);
  }
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
    let busy = false;
    badges.forEach((b) => {
      if (!b.visible) return;
      paint(b, dt);
      busy ||= animated() || !!b.drag || b.vel !== 0 || Math.abs(b.spinTarget - b.spin) > 0.001 || Math.abs(b.tiltT.x - b.tilt.x) + Math.abs(b.tiltT.y - b.tilt.y) > 0.001;
    });
    if (busy && !document.hidden) raf = requestAnimationFrame(frame); else last = 0;
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }
  document.addEventListener("visibilitychange", wake);

  const io = new IntersectionObserver((es) => es.forEach((e) => {
    const b = badges.find((x) => x.stage === e.target); if (!b) return;
    b.visible = e.isIntersecting;
    // entrance: the badge spins in once, the first time it's seen
    if (b.visible && !b.entered) { b.entered = true; b.spinTarget = 0; if (!animated()) b.spin = 0; }
    if (b.visible) wake();
  }), { threshold: 0.15 });
  badges.forEach((b) => { io.observe(b.stage); b.stage.classList.add("is-3d"); });
}

// flat fallback when WebGL / three.js isn't available
function flat() {
  stages.forEach((s) => {
    const spec = SPECS[s.dataset.badge]; if (!spec || s.querySelector(".cert__flat")) return;
    const c = spec.face(); c.className = "cert__flat"; s.appendChild(c);
  });
}

if (stages.length) {
  const go = () => document.fonts.ready.then(() => {
    let ok = false;
    try { ok = !!document.createElement("canvas").getContext("webgl2"); } catch (e) {}
    return ok ? boot() : flat();
  }).catch((e) => { console.warn("badges:", e); document.querySelectorAll(".cert__gl").forEach((c) => c.remove()); flat(); });
  const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); go(); } }, { rootMargin: "800px 0px" });
  stages.forEach((s) => near.observe(s));
}
