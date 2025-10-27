
  // helper: escape text for textContent (keeps data safe)
  function safeTextNode(text){
    return document.createTextNode(text == null ? '' : String(text));
  }
 
  const QUESTIONS_PATH = './quiz.json'; 

  // Fallback bank (2 Qs per language) — used if quiz.json can't be fetched.
  const INLINE_QUIZZES = {
    cpp: [
      { q: "Which header file is required for cout and cin?", options: ["<stdio.h>", "<iostream>", "<conio.h>", "<string.h>"], answer: 1 },
      { q: "Which of the following is a valid C++ comment?", options: ["/ comment", "<!-- comment--->", "/* comment */", "# comment"], answer: 2 },
    ],
    java: [
      { q: "What will be the result of the expression 10 % 3?", options: ["3", "0", "1", "9"], answer: 2 },
      { q: "Who developed the Java programming language?", options: ["Dennis Ritchie", "James Gosling", "Bjarne Stroustrup", "Guido van Rossum"], answer: 1 },
    ],
    python: [
      { q: "Who developed the Python programming language?", options: ["Dennis Ritchie", "James Gosling", "Bjarne Stroustrup", "Guido van Rossum"], answer: 3 },
      { q: "What is the correct file extension for Python files?", options: [".c", ".py", ".cpp", ".js"], answer: 1 },
    ],
    javascript: [
      { q: "What is the correct file extension for JavaScript files?", options: [".c", ".py", ".cpp", ".js"], answer: 3 },
      { q: "Which company developed JavaScript?", options: ["Netscape", "Microsoft", "Oracle", "Sun Microsystems"], answer: 0 },
    ]
  };

  // Load external JSON if available, otherwise fall back
  async function loadQuizzes() {
    try {
      const resp = await fetch(QUESTIONS_PATH, { cache: 'no-cache' });
      if (!resp.ok) throw new Error('Network response not ok: ' + resp.status);
      const data = await resp.json();
      // Basic validation: object with arrays of questions
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON root');
      const validated = {};
      for (const [lang, arr] of Object.entries(data)) {
        if (!Array.isArray(arr)) continue;
        validated[lang] = arr
          .filter(q => q && typeof q.q === 'string' && Array.isArray(q.options) && typeof q.answer === 'number')
          .map(q => ({ q: String(q.q), options: q.options.map(o => String(o)), answer: Number(q.answer) }));
      }
      if (Object.keys(validated).length === 0) throw new Error('No valid entries in quiz.json');
      console.log('Loaded quizzes from quiz.json:', Object.keys(validated));
      return validated;
    } catch (err) {
      console.warn('Using inline quizzes (could not load quiz.json):', err);
      return INLINE_QUIZZES;
    }
  }

  const LANGS = [
    { id: 'cpp', label: 'C++' },
    { id: 'java', label: 'Java' },
    { id: 'python', label: 'Python' },
    { id: 'javascript', label: 'JavaScript' },
  ];

  // DOM refs - landing
  const msToggle = document.getElementById('msToggle');
  const msDropdown = document.getElementById('msDropdown');
  const msPlaceholder = document.getElementById('msPlaceholder');
  const chipsContainer = document.getElementById('chipsContainer');
  const startBtn = document.getElementById('startBtn');
  const landingDiv = document.getElementById('landing');
  const quizDiv = document.getElementById('quiz');

  // other refs
  const metaEl = document.getElementById('meta');
  const qa = document.getElementById('qa');
  const totalQsEl = document.getElementById('totalQs');
  const timerEl = document.getElementById('timer');
  const qTimerEl = document.getElementById('qTimer');

  // runtime state
  let QUIZZES = {};            // populated by loader
  let selected = new Set();    // language ids
  let dropdownOpen = false;
  let isReviewMode = false;

  let questionSet = []; // array of question objects { q, options, answer, lang }
  let current = 0;
  let answers = [];     // indexes or null
  let timerInterval = null;
  let quizStartTime = null;

  // per-question timer
  const QUESTION_TIME = 60;
  let qTimerInterval = null;
  let qSecondsLeft = QUESTION_TIME;

  // LocalStorage keys
  const LS_KEY = 'candidate_quiz_state_v1';

  // shuffle helpers
  function shuffleArray(arr){
    for(let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffleQuestionOptions(question){
    const optionsCopy = question.options.slice();
    const mapped = optionsCopy.map((opt, idx) => ({ opt, idx }));
    shuffleArray(mapped);
    const newOptions = mapped.map(m => m.opt);
    const newAnswer = mapped.findIndex(m => m.idx === question.answer);
    return Object.assign({}, question, { options: newOptions, answer: newAnswer });
  }

  // -------------------------
  // PERSISTENCE (localStorage)
  // -------------------------
  function saveState(){
    try {
      const state = {
        selected: Array.from(selected),
        started: questionSet.length > 0,
        current,
        answers,
        // we store a lightweight questionSet meta so we can reconstruct after reload
        questionMeta: questionSet.map(q => ({ q: q.q, options: q.options, answer: q.answer, lang: q.lang })),
        timestamp: Date.now()
      };
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
  }

  function clearSavedState(){
    try { localStorage.removeItem(LS_KEY); } catch(e){}
  }

  function restoreState(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return false;
      const s = JSON.parse(raw);
      if(!s) return false;
      selected = new Set(s.selected || []);
      if(Array.isArray(s.questionMeta) && s.questionMeta.length){
        questionSet = s.questionMeta.map(m => ({ q: m.q, options: m.options, answer: m.answer, lang: m.lang }));
        answers = Array.isArray(s.answers) ? s.answers : new Array(questionSet.length).fill(null);
        current = typeof s.current === 'number' ? s.current : 0;
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Failed to restore state', e);
      return false;
    }
  }

  // -------------------------
  // UI: Multi-select & chips
  // -------------------------
  function buildList(){
    msDropdown.innerHTML = '';
    if(LANGS.length === 0){ msDropdown.innerHTML = '<div class="ms-empty">No languages</div>'; return; }
    LANGS.forEach(lang => {
      const row = document.createElement('label');
      row.className = 'ms-item';
      row.setAttribute('role','option');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = lang.id;
      cb.tabIndex = -1;
      if(selected.has(lang.id)) cb.checked = true;

      const span = document.createElement('span');
      span.style.fontWeight = 700;
      span.appendChild(safeTextNode(lang.label));

      row.appendChild(cb);
      row.appendChild(span);

      row.addEventListener('click', (e) => {
        const newChecked = !cb.checked;
        cb.checked = newChecked;
        toggleLang(lang.id, lang.label, newChecked);
      });
      msDropdown.appendChild(row);
    });
  }

  function renderChips(){
    chipsContainer.innerHTML = '';
    if(selected.size === 0){ msPlaceholder.textContent = 'Choose language(s)'; }
    else {
      msPlaceholder.textContent = `${selected.size} selected`;
      selected.forEach(id => {
        const info = LANGS.find(l => l.id === id);
        if(!info) return;
        const chip = document.createElement('div');
        chip.className = 'chip';
        const text = document.createElement('span');
        text.appendChild(safeTextNode(info.label));
        const btn = document.createElement('button');
        btn.setAttribute('aria-label', `Remove ${info.label}`);
        btn.dataset.id = id;
        btn.innerHTML = '&times;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleLang(id, null, false);
        });
        chip.appendChild(text);
        chip.appendChild(btn);
        chipsContainer.appendChild(chip);
      });
    }
    updateStartState();
  }

  function toggleLang(id, label, isSelected){
    if(isSelected) selected.add(id); else selected.delete(id);
    buildList();
    renderChips();
    saveState();
  }

  function openDropdown(){ msDropdown.hidden = false; msToggle.setAttribute('aria-expanded','true'); dropdownOpen = true; }
  function closeDropdown(){ msDropdown.hidden = true; msToggle.setAttribute('aria-expanded','false'); dropdownOpen = false; }
  function toggleDropdown(){ if(dropdownOpen) closeDropdown(); else openDropdown(); }
  function updateStartState(){ startBtn.disabled = selected.size === 0; }

  msToggle.addEventListener('click', () => toggleDropdown());
  msToggle.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleDropdown(); }
    else if(e.key === 'Escape'){ closeDropdown(); }
  });
  document.addEventListener('click', (e) => { const ms = document.getElementById('multiSelect'); if(ms && !ms.contains(e.target)) closeDropdown(); });
  msToggle.addEventListener('touchstart', (e)=>{}, {passive:true});

  // -------------------------
  // Timer helpers
  // -------------------------
  function formatTime(s){const m = String(Math.floor(s/60)).padStart(2,'0');const sec = String(s%60).padStart(2,'0');return `${m}:${sec}`}
  function startTimer(){ quizStartTime = Date.now(); timerEl.textContent = '00:00'; timerEl.style.display = 'block'; if(timerInterval) clearInterval(timerInterval); timerInterval = setInterval(()=>{ const elapsed = Math.floor((Date.now()-quizStartTime)/1000); timerEl.textContent = formatTime(elapsed); },1000); }
  function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval = null; }

  function startQuestionTimer(){
    if(qTimerInterval) clearInterval(qTimerInterval);
    qSecondsLeft = QUESTION_TIME;
    updateQTimerDisplay();
    qTimerEl.style.display = 'block';
    qTimerInterval = setInterval(()=>{ qSecondsLeft -= 1; if(qSecondsLeft <= 0){ clearInterval(qTimerInterval); qTimerInterval = null; autoSubmitCurrent(); } else { updateQTimerDisplay(); } }, 1000);
  }
  function stopQuestionTimer(){ if(qTimerInterval) clearInterval(qTimerInterval); qTimerInterval = null; updateQTimerDisplay(); }
  function updateQTimerDisplay(){ const status = (qTimerInterval ? 'active' : 'idle'); qTimerEl.textContent = `${qSecondsLeft}s — ${status}`; }

  function autoSubmitCurrent(){
    if(isReviewMode) return;
    const form = document.getElementById('optForm');
    let chosen = null;
    if(form){
      const checked = form.querySelector('input[name="choice"]:checked');
      if(checked) chosen = parseInt(checked.value, 10);
    }
    if(chosen !== null) answers[current] = chosen;
    saveState();
    if(current === questionSet.length - 1) finishQuiz();
    else { current++; renderQuestion(); }
  }

  // -------------------------
  // Start quiz
  // -------------------------
  startBtn.addEventListener('click', ()=> startQuiz());

  function startQuiz(){
    isReviewMode = false;
    const selArray = Array.from(selected);
    if(selArray.length === 0) return;

    questionSet = [];

    selArray.forEach(id => {
      const bank = QUIZZES[id] || [];
      if(bank && bank.length){
        bank.forEach(q => {
          const qCopy = shuffleQuestionOptions(Object.assign({}, q));
          qCopy.lang = id;
          questionSet.push(qCopy);
        });
      }
    });

    shuffleArray(questionSet);
    answers = new Array(questionSet.length).fill(null);
    current = 0;

    // UI swap
    landingDiv.style.display = 'none';
    quizDiv.style.display = 'block';
    quizDiv.setAttribute('aria-hidden','false');

    totalQsEl.textContent = questionSet.length;
    metaEl.innerHTML = `Languages: <span class="langs">${selArray.map(id=>`<span class="lang-pill">${(LANGS.find(l=>l.id===id)||{}).label||id}</span>`).join('')}</span>`;

    startBtn.disabled = true;
    startTimer();
    saveState();
    renderQuestion();
  }

  // -------------------------
  // Render single question
  // -------------------------
  function renderQuestion(){
    if(!questionSet || questionSet.length === 0) return;
    const q = questionSet[current];
    qa.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'q-card';
    card.setAttribute('aria-live','polite');

    const head = document.createElement('div');
    head.className = 'q-head';
    const left = document.createElement('div');
    left.style.fontSize = '0.9rem';
    left.style.color = 'var(--muted)';
    left.appendChild(safeTextNode('Language: '));
    const strong = document.createElement('strong');
    strong.appendChild(safeTextNode((LANGS.find(l=>l.id===q.lang)||{}).label||q.lang));
    left.appendChild(strong);

    const right = document.createElement('div');
    right.style.fontSize = '0.9rem';
    right.style.color = 'var(--muted)';
    right.appendChild(safeTextNode(`Question ${current+1} / ${questionSet.length}`));

    head.appendChild(left);
    head.appendChild(right);

    const qtext = document.createElement('div');
    qtext.className = 'q-text';
    qtext.appendChild(safeTextNode(q.q));

    const form = document.createElement('form');
    form.id = 'optForm';
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'options';

    q.options.forEach((opt, idx) => {
      const label = document.createElement('label');
      label.className = 'opt';
      label.tabIndex = 0;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'choice';
      input.value = idx;
      const inputId = `choice-${current}-${idx}`;
      input.id = inputId;
      if(answers[current] === idx) input.checked = true;
      input.addEventListener('change', ()=> { answers[current] = idx; saveState(); });

      const divText = document.createElement('div');
      divText.style.fontWeight = '700';
      // associate label text with input
      const textSpan = document.createElement('span');
      textSpan.appendChild(safeTextNode(opt));
      divText.appendChild(textSpan);

      label.appendChild(input);
      label.appendChild(divText);

      // keyboard Enter -> select + next
      label.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault();
          input.checked = true;
          answers[current] = idx;
          saveState();
          const nextBtn = document.getElementById('nextBtn');
          if(nextBtn) nextBtn.click();
        }
      });

      optionsWrap.appendChild(label);
    });

    form.appendChild(optionsWrap);

    const controls = document.createElement('div');
    controls.className = 'controls';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-ghost';
    backBtn.id = 'backBtn';
    backBtn.textContent = 'Back';
    if(current === 0) backBtn.disabled = true;
    backBtn.addEventListener('click', (e)=>{ e.preventDefault(); if(current>0){ current--; saveState(); renderQuestion(); } });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-ghost';
    clearBtn.id = 'clearBtn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e)=>{ e.preventDefault(); answers[current] = null; saveState(); renderQuestion(); });

    const spacer = document.createElement('div'); spacer.style.flex = '1';

    const progressWrap = document.createElement('div');
    progressWrap.style.width = '260px';
    const progress = document.createElement('div');
    progress.className = 'progress';
    const bar = document.createElement('i');
    // Progress: ((current+1) / total) to show progress including current question
    let percent = 0;
    if(questionSet.length > 0) percent = Math.round(((current + 1) / questionSet.length) * 100);
    bar.style.width = percent + '%';
    progress.appendChild(bar);
    progressWrap.appendChild(progress);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn-primary';
    nextBtn.id = 'nextBtn';
    nextBtn.textContent = current === questionSet.length - 1 ? 'Finish' : 'Next';
    nextBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      const checked = form.querySelector('input[name="choice"]:checked');
      const chosen = checked ? parseInt(checked.value, 10) : null;
      if(chosen !== null) answers[current] = chosen;
      saveState();
      if(current === questionSet.length - 1) finishQuiz();
      else { current++; renderQuestion(); }
    });

    controls.appendChild(backBtn);
    controls.appendChild(clearBtn);
    controls.appendChild(spacer);
    controls.appendChild(progressWrap);
    controls.appendChild(nextBtn);

    card.appendChild(head);
    card.appendChild(qtext);
    card.appendChild(form);
    card.appendChild(controls);

    qa.appendChild(card);

    // TIMING & REVIEW PROTECTION
    if (!isReviewMode) {
      qTimerEl.style.display = 'block';
      startQuestionTimer();
      updateQTimerDisplay();
      timerEl.style.display = 'block';

      backBtn.disabled = (current === 0);
      clearBtn.disabled = false;
      nextBtn.disabled = false;
    } else {
      stopQuestionTimer();
      stopTimer();
      qTimerEl.style.display = 'none';
      timerEl.style.display = 'none';

      const inputs = form.querySelectorAll('input[name="choice"]');
      inputs.forEach(inp => inp.disabled = true);

      backBtn.disabled = (current === 0);
      clearBtn.disabled = true;
      nextBtn.disabled = false;
    }
    // focus first input for accessibility
    setTimeout(()=> {
      const first = form.querySelector('input[name="choice"]');
      if(first) first.focus();
    },50);
  }

  // -------------------------
  // Finish quiz -> results
  // -------------------------
  function finishQuiz(){
    if(!questionSet || questionSet.length === 0) return;
    stopTimer();
    stopQuestionTimer();
    qTimerEl.textContent = "Finished ✅";

    let correctCount = 0;
    const details = questionSet.map((q, idx) => {
      const got = answers[idx];
      const ok = got === q.answer;
      if(ok) correctCount++;
      return { q: q.q, options: q.options, correct: q.answer, got, lang: q.lang };
    });

    qa.innerHTML = ''; // clear current question
    clearSavedState(); // quiz complete - clear saved progress

    // results container
    const resultBox = document.createElement('div');
    resultBox.className = 'result';

    const h3 = document.createElement('h3');
    h3.style.marginBottom = '8px';
    h3.appendChild(safeTextNode('Results'));
    resultBox.appendChild(h3);

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.gap = '14px';
    topRow.style.alignItems = 'center';
    topRow.style.flexWrap = 'wrap';

    const score = document.createElement('div');
    score.style.fontSize = '1.6rem';
    score.style.fontWeight = '800';
    score.appendChild(safeTextNode(`Score: ${correctCount} / ${questionSet.length}`));

    const percentScore = Math.round((correctCount / questionSet.length) * 100);
    const percentBadge = document.createElement('div');
    percentBadge.style.marginLeft = '8px';
    percentBadge.style.fontWeight = '800';
    percentBadge.appendChild(safeTextNode(`${percentScore}%`));
    score.appendChild(percentBadge);

    const timeDiv = document.createElement('div');
    timeDiv.style.color = 'var(--muted)';
    timeDiv.appendChild(safeTextNode(`Time: ${timerEl.textContent}`));

    const rightControls = document.createElement('div');
    rightControls.style.marginLeft = 'auto';

    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'btn-ghost';
    reviewBtn.id = 'reviewBtn';
    reviewBtn.textContent = 'Review Answers';

    reviewBtn.addEventListener('click', () => {
      isReviewMode = true;
      stopQuestionTimer();
      stopTimer();
      timerEl.style.display = 'none';
      qTimerEl.style.display = 'none';
      current = 0;
      renderQuestion();
    });

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn-primary';
    restartBtn.id = 'restartBtn';
    restartBtn.textContent = 'Restart';
    restartBtn.addEventListener('click', ()=> {
      isReviewMode = false;
      selected = new Set();
      questionSet = [];
      answers = [];
      current = 0;
      stopQuestionTimer();
      stopTimer();
      buildList(); renderChips(); updateStartState();
      landingDiv.style.display = 'block';
      quizDiv.style.display = 'none';
      quizDiv.setAttribute('aria-hidden','true');
      timerEl.style.display = 'none';
      startBtn.disabled = false;
      clearSavedState();
    });

    rightControls.appendChild(reviewBtn);
    rightControls.appendChild(restartBtn);

    topRow.appendChild(score);
    topRow.appendChild(timeDiv);
    topRow.appendChild(rightControls);

    resultBox.appendChild(topRow);

    // Pass/fail logic: pass if percent >= 50
    if(percentScore >= 50){
      const passBanner = document.createElement('div');
      passBanner.className = 'pass-banner';
      passBanner.appendChild(safeTextNode('Congratulations — you passed!'));

      resultBox.appendChild(passBanner);

      // Submit resume button + hidden file input
      const resumeWrap = document.createElement('div');
      resumeWrap.style.marginTop = '12px';
      resumeWrap.style.display = 'flex';
      resumeWrap.style.gap = '10px';
      resumeWrap.style.alignItems = 'center';
      resumeWrap.style.flexWrap = 'wrap';

      const submitResumeBtn = document.createElement('button');
      submitResumeBtn.className = 'btn-primary';
      submitResumeBtn.id = 'submitResumeBtn';
      submitResumeBtn.textContent = 'Submit Resume';

      const resumeInput = document.createElement('input');
      resumeInput.type = 'file';
      resumeInput.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      resumeInput.style.display = 'none';
      resumeInput.id = 'resumeInput';

      const resumeNote = document.createElement('div');
      resumeNote.style.color = 'var(--muted)';
      resumeNote.style.fontSize = '0.95rem';
      resumeNote.appendChild(safeTextNode('Upload your resume (PDF, DOC or DOCX) to proceed.'));

      submitResumeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resumeInput.value = '';
        resumeInput.click();
      });

      // simple validation helper (checks extension + MIME when available) + size check (2MB)
      function isAllowedResumeFile(file) {
        if(!file) return false;
        const allowedExt = ['.pdf', '.doc', '.docx'];
        const name = (file.name || '').toLowerCase();
        for(const ext of allowedExt) if(name.endsWith(ext)) return true;
        const allowedMime = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        if(allowedMime.includes(file.type)) return true;
        return false;
      }

      resumeInput.addEventListener('change', (e) => {
        const f = resumeInput.files && resumeInput.files[0];
        if(!f) return;
        // client-side size limit
        const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
        if(f.size > MAX_BYTES) {
          const err = document.createElement('div');
          err.style.color = '#ff8f9e';
          err.style.marginTop = '8px';
          err.appendChild(safeTextNode('File too large. Maximum allowed size is 2 MB.'));
          resumeWrap.appendChild(err);
          resumeInput.value = '';
          return;
        }
        if(!isAllowedResumeFile(f)) {
          const err = document.createElement('div');
          err.style.color = '#ff8f9e';
          err.style.marginTop = '8px';
          err.appendChild(safeTextNode('Invalid file type. Please upload a PDF, DOC or DOCX file.'));
          resumeWrap.appendChild(err);
          resumeInput.value = '';
          return;
        }

        // show submitted state
        submitResumeBtn.textContent = 'Resume submitted ✓';
        submitResumeBtn.disabled = true;
        const conf = document.createElement('div');
        conf.style.color = 'var(--muted)';
        conf.style.marginTop = '8px';
        conf.appendChild(safeTextNode(`Received: ${f.name}`));
        resumeWrap.appendChild(conf);
      });

      resumeWrap.appendChild(submitResumeBtn);
      resumeWrap.appendChild(resumeNote);
      resultBox.appendChild(resumeWrap);
      resultBox.appendChild(resumeInput);

    } else {
      const failBanner = document.createElement('div');
      failBanner.className = 'fail-banner';
      failBanner.appendChild(safeTextNode('Not passed — try again later.'));
      const failHint = document.createElement('div');
      failHint.style.color = 'var(--muted)';
      failHint.style.marginTop = '8px';
      failHint.appendChild(safeTextNode('Review the questions and try a future round.'));
      resultBox.appendChild(failBanner);
      resultBox.appendChild(failHint);
    }

    const hint = document.createElement('div');
    hint.style.marginTop = '12px';
    hint.style.color = 'var(--muted)';
    hint.appendChild(safeTextNode('Scroll to see per-question feedback.'));
    resultBox.appendChild(hint);

    qa.appendChild(resultBox);

    // DETAILS list (one node per question)
    const detailsWrap = document.createElement('div');
    detailsWrap.style.marginTop = '14px';

    details.forEach((d, i) => {
      const item = document.createElement('div');
      item.style.marginBottom = '10px';
      item.style.padding = '12px';
      item.style.borderRadius = '10px';
      item.style.background = 'rgba(255,255,255,0.02)';

      const qTitle = document.createElement('div');
      qTitle.style.fontWeight = '800';
      qTitle.appendChild(safeTextNode(`Q${i+1} (${(LANGS.find(l=>l.id===d.lang)||{}).label||d.lang}): ${d.q}`));
      item.appendChild(qTitle);

      const optsWrap = document.createElement('div');
      optsWrap.style.marginTop = '8px';

      d.options.forEach((optText, oi) => {
        const optLine = document.createElement('div');
        optLine.style.padding = '6px';
        optLine.style.borderRadius = '8px';
        optLine.style.marginTop = '6px';
        optLine.style.background = 'rgba(0,0,0,0.25)';

        const span = document.createElement('span');
        if(oi === d.correct) span.className = 'correct';
        else if(oi === d.got && d.got !== d.correct) span.className = 'wrong';
        span.appendChild(safeTextNode(optText));

        optLine.appendChild(span);
        if(oi === d.correct) optLine.appendChild(safeTextNode(' — correct'));
        else if(oi === d.got) optLine.appendChild(safeTextNode(' — your answer'));

        optsWrap.appendChild(optLine);
      });

      item.appendChild(optsWrap);
      detailsWrap.appendChild(item);
    });

    qa.appendChild(detailsWrap);
  }

  // -------------------------
  // INITIALIZE: load quizzes, restore state, wire UI
  // -------------------------
  (async function init(){
    QUIZZES = await loadQuizzes();

    // restore state if any
    const had = restoreState();
    buildList();
    renderChips();
    updateStartState();

    // if user has an in-progress quiz, offer to resume automatically
    if(had){
      // reconstruct UI into quiz view if questionSet exists
      if(questionSet.length > 0){
        landingDiv.style.display = 'none';
        quizDiv.style.display = 'block';
        quizDiv.setAttribute('aria-hidden','false');
        totalQsEl.textContent = questionSet.length;
        metaEl.innerHTML = `Languages: <span class="langs">${Array.from(selected).map(id=>`<span class="lang-pill">${(LANGS.find(l=>l.id===id)||{}).label||id}</span>`).join('')}</span>`;
        startBtn.disabled = true;
        startTimer(); // resume timer from now (we don't persist elapsed time in this simple version)
        renderQuestion();
      }
    }
  })();

  // make sure to save before unload (best-effort)
  window.addEventListener('beforeunload', saveState);

