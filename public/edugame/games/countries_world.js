// Countries of the World — click the prompted country on the map
// Exposes: window.EduGames.countries_world.start(mount, { durationMs, onFinish(score, detail) })
(function(){
  window.EduGames = window.EduGames || {};
  // Runtime-tunable config for zoom behavior
  const DEFAULT_CONFIG = {
    // Multiplier applied to the country's bounding box size; higher = less zoom
    zoomPad: 2.2,
    // Do not zoom in tighter than this fraction of the base map dimensions (e.g., 0.35 = min 35% of full size)
    minZoomFraction: 0.35, // used for auto target-zoom
    // Manual zoom can go tighter than auto; lower value allows more zoom-in via wheel/pinch
    minZoomFractionManual: 0.05,
    // Zoom strategy: 'viewBox' | 'transform' | 'cssScaleTest'
    zoomMode: 'viewBox',
    // When using cssScaleTest, scale factor to apply
    cssScale: 1.15,
    // Show simple zoom test controls in UI
    showTestControls: false,
    // Highlight durations
    correctHighlightMs: 10000,
    wrongHighlightMs: 2000,
    revealCorrectOnWrongMs: 2000,
    // Hint strength: how much to recenter toward target [0..1]
    // 1 = fully center on target, 0 = do not recenter (keep current center)
    hintCenterBias: 0.6,
    // Random jitter as fraction of viewport size to avoid dead-center hint [0..0.5]
    hintJitterFrac: 0.18,
  };
  const CONFIG = { ...DEFAULT_CONFIG };

  // Minimal DB read helpers to compute per-country history for current user
  const DB_KEY = 'edugames_v1';
  const SESSION_KEY = 'edugames_session_v1';
  function loadDB(){ try{ return JSON.parse(localStorage.getItem(DB_KEY)) || {version:1, groups:{}} }catch{ return {version:1, groups:{}} } }
  function getSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) || null }catch{ return null } }

  // Assets
  const MAP_SVG_URL = 'assets/world.svg';
  const COUNTRIES_JSON_URL = 'assets/world_map_countries.json';

  function computeHistoryCounts(){
    const sess = getSession();
    if(!sess) return {};
    const db = loadDB();
    const group = db.groups?.[sess.groupId];
    const player = group?.players?.[sess.userId];
    const sessions = player?.scores?.['countries_world'];
    const counts = {};
    if(Array.isArray(sessions)){
      for(const s of sessions){
        const detail = s && s.detail;
        const arr = detail && Array.isArray(detail.correct) ? detail.correct : [];
        for(const code of arr){
          const up = String(code).toUpperCase();
          counts[up] = (counts[up] || 0) + 1;
        }
      }
    }
    return counts;
  }
  
  async function loadAssets(){
    const [svgText, countryMap] = await Promise.all([
      fetch(MAP_SVG_URL).then(r=>r.text()),
      fetch(COUNTRIES_JSON_URL).then(r=>r.json())
    ]);
    return { svgText, countryMap };
  }

  const api = {
    config: CONFIG,
    setConfig(patch){ if(patch && typeof patch === 'object') Object.assign(CONFIG, patch); },
    _debug: { svg:null, baseVB:null },
    testZoom(){
      const d = api._debug; if(!d || !d.svg || !d.baseVB) return false;
      const svg = d.svg; const vb = d.baseVB; const halfW = vb.w * 0.4; const halfH = vb.h * 0.4;
      svg.setAttribute('viewBox', `${vb.x + vb.w*0.3} ${vb.y + vb.h*0.3} ${halfW} ${halfH}`);
      return true;
    },
    resetZoom(){ const d = api._debug; if(d && d.svg && d.baseVB){ d.svg.setAttribute('viewBox', `${d.baseVB.x} ${d.baseVB.y} ${d.baseVB.w} ${d.baseVB.h}`); } },
    start(mount, opts={}){
      const durationMs = Number(opts.durationMs ?? 60000);
      let score = 0;
      let idx = 0;
      let startedAt = 0;
      let timerId = null;
      const correctLog = []; // list of codes
      let isRevealing = false; // lock clicks while revealing correct on wrong
      let sequence = [];
      let countryMap = {};
      let svg = null;
      let baseVB = null; // {x,y,w,h}

      const root = document.createElement('div');
      root.className = 'cworld';
      root.innerHTML = `
        <div class="status">
          <span class="pill" id="cw-time">60.0s</span>
          <span class="pill">Score: <strong id="cw-score">0</strong></span>
          <span class="pill">Find: <strong id="cw-target">—</strong></span>
          ${CONFIG.showTestControls ? '<button class="btn ghost" id="cw-testzoom" title="Test zoom">Test zoom</button><button class="btn ghost" id="cw-resetzoom" title="Reset zoom">Reset</button>' : ''}
        </div>
        <div class="mapwrap" id="cw-mapwrap"></div>
      `;
      mount.appendChild(root);

      const elTime = root.querySelector('#cw-time');
      const elScore = root.querySelector('#cw-score');
      const elTarget = root.querySelector('#cw-target');
      const mapWrap = root.querySelector('#cw-mapwrap');
      const btnTest = root.querySelector('#cw-testzoom');
      const btnReset = root.querySelector('#cw-resetzoom');

      // Async load assets then initialize map/clicks/timer
      loadAssets().then(({ svgText, countryMap: cmap }) => {
        countryMap = cmap || {};
        mapWrap.innerHTML = svgText;
        svg = mapWrap.querySelector('svg');
        if(svg){
          svg.setAttribute('id','cw-map');
          // Ensure proper sizing via viewBox for CSS scaling
          const vb = svg.getAttribute('viewBox') || svg.getAttribute('viewbox');
          if(!vb){
            const w = Number(svg.getAttribute('width')) || 2000;
            const h = Number(svg.getAttribute('height')) || 857;
            svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
          }else if(!svg.getAttribute('viewBox') && vb){
            // Normalize lowercase attribute to proper case by copying
            svg.setAttribute('viewBox', vb);
          }
          // Let CSS control size
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.setAttribute('preserveAspectRatio','xMidYMid meet');

          // Record base viewBox for zoom calculations
          const [bx,by,bw,bh] = (svg.getAttribute('viewBox')||'0 0 2000 857').split(/\s+/).map(Number);
          baseVB = { x:bx||0, y:by||0, w:bw||2000, h:bh||857 };

          // Wrap all existing contents in a <g id="cw-zoom"> so we can transform without changing viewBox
          const ns = 'http://www.w3.org/2000/svg';
          zoomG = document.createElementNS(ns, 'g');
          zoomG.setAttribute('id','cw-zoom');
          const nodes = [...svg.childNodes];
          for(const n of nodes){ zoomG.appendChild(n); }
          svg.appendChild(zoomG);
          api._debug = { svg, baseVB };
        }

        const history = computeHistoryCounts();
        const paths = svg ? [...svg.querySelectorAll('path[id]')] : [];
        const presentCodes = new Set(paths.map(p => (p.getAttribute('id')||'').toUpperCase()));
        const allCodes = Object.keys(countryMap).filter(c => presentCodes.has(c));
        // Build groups by least-correct count, then shuffle within each group
        const buckets = new Map();
        for(const code of allCodes){
          const h = history[code] || 0;
          if(!buckets.has(h)) buckets.set(h, []);
          buckets.get(h).push({ code, name: countryMap[code], h });
        }
        const keys = [...buckets.keys()].sort((a,b)=> a - b);
        function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
        sequence = keys.flatMap(k => shuffle(buckets.get(k)));

        // Attach click handling
        if(svg){
          svg.addEventListener('click', onMapClick);
          // Add wheel + pinch zoom handlers
          svg.addEventListener('wheel', onWheelZoom, { passive:false });
          svg.addEventListener('touchstart', onTouchStart, { passive:false });
          svg.addEventListener('touchmove', onTouchMove, { passive:false });
          svg.addEventListener('touchend', onTouchEnd, { passive:false });
          svg.addEventListener('touchcancel', onTouchEnd, { passive:false });
          svg.addEventListener('mousedown', onMouseDown, { passive:false });
        }

        // Start timer and first target once loaded
        startedAt = Date.now();
        updateTime();
        timerId = setInterval(updateTime, 100);
        setTarget(0);
      }).catch(err => {
        console.error('Failed to load map assets', err);
        // Fallback: start timer without map so game ends gracefully
        startedAt = Date.now();
        timerId = setInterval(updateTime, 100);
      });

      function setTarget(i){
        const c = sequence[i % sequence.length];
        elTarget.textContent = c ? c.name : '—';
        idx = i;
        if(c && svg && baseVB) zoomToCountry(c.code);
      }

      function zoomToCountry(code){
        const path = svg.querySelector(`path[id="${code}"]`);
        if(!path){
          // fallback to full view / reset
          if(zoomG) zoomG.setAttribute('transform', 'matrix(1 0 0 1 0 0)');
          svg.style.transform = '';
          return;
        }
        let bbox;
        try{ bbox = path.getBBox(); }catch{ bbox = null }
        if(!bbox || !isFinite(bbox.x)){
          if(zoomG) zoomG.setAttribute('transform', 'matrix(1 0 0 1 0 0)');
          svg.style.transform = '';
          return;
        }
        const ar = baseVB.w / baseVB.h;
        const cx = bbox.x + bbox.width/2;
        const cy = bbox.y + bbox.height/2;
        // Start from country bbox with padding, then constrain to aspect ratio and min sizes
        const pad = Number(CONFIG.zoomPad) || DEFAULT_CONFIG.zoomPad; // bigger -> less zoom
        const minFrac = Math.max(0.1, Math.min(1, Number(CONFIG.minZoomFraction) || DEFAULT_CONFIG.minZoomFraction));
        let w = Math.max(bbox.width * pad, baseVB.w * minFrac);
        let h = Math.max(bbox.height * pad, baseVB.h * minFrac);
        // Adjust to maintain base aspect ratio
        if(w / h > ar){ h = w / ar; } else { w = h * ar; }
        // Clamp to base view bounds
        w = Math.min(w, baseVB.w); h = Math.min(h, baseVB.h);
        // Compute desired center: blend between current center and target center
        const vbNow = getCurrentVB();
        const curCenterX = vbNow.x + vbNow.w/2;
        const curCenterY = vbNow.y + vbNow.h/2;
        const bias = Math.max(0, Math.min(1, Number(CONFIG.hintCenterBias))); // 0..1
        let centerX = curCenterX + (cx - curCenterX) * (Number.isFinite(bias) ? bias : DEFAULT_CONFIG.hintCenterBias);
        let centerY = curCenterY + (cy - curCenterY) * (Number.isFinite(bias) ? bias : DEFAULT_CONFIG.hintCenterBias);
        // Add small random jitter so target isn't dead-center; ensure target remains in frame
        const jf = Math.max(0, Math.min(0.5, Number(CONFIG.hintJitterFrac) ?? DEFAULT_CONFIG.hintJitterFrac));
        let jx = (Math.random()*2 - 1) * jf * w;
        let jy = (Math.random()*2 - 1) * jf * h;
        let x = centerX - w/2 + jx;
        let y = centerY - h/2 + jy;
        // Ensure the target is still within the viewport after jitter
        if(cx < x) x = cx - w*0.8; // nudge so target is inside
        if(cx > x + w) x = cx - w*0.2;
        if(cy < y) y = cy - h*0.8;
        if(cy > y + h) y = cy - h*0.2;
        // Keep within map bounds
        x = Math.max(baseVB.x, Math.min(x, baseVB.x + baseVB.w - w));
        y = Math.max(baseVB.y, Math.min(y, baseVB.y + baseVB.h - h));

        const mode = CONFIG.zoomMode;
        if(mode === 'viewBox'){
          svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
          if(zoomG) zoomG.setAttribute('transform', 'matrix(1 0 0 1 0 0)');
          svg.style.transform = '';
          // console.debug('zoom (viewBox)', {x,y,w,h});
        }else if(mode === 'transform'){
          const baseCx = baseVB.x + baseVB.w / 2;
          const baseCy = baseVB.y + baseVB.h / 2;
          const s = baseVB.w / w; // zoom factor
          const tx = baseCx - s * (x + w/2);
          const ty = baseCy - s * (y + h/2);
          if(zoomG) zoomG.setAttribute('transform', `matrix(${s} 0 0 ${s} ${tx} ${ty})`);
          // console.debug('zoom (transform)', {s,tx,ty});
        }else{ // cssScaleTest
          const scale = Number(CONFIG.cssScale) || DEFAULT_CONFIG.cssScale || 1.15;
          svg.style.transformOrigin = '50% 50%';
          svg.style.transform = `scale(${scale})`;
          if(zoomG) zoomG.setAttribute('transform', 'matrix(1 0 0 1 0 0)');
          // console.debug('zoom (cssScaleTest)', {scale});
        }
      }

      function updateTime(){
        const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
        elTime.textContent = (remaining/1000).toFixed(1) + 's';
        if(remaining <= 0){ finish(); }
      }

      function finish(){
        clearInterval(timerId); timerId = null;
        if(typeof opts.onFinish === 'function') opts.onFinish(score, { correct: correctLog });
      }

      function onMapClick(e){
        if(isRevealing) return;
        const path = e.target.closest('path');
        if(!path) return;
        const code = String(path.getAttribute('id')||'').toUpperCase();
        if(!countryMap[code]) return; // ignore non-country shapes
        const current = sequence[idx % Math.max(1, sequence.length)];
        if(current && code === current.code){
          score += 1;
          elScore.textContent = String(score);
          correctLog.push(code);
          path.classList.add('cw-correct');
          setTimeout(()=>path.classList.remove('cw-correct'), Number(CONFIG.correctHighlightMs) || DEFAULT_CONFIG.correctHighlightMs);
          setTarget(idx+1);
        }else{
          // No penalty on incorrect; keep score unchanged
          elScore.textContent = String(score);
          path.classList.add('cw-wrong');
          const wrongMs = Number(CONFIG.wrongHighlightMs) || DEFAULT_CONFIG.wrongHighlightMs;
          const revealMs = Number(CONFIG.revealCorrectOnWrongMs) || DEFAULT_CONFIG.revealCorrectOnWrongMs;
          setTimeout(()=>path.classList.remove('cw-wrong'), wrongMs);

          // Flash the correct country in green briefly, then move on
          const correctPath = svg.querySelector(`path[id="${current.code}"]`);
          if(correctPath){
            correctPath.classList.add('cw-correct');
            setTimeout(()=>correctPath.classList.remove('cw-correct'), revealMs);
          }
          isRevealing = true;
          setTimeout(()=>{ isRevealing = false; setTarget(idx+1); }, Math.max(wrongMs, revealMs));
        }
      }

      // ======== Zoom/pan helpers (wheel + pinch) ========
      function getCurrentVB(){
        const vb = (svg.getAttribute('viewBox')||`${baseVB.x} ${baseVB.y} ${baseVB.w} ${baseVB.h}`).split(/\s+/).map(Number);
        return { x: vb[0]||0, y: vb[1]||0, w: vb[2]||baseVB.w, h: vb[3]||baseVB.h };
      }
      function clampVB(x,y,w,h){
        const frac = Number(CONFIG.minZoomFractionManual);
        const minFrac = Math.max(0.01, Math.min(1, Number.isFinite(frac) ? frac : DEFAULT_CONFIG.minZoomFractionManual));
        const minW = baseVB.w * minFrac;
        const minH = baseVB.h * minFrac;
        w = Math.max(minW, Math.min(w, baseVB.w));
        h = Math.max(minH, Math.min(h, baseVB.h));
        x = Math.max(baseVB.x, Math.min(x, baseVB.x + baseVB.w - w));
        y = Math.max(baseVB.y, Math.min(y, baseVB.y + baseVB.h - h));
        return {x,y,w,h};
      }
      function screenToUser(clientX, clientY, vb){
        const rect = svg.getBoundingClientRect();
        const px = (clientX - rect.left) / rect.width;
        const py = (clientY - rect.top) / rect.height;
        return { ux: vb.x + px * vb.w, uy: vb.y + py * vb.h, px, py };
      }
      function applyVB(vb){ svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }

      function onWheelZoom(e){
        if(!svg || !baseVB) return;
        e.preventDefault();
        const vb = getCurrentVB();
        const { ux, uy, px, py } = screenToUser(e.clientX, e.clientY, vb);
        // Zoom factor: wheel down (deltaY>0) zoom out, up zoom in
        const zoomStep = 1 + Math.min(0.5, Math.abs(e.deltaY) * 0.0015);
        const s = e.deltaY < 0 ? 1/zoomStep : zoomStep;
        let nw = vb.w * s;
        let nh = vb.h * s;
        // maintain aspect ratio to base
        const ar = baseVB.w / baseVB.h;
        if(nw/nh > ar){ nh = nw / ar; } else { nw = nh * ar; }
        let nx = ux - px * nw;
        let ny = uy - py * nh;
        const clamped = clampVB(nx, ny, nw, nh);
        applyVB(clamped);
      }

      let pinch = null; // { d0, midUx, midUy, startVB }
      let panMouse = null; // { startX, startY, startVB }
      let panTouch = null; // { startX, startY, startVB }
      function getTouchMidAndDist(touches){
        const [t1, t2] = touches;
        const mx = (t1.clientX + t2.clientX) / 2;
        const my = (t1.clientY + t2.clientY) / 2;
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        const dist = Math.hypot(dx, dy);
        return { mx, my, dist };
      }
      function onTouchStart(e){
        if(!svg || !baseVB) return;
        if(e.touches.length === 2){
          e.preventDefault();
          const vb = getCurrentVB();
          const { mx, my, dist } = getTouchMidAndDist(e.touches);
          const { ux, uy } = screenToUser(mx, my, vb);
          pinch = { d0: dist, midUx: ux, midUy: uy, startVB: vb };
          panTouch = null;
        }else if(e.touches.length === 1){
          e.preventDefault();
          const t = e.touches[0];
          const vb = getCurrentVB();
          panTouch = { startX: t.clientX, startY: t.clientY, startVB: vb };
          pinch = null;
        }
      }
      function onTouchMove(e){
        if(!svg || !baseVB) return;
        if(pinch && e.touches.length === 2){
          e.preventDefault();
          const { mx, my, dist } = getTouchMidAndDist(e.touches);
          const scale = pinch.d0 > 0 ? (pinch.d0 / dist) : 1; // bigger dist -> zoom in
          let nw = pinch.startVB.w * scale;
          let nh = pinch.startVB.h * scale;
          const ar = baseVB.w / baseVB.h;
          if(nw/nh > ar){ nh = nw / ar; } else { nw = nh * ar; }
          let nx = pinch.midUx - nw/2;
          let ny = pinch.midUy - nh/2;
          const clamped = clampVB(nx, ny, nw, nh);
          applyVB(clamped);
        }else if(panTouch && e.touches.length === 1){
          e.preventDefault();
          const t = e.touches[0];
          const rect = svg.getBoundingClientRect();
          const dxFrac = (t.clientX - panTouch.startX) / rect.width;
          const dyFrac = (t.clientY - panTouch.startY) / rect.height;
          const nx = panTouch.startVB.x - dxFrac * panTouch.startVB.w;
          const ny = panTouch.startVB.y - dyFrac * panTouch.startVB.h;
          const clamped = clampVB(nx, ny, panTouch.startVB.w, panTouch.startVB.h);
          applyVB(clamped);
        }
      }
      function onTouchEnd(e){
        if(e.touches.length < 2){ pinch = null; }
        if(e.touches.length === 0){ panTouch = null; }
      }

      // Mouse drag panning
      function onMouseDown(e){
        if(!svg || !baseVB) return;
        if(e.button !== 0) return; // left button only
        e.preventDefault();
        panMouse = { startX: e.clientX, startY: e.clientY, startVB: getCurrentVB() };
        svg.classList.add('panning');
        document.addEventListener('mousemove', onMouseMove, { passive:false });
        document.addEventListener('mouseup', onMouseUp, { passive:false });
      }
      function onMouseMove(e){
        if(!panMouse) return;
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const dxFrac = (e.clientX - panMouse.startX) / rect.width;
        const dyFrac = (e.clientY - panMouse.startY) / rect.height;
        const nx = panMouse.startVB.x - dxFrac * panMouse.startVB.w;
        const ny = panMouse.startVB.y - dyFrac * panMouse.startVB.h;
        const clamped = clampVB(nx, ny, panMouse.startVB.w, panMouse.startVB.h);
        applyVB(clamped);
      }
      function onMouseUp(e){
        if(panMouse){ panMouse = null; }
        svg.classList.remove('panning');
        document.removeEventListener('mousemove', onMouseMove, { passive:false });
        document.removeEventListener('mouseup', onMouseUp, { passive:false });
      }

      // Simple test controls (UI and keyboard)
      if(CONFIG.showTestControls){
        function doTestZoom(){
          if(!svg) return;
          const vb = (svg.getAttribute('viewBox')||'0 0 2000 857').split(/\s+/).map(Number);
          const bx = vb[0]||0, by = vb[1]||0, bw = vb[2]||2000, bh = vb[3]||857;
          const nx = bx + bw*0.2, ny = by + bh*0.2, nw = bw*0.6, nh = bh*0.6;
          svg.setAttribute('viewBox', `${nx} ${ny} ${nw} ${nh}`);
        }
        function doResetZoom(){ if(svg && baseVB) svg.setAttribute('viewBox', `${baseVB.x} ${baseVB.y} ${baseVB.w} ${baseVB.h}`); }
        if(btnTest) btnTest.addEventListener('click', doTestZoom);
        if(btnReset) btnReset.addEventListener('click', doResetZoom);
        root.addEventListener('keydown', (e) => { if(e.key.toLowerCase()==='z') doTestZoom(); if(e.key.toLowerCase()==='x') doResetZoom(); });
      }

      // Initialize
      return {
        destroy(){
          clearInterval(timerId); timerId = null;
          if(svg){
            svg.removeEventListener('click', onMapClick);
            svg.removeEventListener('wheel', onWheelZoom, { passive:false });
            svg.removeEventListener('touchstart', onTouchStart, { passive:false });
            svg.removeEventListener('touchmove', onTouchMove, { passive:false });
            svg.removeEventListener('touchend', onTouchEnd, { passive:false });
            svg.removeEventListener('touchcancel', onTouchEnd, { passive:false });
            svg.removeEventListener('mousedown', onMouseDown, { passive:false });
          }
          document.removeEventListener('mousemove', onMouseMove, { passive:false });
          document.removeEventListener('mouseup', onMouseUp, { passive:false });
        }
      };
    }
  };

  window.EduGames.countries_world = api;
  // Expose config for easy runtime tweaking via DevTools:
  //   window.EduGames.countries_world.setConfig({ zoomMode: 'cssScaleTest', cssScale: 1.25 })
  //   window.EduGames.countries_world.testZoom(); // quick manual test
})();
