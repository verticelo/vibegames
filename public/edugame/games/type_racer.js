// Type Racer — type sentences quickly; 1 point per completed sentence
// Exposes: window.EduGames.type_racer.start(mount, { durationMs, onFinish(score) })
(function(){
  window.EduGames = window.EduGames || {};

  // Poems: each non-empty line is a typing line
  const POEM_ROAD_NOT_TAKEN = [
    'Two roads diverged in a yellow wood,',
    'And sorry I could not travel both',
    'And be one traveler, long I stood',
    'And looked down one as far as I could',
    'To where it bent in the undergrowth;',
    'Then took the other, as just as fair,',
    'And having perhaps the better claim,',
    'Because it was grassy and wanted wear;',
    'Though as for that the passing there',
    'Had worn them really about the same,',
    'And both that morning equally lay',
    'In leaves no step had trodden black.',
    'Oh, I kept the first for another day!',
    'Yet knowing how way leads on to way,',
    'I doubted if I should ever come back.',
    'I shall be telling this with a sigh',
    'Somewhere ages and ages hence:',
    'Two roads diverged in a wood, and I—',
    'I took the one less traveled by,',
    'And that has made all the difference.'
  ];
  const POEM_INVICTUS = [
    'Out of the night that covers me,',
    '  Black as the Pit from pole to pole,',
    'I thank whatever gods may be',
    '  For my unconquerable soul.',
    'In the fell clutch of circumstance',
    '  I have not winced nor cried aloud.',
    'Under the bludgeonings of chance',
    '  My head is bloody, but unbowed.',
    'Beyond this place of wrath and tears',
    '  Looms but the Horror of the shade,',
    'And yet the menace of the years',
    '  Finds, and shall find, me unafraid.',
    'It matters not how strait the gate,',
    '  How charged with punishments the scroll,',
    'I am the master of my fate:',
    '  I am the captain of my soul.'
  ];

  function createLink(href){
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.dataset.egStyle = 'type_racer';
    document.head.appendChild(link);
    return link;
  }

  const POEMS = [
    { name: 'The Road Not Taken', lines: POEM_ROAD_NOT_TAKEN },
    { name: 'Invictus', lines: POEM_INVICTUS },
  ];
  function choosePoemOrder(){
    return Math.random() < 0.5 ? [POEMS[0], POEMS[1]] : [POEMS[1], POEMS[0]];
  }

  const api = {
    start(mount, opts={}){
      const durationMs = Number(opts.durationMs ?? 60000);
      let score = 0;
      let startedAt = 0;
      let timerId = null;
      let poems = choosePoemOrder();
      let whichPoem = 0; // 0 or 1
      let lineIdx = 0; // line within poem
      let pos = 0; // which char inside sentence
      let cssLink = null;

      // UI
      cssLink = createLink('games/type_racer.css');
      const root = document.createElement('div');
      root.className = 'tracer';
      root.innerHTML = `
        <div class="status">
          <span class="pill" id="tr-time">60.0s</span>
          <span class="pill">Score: <strong id="tr-score">0</strong></span>
          <span class="pill" id="tr-progress"></span>
        </div>
        <div class="sentence" id="tr-sentence"></div>
        <input id="tr-input" class="tr-input" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <div class="meta">Each completed line = 1 point. Wrong keys do nothing.</div>
      `;
      mount.appendChild(root);

      const elTime = root.querySelector('#tr-time');
      const elScore = root.querySelector('#tr-score');
      const elSent = root.querySelector('#tr-sentence');
      const elProg = root.querySelector('#tr-progress');
      const input = root.querySelector('#tr-input');

      function sentence(){
        // Trim leading whitespace per request, preserve punctuation
        return String(poems[whichPoem].lines[lineIdx] || '').replace(/^\s+/, '');
      }

      function updateProgress(){
        const poem = poems[whichPoem];
        elProg.textContent = `${poem.name} — ${lineIdx+1}/${poem.lines.length}`;
      }

      function render(){
        const s = sentence();
        const fr = document.createDocumentFragment();
        let i = 0;
        while(i < s.length){
          if(s[i] === ' '){
            // Use a real space text node so wrapping can occur at spaces
            fr.appendChild(document.createTextNode(' '));
            i += 1;
            continue;
          }
          const word = document.createElement('span');
          word.className = 'word';
          while(i < s.length && s[i] !== ' '){
            const ch = s[i];
            const span = document.createElement('span');
            span.className = 'char' + (i < pos ? ' done' : (i === pos ? ' next' : ''));
            span.textContent = ch;
            word.appendChild(span);
            i += 1;
          }
          fr.appendChild(word);
        }
        // Add a visual caret at end when sentence finished (so user sees focus)
        if(pos >= s.length){
          const caret = document.createElement('span'); caret.className = 'char next'; caret.textContent = ' ';
          fr.appendChild(caret);
        }
        elSent.innerHTML = '';
        elSent.appendChild(fr);
        updateProgress();
      }

      function nextSentence(){
        // advance within current poem; if end reached, move to next poem
        lineIdx += 1;
        if(lineIdx >= poems[whichPoem].lines.length){
          whichPoem = (whichPoem + 1) % poems.length; // alternate poems
          lineIdx = 0;
        }
        pos = 0;
        render();
      }

      function updateTime(){
        const remaining = Math.max(0, durationMs - (Date.now() - startedAt));
        elTime.textContent = (remaining/1000).toFixed(1) + 's';
        if(remaining <= 0){ finish(); }
      }

      function finish(){
        clearInterval(timerId); timerId = null;
        input.blur();
        if(typeof opts.onFinish === 'function') opts.onFinish(score);
      }

      function handleKey(ch){
        const s = sentence();
        if(pos >= s.length){
          // Already complete; any key advances to the next sentence
          score += 1; elScore.textContent = String(score);
          nextSentence();
          return;
        }
        const want = s[pos];
        if(ch === want){
          pos += 1;
          if(pos >= s.length){
            // Completed sentence: count and immediately move to the next
            score += 1; elScore.textContent = String(score);
            nextSentence();
          }else{
            // Update next-cursor position
            render();
          }
        }else{
          // wrong key: flash subtle feedback
          elSent.classList.remove('flash-wrong'); void elSent.offsetWidth; elSent.classList.add('flash-wrong');
        }
      }

      // Input handlers
      input.addEventListener('keydown', (e) => {
        // Allow navigation keys to be ignored
        const k = e.key;
        if(k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Control') return;
        if(k === 'Backspace' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); return; }
        if(k === 'Enter'){ e.preventDefault(); return; }
        if(k.length === 1){
          handleKey(k);
          e.preventDefault();
        }
      });

      // Init
      poems = choosePoemOrder();
      whichPoem = 0; lineIdx = 0; pos = 0; render();
      startedAt = Date.now();
      timerId = setInterval(updateTime, 100);
      setTimeout(()=>input.focus(), 0);

      return {
        destroy(){
          clearInterval(timerId); timerId = null;
          if(cssLink && cssLink.parentNode){ cssLink.parentNode.removeChild(cssLink); }
        }
      };
    }
  };

  window.EduGames.type_racer = api;
})();
