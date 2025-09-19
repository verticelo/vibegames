// Multiplication Racer — simple 30s multiplication exerciser
// Exposes: window.EduGames.multiplication_racer.start(mount, { durationMs, onFinish })
(function(){
  window.EduGames = window.EduGames || {};
  const api = {
    start(mount, opts={}){
      const durationMs = Number(opts.durationMs ?? 30000);
      let score = 0;
      let a = 0, b = 0, product = 0;
      let startedAt = 0;
      let timerId = null;

      const root = document.createElement('div');
      root.className = 'mracer';
      root.innerHTML = `
        <div class=\"status\">
          <span class=\"pill\" id=\"mr-time\">30.0s</span>
          <span class=\"pill\">Score: <strong id=\"mr-score\">0</strong></span>
        </div>
        <div class=\"big\"><span id=\"mr-a\">0</span> × <span id=\"mr-b\">0</span> =</div>
        <div class=\"inputline\">
          <input type=\"number\" inputmode=\"numeric\" pattern=\"[0-9]*\" class=\"input answer\" id=\"mr-answer\" placeholder=\"Answer\" autocomplete=\"off\" />
        </div>
        <p class=\"muted\">Type the answer; correct moves to next automatically.</p>
      `;
      mount.appendChild(root);

      const elTime = root.querySelector('#mr-time');
      const elScore = root.querySelector('#mr-score');
      const elA = root.querySelector('#mr-a');
      const elB = root.querySelector('#mr-b');
      const input = root.querySelector('#mr-answer');

      function next(){
        a = Math.floor(Math.random()*13); // 0–12 inclusive
        b = Math.floor(Math.random()*13);
        product = a * b;
        elA.textContent = a;
        elB.textContent = b;
        input.value = '';
        root.classList.remove('flash'); void root.offsetWidth; root.classList.add('flash');
      }

      function updateTime(){
        const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
        elTime.textContent = (remaining/1000).toFixed(1) + 's';
        if(remaining <= 0){ finish(); }
      }

      function finish(){
        clearInterval(timerId); timerId = null;
        input.disabled = true;
        if(typeof opts.onFinish === 'function') opts.onFinish(score);
      }

      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if(raw === '') return;
        const n = Number(raw);
        if(!Number.isFinite(n)) return;
        if(n === product){
          score += 1;
          elScore.textContent = String(score);
          next();
        }
      });

      // Quick clear shortcuts: Enter, plus, minus
      input.addEventListener('keydown', (e) => {
        const k = e.key;
        if(k === 'Enter' || k === '+' || k === '-'){
          e.preventDefault();
          input.value = '';
        }
      });

      startedAt = Date.now();
      timerId = setInterval(updateTime, 100);
      next();
      setTimeout(()=>input.focus(), 0);

      return {
        destroy(){ clearInterval(timerId); timerId = null; }
      };
    }
  };
  window.EduGames.multiplication_racer = api;
})();
