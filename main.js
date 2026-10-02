/* jesu.devs, hand-rolled. */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const G = window.gsap;
  const ST = window.ScrollTrigger;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, active: false };
  const GLYPHS = "!<>-_\\/[]{}~=+*^?#01";

  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; }, { passive: true });

  /* ── text scramble ─────────────────────────────── */
  function scramble(el, finalText = el.dataset.text || el.textContent, dur = 600) {
    el.dataset.text = finalText;
    const start = performance.now();
    cancelAnimationFrame(el._raf);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const n = Math.floor(p * finalText.length);
      let out = finalText.slice(0, n);
      for (let i = n; i < finalText.length; i++) out += finalText[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (p < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  }
  $$("[data-scramble]").forEach((a) => a.addEventListener("mouseenter", () => scramble(a)));

  /* ── clock / uptime ────────────────────────────── */
  const clock = $("#clock"), uptime = $("#uptime"), t0 = Date.now();
  const fmtIST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const pad = (n) => String(n).padStart(2, "0");
  setInterval(() => {
    clock.textContent = fmtIST.format(new Date());
    const s = ((Date.now() - t0) / 1000) | 0;
    uptime.textContent = `uptime ${pad((s / 3600) | 0)}:${pad(((s / 60) | 0) % 60)}:${pad(s % 60)}`;
  }, 1000);

  /* ── adaptive quality ──────────────────────────
     3 = full (glass blur, 2 caustic layers, ~55% res)
     2 = balanced (no blur, 1 caustic layer, ~40% res)
     1 = light (no blur/grain/glint, ~30% res, 30fps background)
     0 = static (background rendered once, no ambient motion)
     Starts from a hardware guess, then steps down if frames run slow.
     Force with ?q=0..3 for testing. */
  const root = document.documentElement;
  const Q = { tier: 3, listeners: [] };
  const setTier = (t) => {
    t = Math.max(0, Math.min(3, t));
    if (t === Q.tier && root.dataset.q) return;
    Q.tier = t; root.dataset.q = String(t);
    Q.listeners.forEach((fn) => fn(t));
  };
  Q.on = (fn) => Q.listeners.push(fn);
  Q.set = (t) => setTier(t);
  window.__jjgQuality = Q;
  (function guessTier() {
    const forced = new URLSearchParams(location.search).get("q");
    if (forced !== null && /^[0-3]$/.test(forced)) { Q.forced = true; return setTier(+forced); }
    if (reduce) return setTier(0);
    let t = 3;
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
    if (cores <= 4 || mem <= 4) t = 2;
    if (cores <= 2 || mem <= 2) t = 1;
    if (!fine) t = Math.min(t, 2);
    // Safari repaints backdrop-filter / blended layers over a moving canvas every frame,
    // and animates background-clip:text on the CPU, so start it on the balanced tier.
    const ua = navigator.userAgent;
    if (/^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(ua)) { root.classList.add("is-safari"); t = Math.min(t, 2); }
    try {
      const c = document.createElement("canvas"), g = c.getContext("webgl");
      if (!g) t = 0;
      else {
        const ext = g.getExtension("WEBGL_debug_renderer_info");
        const r = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
        if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(r)) t = 0;
        else if (/intel(?!.*(arc|iris xe))|mali-4|adreno \(tm\) [34]\d\d|powervr/i.test(r)) t = Math.min(t, 2);
        g.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch (e) {}
    setTier(t);
  })();

  /* ── the deep: webgl caustics ──────────────────── */
  const field = $("#field");
  const depth = { target: 0, v: 0 };
  const gl = Q.tier >= 0 ? field.getContext("webgl", { antialias: false, depth: false, stencil: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false }) : null;
  let requestBgFrame = () => {};
  if (gl) {
    const VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
    const FS = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;uniform float d;uniform float q;
#define TAU 6.28318530718
float caustic(vec2 uv,float time){
  vec2 p=mod(uv*TAU,TAU)-250.;vec2 i=p;float c=1.;float inten=.005;
  for(int n=0;n<5;n++){float tt=time*(1.-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));
    c+=1./length(vec2(p.x/(sin(i.x+tt)/inten),p.y/(cos(i.y+tt)/inten)));}
  c/=5.;c=1.17-pow(c,1.4);return pow(abs(c),8.);
}
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=gl_FragCoord.xy/r;float asp=r.x/r.y;vec2 p=vec2(uv.x*asp,uv.y);
  float c=caustic(p*.55+vec2(0.,d*1.5),t*.22+23.);
  float c2=0.;
  if(q>2.5){c2=caustic(p*.9+vec2(.3,d*2.2),t*.17+11.);}else{c*=1.25;}
  float top=smoothstep(-.15,1.1,uv.y);
  float surf=mix(1.,.08,smoothstep(0.,.85,d));
  vec3 abyss=vec3(.004,.012,.022);
  vec3 water=vec3(.012,.07,.11);
  vec3 ice=vec3(.49,.83,.99);
  vec3 col=mix(abyss,water,top*surf);
  col+=ice*(c*.16+c2*.08)*top*surf;
  vec2 mm=vec2(m.x/r.x*asp,m.y/r.y);float dist=length(p-mm);
  float lamp=exp(-dist*dist*9.);
  col+=ice*lamp*(.025+(c+c2)*.28);
  col+=vec3(.2,.5,.7)*lamp*.04;
  for(int k=0;k<2;k++){
    if(k==1&&q<1.5)break;
    float sc=k==0?22.:38.;
    vec2 g=p*sc;g.y+=t*(k==0?.35:.22);g.x+=sin(g.y*.15+t*.3)*.4;
    vec2 id=floor(g);vec2 f=fract(g)-.5;float hh=h(id+float(k)*7.);
    vec2 o=vec2(h(id+1.3)-.5,h(id+2.7)-.5)*.6;
    float s=smoothstep(.07,0.,length(f-o))*step(.88,hh);
    col+=s*vec3(.55,.85,1.)*(.08+.3*d)*(1.+lamp*3.);}
  col*=1.-.45*pow(length(uv-.5)*1.2,2.);
  gl_FragColor=vec4(col,1.);
}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { r: gl.getUniformLocation(prog, "r"), t: gl.getUniformLocation(prog, "t"), m: gl.getUniformLocation(prog, "m"), d: gl.getUniformLocation(prog, "d"), q: gl.getUniformLocation(prog, "q") };
    const SCALES = [0.35, 0.3, 0.4, 0.55];
    let scale = SCALES[Q.tier];
    const size = () => {
      // cap total pixels so 4K screens don't explode the fill cost
      const maxPx = [600e3, 350e3, 500e3, 900e3][Q.tier];
      let w = innerWidth * scale, h = innerHeight * scale;
      const k = Math.min(1, Math.sqrt(maxPx / (w * h)));
      field.width = Math.max(1, Math.round(w * k)); field.height = Math.max(1, Math.round(h * k));
      gl.viewport(0, 0, field.width, field.height);
    };
    size();
    let rsT; addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(() => { size(); requestBgFrame(); }, 120); });
    const lm = { x: innerWidth * 0.6, y: innerHeight * 0.35 };
    const t0gl = performance.now();
    let running = false, last = 0, frameN = 0, ema = 16.7, slowFrames = 0, prevTs = 0;
    const draw = (now) => {
      gl.uniform2f(U.r, field.width, field.height);
      gl.uniform1f(U.t, (now - t0gl) / 1000);
      gl.uniform2f(U.m, lm.x * (field.width / innerWidth), (innerHeight - lm.y) * (field.height / innerHeight));
      gl.uniform1f(U.d, depth.v);
      gl.uniform1f(U.q, Q.tier);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now) => {
      if (!running) return;
      requestAnimationFrame(frame);
      // frame-time monitor (whole page, not just the shader)
      if (prevTs) {
        const dt = Math.min(100, now - prevTs);
        ema += (dt - ema) * 0.05; frameN++;
        if (!Q.forced && frameN > 90 && !document.hidden) {
          slowFrames = ema > 22 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
          if (slowFrames > 60 && Q.tier > 0) { setTier(Q.tier - 1); slowFrames = 0; frameN = 0; ema = 16.7; }
        }
      }
      prevTs = now;
      Q.ema = ema; Q.slow = slowFrames;
      if (Q.tier === 1 && now - last < 32) return; // ~30fps background on light tier
      last = now;
      lm.x += (mouse.x - lm.x) * 0.08; lm.y += (mouse.y - lm.y) * 0.08;
      depth.v += (depth.target - depth.v) * 0.06;
      draw(now);
    };
    const start = () => { if (running || Q.tier === 0 || document.hidden) return; running = true; prevTs = 0; requestAnimationFrame(frame); };
    const stop = () => { running = false; };
    // static tier: one frame now, another when depth changes meaningfully
    let pending = false;
    requestBgFrame = () => {
      if (running || pending) return; pending = true;
      requestAnimationFrame((now) => { pending = false; depth.v = depth.target; lm.x = innerWidth * 0.6; lm.y = innerHeight * 0.3; draw(now); });
    };
    Q.on((t) => { scale = SCALES[t]; size(); if (t === 0) { stop(); requestBgFrame(); } else start(); });
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    field.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); field.classList.add("field--fallback"); });
    if (Q.tier === 0) requestBgFrame(); else start();
  } else {
    field.classList.add("field--fallback");
  }

  /* ── depth gauge ───────────────────────────────── */
  const MAX_DEPTH = 10935;
  const ZONES = [[0, "surface"], [200, "twilight zone"], [1000, "midnight zone"], [4000, "abyss"], [6000, "hadal zone"], [10900, "challenger deep"]];
  const depthM = $("#depthM"), depthZone = $("#depthZone"), depthFill = $("#depthFill");
  let lastZone = "";
  function onScrollDepth() {
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    if (Math.abs(depth.target - p) > 0.004 && Q.tier === 0) requestBgFrame();
    depth.target = p;
    const m = Math.round(Math.pow(p, 1.6) * MAX_DEPTH);
    depthM.textContent = String(m).padStart(5, "0");
    depthFill.style.transform = `scaleY(${p})`;
    const z = ZONES.filter(([d]) => m >= d).pop()[1];
    if (z !== lastZone) { lastZone = z; scramble(depthZone, z, 500); }
  }
  addEventListener("scroll", onScrollDepth, { passive: true });
  onScrollDepth();

  /* ── cursor ────────────────────────────────────── */
  const cursor = $("#cursor"), dot = $(".cursor__dot"), ring = $(".cursor__ring"), clabel = $("#cursorLabel");
  if (fine) {
    let rx = mouse.x, ry = mouse.y;
    (function loop() {
      if (Math.abs(mouse.x - rx) < 0.1 && Math.abs(mouse.y - ry) < 0.1) { requestAnimationFrame(loop); return; }
      rx += (mouse.x - rx) * 0.18; ry += (mouse.y - ry) * 0.18;
      dot.style.transform = `translate(${mouse.x}px,${mouse.y}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      clabel.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    })();
    document.addEventListener("pointerover", (e) => {
      const lab = e.target.closest("[data-cursor]");
      const hov = e.target.closest("a,button,input,[data-tilt]");
      cursor.classList.toggle("is-label", !!lab);
      cursor.classList.toggle("is-hover", !lab && !!hov);
      if (lab) clabel.textContent = lab.dataset.cursor;
    });
  }

  /* ── magnetic ──────────────────────────────────── */
  if (fine && G) {
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        G.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.4, ease: "power3.out" });
      });
      el.addEventListener("pointerleave", () => G.to(el, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1,0.35)" }));
    });
  }

  /* ── seamless ticker ───────────────────────────
     Two identical groups, each at least a screen wide; the track slides
     exactly one group (-50%) and restarts on a pixel-identical frame. */
  const mqTrack = $(".marquee__track");
  if (mqTrack) {
    const items = [...mqTrack.children].map((n) => n.cloneNode(true));
    const buildTicker = () => {
      const group = document.createElement("div");
      group.className = "marquee__group";
      const fill = () => items.forEach((n) => group.appendChild(n.cloneNode(true)));
      mqTrack.replaceChildren(group);
      fill();
      let guard = 0;
      while (group.scrollWidth < innerWidth * 1.15 && guard++ < 8) fill();
      mqTrack.appendChild(group.cloneNode(true));
      const pxPerSec = Q.tier <= 1 ? 40 : 80;
      mqTrack.style.animationDuration = (group.scrollWidth / pxPerSec).toFixed(1) + "s";
    };
    buildTicker();
    let mqT, mqW = innerWidth;
    addEventListener("resize", () => { clearTimeout(mqT); mqT = setTimeout(() => { if (Math.abs(innerWidth - mqW) > 40) { mqW = innerWidth; buildTicker(); } }, 200); });
    if (document.fonts) document.fonts.ready.then(buildTicker);
    Q.on(buildTicker);
  }

  /* ── pause off-screen ambient animation ───────── */
  const ambient = new IntersectionObserver((ents) => ents.forEach((e) => e.target.classList.toggle("is-off", !e.isIntersecting)), { rootMargin: "100px" });
  $$(".hero, .marquee, .contact, .flagship").forEach((el) => ambient.observe(el));

  /* ── split helpers ─────────────────────────────── */
  $$("[data-split]").forEach((el) => {
    const t = el.textContent;
    el.textContent = "";
    let ci = 0; for (const c of t) { const s = document.createElement("span"); s.className = "ch"; s.style.setProperty("--i", ci++); s.textContent = c === " " ? " " : c; el.appendChild(s); }
  });
  // manifesto words
  const mani = $("#manifesto");
  mani.innerHTML = mani.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(" ");

  /* ── boot sequence ─────────────────────────────── */
  const boot = $("#boot"), bootLog = $("#bootLog"), bootBar = $("#bootBar"), bootPct = $("#bootPct");
  let seen = false;
  try { seen = sessionStorage.getItem("jjg-booted") === "1"; } catch (e) {}
  const LINES = [
    ["JESU-BIOS v26.10 (c) Jesu Joel George", "w"],
    ["cpu0: caffeine-powered @ 4.20 GHz ............ <span class='ok'>OK</span>"],
    ["mem: 64K context window ...................... <span class='ok'>OK</span>"],
    ["mounting /dev/curiosity on / ................. <span class='ok'>OK</span>"],
    ["sonar ping ................................... <span class='ok'>ECHO</span>"],
    ["hull pressure ................................ <span class='ok'>NOMINAL</span>"],
    ["loading kernel modules: whisper indictrans2 llama-3.2 pytorch"],
    ["verifying patents [2/2] ...................... <span class='ok'>PUBLISHED</span>"],
    ["loading practicepot.core [simulation engine] . <span class='ok'>OK</span>"],
    ["starting finecho.service ..................... <span class='ok'>OK</span>"],
    ["arming quantum-inspired ids ................. <span class='ok'>OK</span>"],
    ["checking ego levels ......................... <span class='ok'>WITHIN LIMITS</span>"],
    ["establishing uplink to recruiter.exe ......... <span class='ok'>READY</span>"],
    ["", ""],
    ["welcome aboard. beginning descent_", "w"],
  ];
  let booted = false;
  function endBoot() {
    if (booted) return; booted = true;
    try { sessionStorage.setItem("jjg-booted", "1"); } catch (e) {}
    document.body.classList.remove("is-booting");
    if (G && !reduce) {
      G.to(boot, { clipPath: "inset(0 0 100% 0)", duration: 0.9, ease: "expo.inOut", onComplete: () => boot.remove() });
      intro(0.45);
    } else { boot.remove(); intro(0); }
  }
  function runBoot() {
    if (reduce) return endBoot();
    const step = seen ? 45 : 150;
    let i = 0;
    const iv = setInterval(() => {
      if (i < LINES.length) {
        const [txt, cls] = LINES[i];
        bootLog.innerHTML += (cls ? `<span class="${cls}">${txt}</span>` : txt) + "\n";
      }
      i++;
      const p = Math.min(1, i / LINES.length);
      bootBar.style.width = p * 100 + "%";
      bootPct.textContent = String(Math.round(p * 100)).padStart(3, "0");
      if (i >= LINES.length + 2) { clearInterval(iv); setTimeout(endBoot, 220); }
    }, step);
  }
  $("#bootSkip").addEventListener("click", endBoot);
  addEventListener("keydown", (e) => { if (!booted && (e.key === "Enter" || e.key === "Escape")) endBoot(); });
  runBoot();

  /* ── intro (hero) ──────────────────────────────── */
  function intro(delay) {
    // name lines clip only while the letters rise in; after that, let hover lifts poke out freely
    const unclip = () => $(".hero__name").classList.add("is-revealed");
    if (!G || reduce) return unclip();
    const tl = G.timeline({ delay, onComplete: unclip });
    tl.from(".hero__name .ch", { yPercent: 115, rotate: 8, duration: 1.1, ease: "expo.out", stagger: 0.035 })
      .from(".hero__meta span", { opacity: 0, y: -10, duration: 0.6, stagger: 0.08 }, "<0.2")
      .from(".hero__hello", { opacity: 0, x: -20, duration: 0.7 }, "<")
      .from(".hero__portrait", { clipPath: "inset(50% 0 50% 0)", duration: 1.2, ease: "expo.inOut" }, "<")
      .from(".hero .reveal-up", { y: 30, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.12 }, "<0.4")
      .from(".nav", { y: -30, opacity: 0, duration: 0.7 }, "<");
    $$(".hero__meta span, .hero__hello").forEach((s) => { const html = s.innerHTML; setTimeout(() => { scramble(s); setTimeout(() => (s.innerHTML = html), 650); }, delay * 1000 + 300); });
  }

  // hero name: per-char hover lift
  $$(".hero__name .ch").forEach((c) => c.addEventListener("pointerenter", () => {
    if (!G) return;
    G.fromTo(c, { y: 0 }, { y: -18, color: "#a5f3fc", duration: 0.25, ease: "power2.out", yoyo: true, repeat: 1, onComplete: () => G.set(c, { clearProps: "color" }) });
  }));

  /* ── scroll stuff ──────────────────────────────── */
  if (!G || !ST) return termInit();
  G.registerPlugin(ST);

  if (!reduce && window.Lenis && Q.tier >= 2) {
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    Q.on((t) => { if (t <= 1) { lenis.destroy(); ST.refresh(); } });
    lenis.on("scroll", ST.update);
    G.ticker.add((t) => lenis.raf(t * 1000));
    G.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
      const id = a.getAttribute("href"); if (id.length < 2) return;
      e.preventDefault(); lenis.scrollTo(id === "#top" ? 0 : id, { duration: 1.6 });
    }));
  }

  G.to("#progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

  // section labels scramble on enter
  $$(".sect-label").forEach((el) => ST.create({ trigger: el, start: "top 85%", once: true, onEnter: () => scramble(el, el.textContent, 700) }));
  // label preserve inner span: restore html after scramble
  $$(".sect-label").forEach((el) => { el._html = el.innerHTML; ST.create({ trigger: el, start: "top 85%", once: true, onEnter: () => setTimeout(() => (el.innerHTML = el._html), 720) }); });

  if (reduce) { $$(".manifesto__text .w").forEach((w) => (w.style.color = "var(--ink)")); return termInit(); }

  // hero parallax out
  G.to(".hero__left", { yPercent: -12, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  G.to(".hero__portrait img", { yPercent: 8, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

  // section titles
  $$(".sect-title").forEach((t) => G.from(t, { y: 80, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: t, start: "top 88%" } }));

  // manifesto word reveal
  G.to(".manifesto__text .w", { color: "#ecebe4", stagger: 0.05, ease: "none", scrollTrigger: { trigger: "#manifesto", start: "top 80%", end: "bottom 45%", scrub: true } });
  G.from(".offline__img", { clipPath: "inset(100% 0 0 0)", duration: 1.4, ease: "expo.inOut", scrollTrigger: { trigger: ".offline", start: "top 85%" } });
  G.fromTo(".offline__img img", { yPercent: -10 }, { yPercent: 0, ease: "none", scrollTrigger: { trigger: ".offline", start: "top bottom", end: "bottom top", scrub: true } });

  // stat counters
  $$(".stat b").forEach((b) => {
    const to = +b.dataset.count;
    ST.create({ trigger: b, start: "top 90%", once: true, onEnter: () => {
      if (b.hasAttribute("data-zero")) {
        const o = { v: 99 }; G.to(o, { v: 0, duration: 1.6, ease: "expo.out", onUpdate: () => (b.textContent = Math.round(o.v)) });
      } else { const o = { v: 0 }; G.to(o, { v: to, duration: 1.8, ease: "expo.out", onUpdate: () => (b.textContent = Math.round(o.v)) }); }
    } });
  });

  // flagship
  G.from(".flagship__title span", { yPercent: 100, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.12, scrollTrigger: { trigger: ".flagship__title", start: "top 85%" } });
  G.from(".flagship__badge", { scale: 0.6, opacity: 0, duration: 0.8, ease: "back.out(2)", scrollTrigger: { trigger: ".flagship__title", start: "top 80%" } });
  G.from(".flagship__copy > *", { y: 30, opacity: 0, duration: 0.8, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: ".flagship__body", start: "top 80%" } });
  G.from("#ppBrowser", { rotateX: 25, rotateY: -18, y: 80, opacity: 0, duration: 1.4, ease: "expo.out", transformPerspective: 1200, scrollTrigger: { trigger: "#ppBrowser", start: "top 85%" } });
  ST.create({ trigger: "#ppBrowser", start: "top 70%", once: true, onEnter: runSim });

  function typeInto(el, txt, speed = 28) {
    return new Promise((res) => { let i = 0; const iv = setInterval(() => { el.textContent = txt.slice(0, ++i); if (i >= txt.length) { clearInterval(iv); el.classList.add("done"); res(); } }, speed); });
  }
  async function runSim() {
    for (const v of $$("#ppBrowser [data-type]")) await typeInto(v, v.dataset.type);
    $$("#ppBrowser [data-num]").forEach((n, i) => {
      const o = { v: 0 };
      G.to(o, { v: +n.dataset.num, duration: 1.2, delay: i * 0.25, ease: "power3.out", onUpdate: () => (n.textContent = Math.round(o.v).toLocaleString("en-IN")) });
    });
    setTimeout(() => $(".sim-ok").classList.add("on"), 1900);
  }
  // browser tilt
  const pb = $("#ppBrowser");
  if (fine) {
    pb.addEventListener("pointermove", (e) => { const r = pb.getBoundingClientRect(); G.to(pb, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 10, rotateX: -((e.clientY - r.top) / r.height - 0.5) * 10, transformPerspective: 1000, duration: 0.5 }); });
    pb.addEventListener("pointerleave", () => G.to(pb, { rotateX: 0, rotateY: 0, duration: 1, ease: "elastic.out(1,0.4)" }));
  }

  // work: horizontal pin on desktop
  const track = $("#track");
  const mm = G.matchMedia();
  mm.add("(min-width: 861px)", () => {
    const dist = () => track.scrollWidth - innerWidth;
    const tween = G.to(track, { x: () => -dist(), ease: "none", scrollTrigger: { trigger: ".work", start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
      onToggle: (self) => document.body.classList.toggle("in-rail", self.isActive),
      onUpdate: (self) => { if (Q.tier < 3) return; const v = G.utils.clamp(-8, 8, self.getVelocity() / -300); G.to(".card", { skewX: v, duration: 0.4, overwrite: "auto" }); } } });
    G.from(".card", { x: 160, opacity: 0, rotate: 3, duration: 1.2, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: ".work", start: "top 75%" } });
    G.from(".work__intro > *", { y: 50, opacity: 0, duration: 1, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: ".work", start: "top 75%" } });
  });
  mm.add("(max-width: 860px)", () => {
    $$(".card").forEach((c) => G.from(c, { y: 60, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: c, start: "top 90%" } }));
  });

  // card tilt + spotlight
  $$("[data-tilt]").forEach((c) => {
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      c.style.setProperty("--mx", px * 100 + "%"); c.style.setProperty("--my", py * 100 + "%");
      if (fine) G.to(c, { rotateY: (px - 0.5) * 12, rotateX: -(py - 0.5) * 12, transformPerspective: 900, duration: 0.4 });
    });
    c.addEventListener("pointerleave", () => G.to(c, { rotateX: 0, rotateY: 0, duration: 0.9, ease: "elastic.out(1,0.45)" }));
  });
  // pipeline packets
  const pipes = $$(".pipe").map((p) => ({ nodes: $$("span", p), i: 0, on: false, el: p }));
  const pio = new IntersectionObserver((ents) => ents.forEach((e) => { const pp = pipes.find((x) => x.el === e.target); if (pp) pp.on = e.isIntersecting; }));
  pipes.forEach((pp) => pio.observe(pp.el));
  setInterval(() => {
    if (document.hidden || Q.tier === 0) return;
    pipes.forEach((pp) => { if (!pp.on) return; pp.nodes.forEach((n) => n.classList.remove("lit")); pp.nodes[pp.i++ % pp.nodes.length].classList.add("lit"); });
  }, 520);

  // certs
  G.from(".cert__meta", { y: 40, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.15, scrollTrigger: { trigger: ".certs__grid", start: "top 85%" } });


  // moment
  G.from(".moment__img", { clipPath: "inset(0 100% 0 0)", duration: 1.5, ease: "expo.inOut", scrollTrigger: { trigger: ".moment__img", start: "top 80%" } });
  G.to(".tagbox", { opacity: 1, y: 0, duration: 0.6, stagger: 0.25, ease: "back.out(2)", scrollTrigger: { trigger: ".moment__img", start: "top 55%" } });
  G.from(".moment__copy p", { y: 30, opacity: 0, stagger: 0.15, duration: 0.9, scrollTrigger: { trigger: ".moment__copy", start: "top 80%" } });

  // contact
  G.from(".contact__big .row > span", { yPercent: 110, duration: 1.3, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: ".contact__big", start: "top 85%" } });

  termInit();

  /* ── terminal ──────────────────────────────────── */
  function termInit() {
    const out = $("#termOut"), inp = $("#termIn");
    const hist = []; let hp = 0;
    const esc = (s) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
    const print = (html, cls = "") => { const d = document.createElement("div"); if (cls) d.className = cls; d.innerHTML = html; out.appendChild(d); out.scrollTop = out.scrollHeight; };
    const btn = (cmd, label = cmd) => `<button class="run" data-cmd="${cmd}">${label}</button>`;
    const NEOFETCH = `<span class="c">     ██╗███████╗███████╗██╗   ██╗</span>  <span class="u">guest</span>@<span class="c">jesu</span>
<span class="c">     ██║██╔════╝██╔════╝██║   ██║</span>  ─────────────────────────
<span class="c">     ██║█████╗  ███████╗██║   ██║</span>  <span class="c">name</span>     Jesu Joel George
<span class="c">██   ██║██╔══╝  ╚════██║██║   ██║</span>  <span class="c">role</span>     AI &amp; systems engineer
<span class="c">╚█████╔╝███████╗███████║╚██████╔╝</span>  <span class="c">flagship</span> PracticePot (core dev)
<span class="c"> ╚════╝ ╚══════╝╚══════╝ ╚═════╝ </span>  <span class="c">base</span>     Kerala, India
<span class="d">██████╗ ███████╗██╗   ██╗███████╗</span>  <span class="c">shell</span>    curiosity 5.2
<span class="d">██╔══██╗██╔════╝██║   ██║██╔════╝</span>  <span class="c">uptime</span>   always shipping
<span class="d">██║  ██║█████╗  ██║   ██║███████╗</span>  <span class="c">patents</span>  2 published
<span class="d">██║  ██║██╔══╝  ╚██╗ ██╔╝╚════██║</span>  <span class="c">certs</span>    AWS SAA-C03 · Azure AI-103
<span class="d">██████╔╝███████╗ ╚████╔╝ ███████║</span>
<span class="d">╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝</span>
<span class="d">tap a question above, or type one like</span> ${btn("what has he built?")}`;
    const NEOFETCH_M = `<span class="c">guest</span>@<span class="c">jesu</span>
──────────────────────
<span class="c">name</span>     Jesu Joel George
<span class="c">role</span>     AI &amp; systems engineer
<span class="c">flagship</span> PracticePot (core dev)
<span class="c">patents</span>  2 published
<span class="c">certs</span>    AWS SAA-C03 · Azure AI-103
<span class="c">base</span>     Kerala, India
<span class="c">uptime</span>   always shipping
<span class="d">tap a question above, or type one like</span> ${btn("what has he built?")}`;
    const nf = () => (innerWidth < 640 ? NEOFETCH_M : NEOFETCH);
    const files = {
      "about.txt": "I build AI systems end to end. Data in, models tuned, pipelines deployed, dashboards out.\nWhat I care about most is software people actually trust and use every day.",
      "practicepot.md": "PracticePot: a SaaS company building a simulated learning platform for accounting and finance.\nMy role: one of the core developers of the product. I also built its AI integration, which helps students get familiar with each simulation.\n→ <a href='https://practicepot.com' target='_blank' rel='noopener'>practicepot.com</a>",
      "secrets.env": "<span class='o'>nice try.</span> 🔒",
    };
    const C = {
      help: () => `<span class="c">available commands</span> <span class="d">(click any of them)</span>
  ${btn("whoami")}        who am i
  ${btn("neofetch")}      system info
  ${btn("projects")}      list the systems
  ${btn("practicepot")}   the flagship
  ${btn("stack")}         tools of the trade
  ${btn("ls")} / cat      poke around the filesystem
  ${btn("patents")}       the inventions
  ${btn("certs")}         professional certifications
  ${btn("contact")}       open a channel
  ${btn("github")}        jump to github
  ${btn("linkedin")}      connect on linkedin
  ${btn("sudo hire jesu")}   <span class="d">(recommended)</span>
  ${btn("clear")}         wipe the screen
<span class="d">or just ask in plain english, like "what has he built?"</span>`,
      whoami: () => "I'm Jesu Joel George. AI and systems engineer, intern at Finprov Learning, one of the core developers of PracticePot, and I have two published patents.\nI turn phone calls into insights, spreadsheets into platforms, and coffee into commits.",
      neofetch: () => nf(),
      projects: () => `<span class="c">PID   NAME                  STATUS</span>
0001  PracticePot           <span class="c">● live</span>      <span class="d">simulated finance universe · core dev</span>
0002  Fiana                 <span class="c">● running</span>   <span class="d">voice ai mock interviewer</span>
0003  FinEcho               <span class="c">● running</span>   <span class="d">self-hosted call intelligence</span>
0004  Scorely               <span class="o">◆ patent</span>    <span class="d">ai evaluation engine</span>
0005  Quantum-Inspired IDS  <span class="o">◆ patent</span>    <span class="d">intrusion detection with memory</span>
0006  Ascend                <span class="c">● live</span>      <span class="d">ai fitness tracker</span>
0007  Ethara                <span class="c">● live</span>      <span class="d">team task manager</span>
0008  LeafGuard             <span class="c">● running</span>   <span class="d">plant disease detection</span>
0009  Clara                 <span class="c">● running</span>   <span class="d">calls → voice agents</span>`,
      practicepot: () => files["practicepot.md"],
      stack: () => "<span class='c'>lang</span>   python · typescript · sql · php\n<span class='c'>ai</span>     llama fine-tuning · vllm · faster-whisper · indictrans2 · langgraph · mcp · ollama\n<span class='c'>web</span>    next.js · react · django · tailwind · prisma\n<span class='c'>data</span>   postgres · mysql · sqlite · supabase\n<span class='c'>ops</span>    docker · nginx · gunicorn · github actions · vercel",
      ls: () => Object.keys(files).map((f) => btn(`cat ${f}`, f)).join("   "),
      cat: (a) => files[a] || (a ? `cat: ${esc(a)}: No such file or directory` : "usage: cat &lt;file&gt;"),
      contact: () => "✉  <a href='mailto:jesujoelgeorge@gmail.com'>jesujoelgeorge@gmail.com</a>\nin <a href='https://www.linkedin.com/in/jesu-joel-george/' target='_blank' rel='noopener'>linkedin.com/in/jesu-joel-george</a>\n⌘  <a href='https://github.com/jessuiii' target='_blank' rel='noopener'>github.com/jessuiii</a> · <a href='https://github.com/jesu-devs' target='_blank' rel='noopener'>jesu-devs</a>",
      github: () => "⌘  <a href='https://github.com/jessuiii' target='_blank' rel='noopener'>github.com/jessuiii</a>\n⌘  <a href='https://github.com/jesu-devs' target='_blank' rel='noopener'>github.com/jesu-devs</a>",
      certs: () => "<span class='c'>✓</span> AWS Certified Solutions Architect Associate <span class='d'>(SAA-C03)</span>  <a href='https://cp.certmetrics.com/amazon/en/public/verify/credential/75749af5ba634e5fb3ed65b2deeda171' target='_blank' rel='noopener'>verify</a>\n<span class='c'>✓</span> Microsoft Azure AI Apps &amp; Agents Developer Associate <span class='d'>(AI-103)</span>  <a href='https://learn.microsoft.com/en-us/users/JesuJoelGeorge-8819/credentials/A74CD284F980DD52' target='_blank' rel='noopener'>verify</a>",
      linkedin: () => "in <a href='https://www.linkedin.com/in/jesu-joel-george/' target='_blank' rel='noopener'>linkedin.com/in/jesu-joel-george</a>",
      patents: () => "<span class='o'>◆</span> Scorely: patent published\n<span class='o'>◆</span> Quantum-Inspired IDS: patent published <span class='d'>(built on work by Steve Mathew)</span>",
      date: () => new Date().toString(),
      echo: (a) => esc(a),
      coffee: () => "      ( (\n       ) )\n    ........\n    |      |]\n    \\      /\n     `----'\n<span class='d'>brewing... my entire runtime depends on this.</span>",
      exit: () => "there is no escape. only <span class='c'>sudo hire jesu</span>.",
      clear: () => { out.innerHTML = ""; return null; },
    };
    function sudo(rest) {
      if (/^rm\s+-rf/.test(rest)) return "<span class='o'>nope.</span> this portfolio is load-bearing.";
      if (/hire\s+jesu/i.test(rest)) {
        const steps = ["[sudo] verifying credentials ............ ok", "scanning projects ...................... 9 found, 2 patented", "evaluating practicepot contribution ..... core developer ✓", "checking certifications ................ aws saa-c03 ✓ azure ai-103 ✓", "checking vibe ........................... immaculate", "<span class='c'>ACCESS GRANTED.</span> send the offer → <a href='mailto:jesujoelgeorge@gmail.com?subject=Let%27s%20build%20something'>jesujoelgeorge@gmail.com</a> 🚀"];
        steps.forEach((s, i) => setTimeout(() => print(s, i === steps.length - 1 ? "" : "d"), 280 * (i + 1)));
        return null;
      }
      return `guest is not in the sudoers file. <span class='d'>this incident will be reported.</span>`;
    }
    // plain-english questions → commands, so nobody needs to know the syntax
    const INTENTS = [
      [/\b(hire|hiring|job|offer|recruit|availab|internship|open to)/, "sudo hire jesu"],
      [/practice ?pot/, "practicepot"],
      [/patent|invent/, "patents"],
      [/cert|aws|azure|qualif/, "certs"],
      [/skill|stack|tech|tool|language|framework|know|work with/, "stack"],
      [/project|built|build|made|make|work|portfolio|app/, "projects"],
      [/linkedin/, "linkedin"],
      [/github|code|repo/, "github"],
      [/contact|email|mail|reach|talk|call|phone|connect|touch/, "contact"],
      [/who|about|yourself|introduc|background|tell me/, "whoami"],
      [/^(hi|hey|hello|hola|yo|sup)\b/, "hello"],
    ];
    const intent = (q) => (INTENTS.find(([re]) => re.test(q)) || [])[1];
    const lost = () => `hmm, I didn't catch that. try one of these:
  ${btn("whoami", "who is jesu?")}   ${btn("projects", "what has he built?")}   ${btn("contact", "get in touch")}   ${btn("help", "show everything")}`;
    function run(raw) {
      const line = raw.trim();
      print(`<span class="c">guest@jesu:~$</span> <span class="u">${esc(line)}</span>`);
      if (!line) return;
      hist.push(line); hp = hist.length;
      const [cmd, ...rest] = line.split(/\s+/);
      const arg = rest.join(" ");
      let res;
      if (cmd === "sudo") res = sudo(arg);
      else if (C[cmd.toLowerCase()]) res = C[cmd.toLowerCase()](arg);
      else {
        const hit = intent(line.toLowerCase().replace(/[?!.,]/g, ""));
        if (hit === "hello") res = `hey 👋 good to meet you. ${lost().split("\n")[1].trim()}`;
        else if (hit === "sudo hire jesu") res = sudo("hire jesu");
        else if (hit) res = C[hit]("");
        else res = lost();
      }
      if (res) print(res);
    }
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { run(inp.value); inp.value = ""; }
      else if (e.key === "ArrowUp") { if (hp > 0) inp.value = hist[--hp]; e.preventDefault(); }
      else if (e.key === "ArrowDown") { inp.value = hp < hist.length - 1 ? hist[++hp] : ((hp = hist.length), ""); e.preventDefault(); }
      else if (e.key === "Tab") { e.preventDefault(); const m = Object.keys(C).find((k) => k.startsWith(inp.value)); if (m) inp.value = m; }
    });
    const fine = matchMedia("(pointer: fine)").matches;
    const focus = () => { if (fine) inp.focus({ preventScroll: true }); };
    $("#term").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmd]");
      if (b) { run(b.dataset.cmd); focus(); }
      else if (!e.target.closest("a")) inp.focus({ preventScroll: true });
    });
    $$(".hint button").forEach((b) => b.addEventListener("click", () => { run(b.dataset.cmd); focus(); }));
    // auto neofetch when visible
    let did = false;
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting && !did) {
        did = true; const cmd = "neofetch"; let i = 0;
        const typed = document.createElement("div"); out.appendChild(typed);
        const iv = setInterval(() => { typed.innerHTML = `<span class="c">guest@jesu:~$</span> <span class="u">${cmd.slice(0, ++i)}</span>`; if (i >= cmd.length) { clearInterval(iv); setTimeout(() => print(nf()), 200); } }, 90);
      }
    }, { threshold: 0.4 });
    io.observe($("#term"));
  }
})();
