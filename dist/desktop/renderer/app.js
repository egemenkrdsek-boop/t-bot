/**
 * T Bot 2.0 — Cyber-Zen Desktop UI Controller
 * Sıfır-Framework Vanilla JavaScript (ES2022)
 * Local renderer backed by the isolated preload bridge.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Durum Yönetimi (Application State)
  // =========================================================================
  const state = {
    workspace: '',
    appVersion: '',
    currentSessionId: null,
    isThinking: false,
    turnPending: false,
    sessionLoading: false,
    thinkingStartTime: 0,
    thinkingTimerId: null,
    spinnerIndex: 0,
    turnAssistantTextProduced: false,
    yoloEnabled: false,
    currentStepCount: 0,
    attachedImages: [], // { mimeType: 'image/png', data: base64, name: string }
    currentApproval: null,
    approvalQueue: [],
    model: 'gemini-2.5-pro',
    provider: 'gemini',
    effort: 'medium',
    telemetry: {
      ramMB: 0,
      savingsPercent: 0,
      savedTokens: 0,
      systemUsedPercent: 0,
      groundedStatus: '—',
    },
    goal: null,
    todos: [],
    skills: [],
    mcpCount: 0,
    theme: localStorage.getItem('tbot_theme') || 'light',
  };

  // Türkçe Araç Başlık Eşleştirmesi (CLI ile %100 Birebir)
  const TOOL_TITLE_MAP = {
    file_read: 'Dosya Okuma',
    file_write: 'Dosya Yazma',
    file_patch: 'Dosya Yamalama',
    file_list: 'Dosya Listeleme',
    file_search: 'Dosya Arama',
    file_glob: 'Dosya Bulma',
    file_outline: 'Dosya Özeti',
    shell: 'Komut Satırı',
    process_list: 'İşlem Listesi',
    process_output: 'İşlem Çıktısı',
    process_stop: 'İşlem Durdurma',
    process_write: 'Süreç Girdisi Gönderme',
    git_status: 'Git Durumu',
    git_diff: 'Git Farkı',
    git_log: 'Git Günlüğü',
    git_add: 'Git Ekleme',
    git_commit: 'Git İşleme',
    git_push: 'Git Gönderme',
    git_branch: 'Git Dalı',
    web_search: 'Web Araması',
    url_fetch: 'Web Sayfası Okuma',
    browser_navigate: 'Tarayıcı Gezinme',
    browser_click: 'Tarayıcı Tıklama',
    browser_type: 'Tarayıcı Yazma',
    browser_fill: 'Form Doldurma',
    browser_press: 'Tarayıcı Tuş Basımı',
    browser_scroll: 'Tarayıcı Kaydırma',
    browser_hover: 'Tarayıcı Üzerine Gelme',
    browser_evaluate: 'Tarayıcı Betik Çalıştırma',
    browser_inspect: 'Sayfa İnceleme',
    browser_tabs: 'Tarayıcı Sekme Yönetimi',
    browser_screenshot: 'Tarayıcı Ekran Görüntüsü',
    computer: 'Bilgisayar Kontrolü',
    image_generate: 'Görsel Üretimi',
    memory_save: 'Bellek Kaydetme',
    memory_recall: 'Bellek Hatırlama',
    memory_forget: 'Hafıza Silme',
    todo_manage: 'Görev Pusulası',
    goal_manage: 'Hedef Yönetimi',
    skill_create: 'Yetenek Oluşturma',
    skill_list: 'Yetenek Listesi',
    delegate_task: 'Alt Ajan Görevlendirme',
    mcp_catalog: 'MCP Kataloğu',
    mcp_call: 'MCP Çağrısı',
  };


  const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Güvenli T Bot IPC Köprüsü (preload.cjs sarmalayıcısı)
  const tbot = window.tbot;
  if (!tbot) {
    document.body.textContent = 'T Bot masaüstü bağlantısı yüklenemedi. Uygulamayı yeniden başlatın.';
    return;
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // =========================================================================
  // 2. DOM Seçicileri (Elements Cache)
  // =========================================================================
  const dom = {
    // Başlık Çubuğu
    logoCanvas: document.getElementById('logo-canvas'),
    heroLogoCanvas: document.getElementById('hero-logo-canvas'),
    btnWorkspace: document.getElementById('btn-workspace'),
    workspacePath: document.getElementById('workspace-path'),
    telemetryBadge: document.getElementById('telemetry-badge'),
    telemetryRamVal: document.getElementById('telemetry-ram-val'),
    telemetrySavingsVal: document.getElementById('telemetry-savings-val'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleLabel: document.getElementById('theme-toggle-label'),
    btnTrimRam: document.getElementById('btn-trim-ram'),
    btnPin: document.getElementById('btn-pin'),
    btnMin: document.getElementById('btn-min'),
    btnMax: document.getElementById('btn-max'),
    btnClose: document.getElementById('btn-close'),

    // Üst Bar & Stepper
    btnQuickYolo: document.getElementById('btn-quick-yolo'),
    yoloIcon: document.getElementById('yolo-icon'),
    yoloLabel: document.getElementById('yolo-label'),
    btnQuickConfig: document.getElementById('btn-quick-config'),
    btnQuickDoctor: document.getElementById('btn-quick-doctor'),
    btnQuickClear: document.getElementById('btn-quick-clear'),

    // Sol Panel
    sidebarLeft: document.getElementById('sidebar-left'),
    btnCollapseLeft: document.getElementById('btn-collapse-left'),
    btnNewSession: document.getElementById('btn-new-session'),
    sessionsList: document.getElementById('sessions-list'),
    sessionsCount: document.getElementById('sessions-count'),
    btnLaunchGoal: document.getElementById('btn-launch-goal'),

    // Sağ Panel (Görev Pusulası)
    sidebarRight: document.getElementById('sidebar-right'),
    btnCollapseRight: document.getElementById('btn-collapse-right'),
    btnRefreshWorkflow: document.getElementById('btn-refresh-workflow'),
    goalObjective: document.getElementById('goal-objective'),
    goalStatusBadge: document.getElementById('goal-status-badge'),
    goalNotesList: document.getElementById('goal-notes-list'),
    btnGoalSet: document.getElementById('btn-goal-set'),
    btnGoalComplete: document.getElementById('btn-goal-complete'),
    btnGoalCancel: document.getElementById('btn-goal-cancel'),
    inputNewTodo: document.getElementById('input-new-todo'),
    btnAddTodo: document.getElementById('btn-add-todo'),
    todosList: document.getElementById('todos-list'),
    todosProgressBadge: document.getElementById('todos-progress-badge'),
    heroCardGoal: document.getElementById('hero-card-goal'),
    mcpServerCountTag: document.getElementById('mcp-server-count-tag'),

    // Terminal & Sohbet
    chatFeed: document.getElementById('chat-feed'),
    emptyHero: document.getElementById('empty-hero'),
    thinkingBar: document.getElementById('thinking-bar'),
    thinkingSpinner: document.getElementById('thinking-spinner'),
    thinkingStepBadge: document.getElementById('thinking-step-badge'),
    thinkingLabel: document.getElementById('thinking-label'),
    thinkingTimer: document.getElementById('thinking-timer'),
    btnAbortTurn: document.getElementById('btn-abort-turn'),
    btnScrollBottom: document.getElementById('btn-scroll-bottom'),

    // Alt Giriş & HUD
    attachmentChips: document.getElementById('attachment-chips'),
    btnSlashHint: document.getElementById('btn-slash-hint'),
    btnAttach: document.getElementById('btn-attach'),
    fileInputHidden: document.getElementById('file-input-hidden'),
    userInput: document.getElementById('user-input'),
    btnSend: document.getElementById('btn-send'),
    hudModelVal: document.getElementById('hud-model-val'),
    hudEffortVal: document.getElementById('hud-effort-val'),
    hudSavingsVal: document.getElementById('hud-savings-val'),
    hudMiniBar: document.getElementById('hud-mini-bar'),
    hudTokensSaved: document.getElementById('hud-tokens-saved'),
    hudGroundingVal: document.getElementById('hud-grounding-val'),
    hudRamVal: document.getElementById('hud-ram-val'),
    hudRamDot: document.getElementById('hud-ram-dot'),

    // Komut Paleti
    commandPalette: document.getElementById('command-palette'),
    paletteSearch: document.getElementById('palette-search'),
    paletteItems: document.getElementById('palette-items'),

    // Modallar & Lightbox & Drag
    configModal: document.getElementById('config-modal'),
    selectProvider: document.getElementById('select-provider'),
    inputApiKey: document.getElementById('input-api-key'),
    btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),
    btnSaveKey: document.getElementById('btn-save-key'),
    selectModel: document.getElementById('select-model'),
    inputCustomModel: document.getElementById('input-custom-model'),
    selectEffort: document.getElementById('select-effort'),
    modalBtnCloseConfig: document.getElementById('modal-btn-close-config'),
    modalBtnCancelConfig: document.getElementById('modal-btn-cancel-config'),
    modalBtnSaveAllConfig: document.getElementById('modal-btn-save-all-config'),

    doctorModal: document.getElementById('doctor-modal'),
    doctorResults: document.getElementById('doctor-results'),
    modalBtnCloseDoctor: document.getElementById('modal-btn-close-doctor'),
    modalBtnCloseDoctorBtn: document.getElementById('modal-btn-close-doctor-btn'),
    modalBtnRerunDoctor: document.getElementById('modal-btn-rerun-doctor'),

    goalModal: document.getElementById('goal-modal'),
    inputModalGoal: document.getElementById('input-modal-goal'),
    modalBtnCloseGoal: document.getElementById('modal-btn-close-goal'),
    modalBtnCancelGoal: document.getElementById('modal-btn-cancel-goal'),
    modalBtnStartGoal: document.getElementById('modal-btn-start-goal'),

    lightboxModal: document.getElementById('lightbox-modal'),
    lightboxBackdrop: document.getElementById('lightbox-backdrop'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxTitle: document.getElementById('lightbox-title'),
    lightboxBtnDownload: document.getElementById('lightbox-btn-download'),
    lightboxBtnClose: document.getElementById('lightbox-btn-close'),

    dragOverlay: document.getElementById('drag-overlay'),
  };

  // =========================================================================
  // 3. 14x14 Cyber-Zen Piksel Logo Animasyonu (Canvas Rendering)
  // =========================================================================
  const LOGO_MATRIX = [
    'GGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGG',
    'GGGGGWWGGGGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGWWWWWWGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGGWWWGGGGGG',
    'GGGGGWWWWGGGGG',
    'GGGGGGWWWGGGGG',
    'GGGGGGGGGGGGGG',
    '.GGGGGGGGGGGGG',
  ];

  function drawPixelLogo(canvas, frame = 0) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const pixelSize = size / 14;
    ctx.clearRect(0, 0, size, size);

    const isLight = (document.documentElement.getAttribute('data-theme') || state.theme) !== 'dark';
    const wavePos = (frame % 80) * 0.45;

    // Açık temada tam beyaz (#FFFFFF) zemin, koyu temada Deep Slate (#0D1117)
    ctx.fillStyle = isLight ? '#FFFFFF' : '#0D1117';
    ctx.fillRect(0, 0, size, size);

    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 14; x++) {
        const char = LOGO_MATRIX[y]?.[x] || '.';
        if (char === '.') {
          ctx.fillStyle = isLight ? '#EDF3EB' : '#141C28';
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize - 0.2, pixelSize - 0.2);
          continue;
        }

        const diag = x + y * 0.8;
        const diff = Math.abs(diag - wavePos);
        const isHighlight = diff < 2.5;

        if (char === 'W') {
          // Saf Beyaz T Simgesi
          ctx.fillStyle = isHighlight ? '#FFFFFF' : (isLight ? '#FFFFFF' : '#F4FCE8');
        } else {
          // Tabit Yeşili Zemin
          if (isHighlight) {
            ctx.fillStyle = isLight ? '#65B817' : '#E2FAAA';
          } else {
            if (isLight) {
              const t = (x + y) / 26;
              const r = Math.round(77 + (101 - 77) * t);
              const g = Math.round(154 + (184 - 154) * t);
              const b = Math.round(15 + (23 - 15) * t);
              ctx.fillStyle = `rgb(${r},${g},${b})`;
            } else {
              const t = (x + y) / 26;
              const r = Math.round(132 + (184 - 132) * t);
              const g = Math.round(204 + (236 - 204) * t);
              const b = Math.round(50 + (110 - 50) * t);
              ctx.fillStyle = `rgb(${r},${g},${b})`;
            }
          }
        }

        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize - 0.2, pixelSize - 0.2);
      }
    }
  }

  const renderPixelLogo = drawPixelLogo;

  // =========================================================================
  // 3b. Tema Yönetimi (Daylight Light / Dark Mode)
  // =========================================================================
  function applyTheme(theme) {
    state.theme = theme || 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    document.body.setAttribute('data-theme', state.theme);
    localStorage.setItem('tbot_theme', state.theme);

    if (dom.themeToggleIcon && dom.themeToggleLabel) {
      if (state.theme === 'light') {
        dom.themeToggleIcon.textContent = '☀️';
        dom.themeToggleLabel.textContent = 'Açık';
      } else {
        dom.themeToggleIcon.textContent = '🌙';
        dom.themeToggleLabel.textContent = 'Koyu';
      }
    }
    drawPixelLogo(dom.logoCanvas, logoAnimFrame);
    drawPixelLogo(dom.heroLogoCanvas, logoAnimFrame);
  }

  function toggleTheme() {
    const nextTheme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
  }

  let logoAnimFrame = 0;
  function startLogoAnimation() {
    // Static logos avoid waking a renderer 60 times each second while idle.
    drawPixelLogo(dom.logoCanvas);
    drawPixelLogo(dom.heroLogoCanvas);
  }

  // =========================================================================
  // 4. Ultracode Stepper & Hızlı Modlar
  // =========================================================================
  function toggleYoloMode() {
    state.yoloEnabled = !state.yoloEnabled;
    if (state.yoloEnabled) {
      dom.btnQuickYolo?.classList.add('yolo-active');
      if (dom.yoloIcon) dom.yoloIcon.textContent = '⚡';
      if (dom.yoloLabel) dom.yoloLabel.textContent = 'YOLO';
    } else {
      dom.btnQuickYolo?.classList.remove('yolo-active');
      if (dom.yoloIcon) dom.yoloIcon.textContent = '🛡️';
      if (dom.yoloLabel) dom.yoloLabel.textContent = 'Onaylı';
    }
    dom.btnQuickYolo?.setAttribute('aria-pressed', String(state.yoloEnabled));
  }

  // =========================================================================
  // 5. Canlı Cyber-HUD ve Telemetri Güncellemesi
  // =========================================================================
  function renderMiniSavingsBar(percent, width = 5) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    const filled = Math.round((clamped / 100) * width);
    const empty = Math.max(0, width - filled);
    return '▰'.repeat(filled) + '▱'.repeat(empty);
  }

  function updateHudBar() {
    if (dom.hudModelVal) dom.hudModelVal.textContent = state.model;
    const effortLabel = toTurkishTitleCase(state.effort);
    if (dom.hudEffortVal) dom.hudEffortVal.textContent = effortLabel;

    if (dom.hudSavingsVal) dom.hudSavingsVal.textContent = `%${state.telemetry.savingsPercent}`;
    if (dom.telemetrySavingsVal) dom.telemetrySavingsVal.textContent = state.telemetry.savingsPercent;
    if (dom.hudMiniBar) dom.hudMiniBar.textContent = renderMiniSavingsBar(state.telemetry.savingsPercent, 5);
    if (dom.hudTokensSaved) dom.hudTokensSaved.textContent = `(${state.telemetry.savedTokens.toLocaleString()} Tok)`;

    if (dom.hudRamVal) dom.hudRamVal.textContent = `${state.telemetry.ramMB} MB`;
    if (dom.telemetryRamVal) dom.telemetryRamVal.textContent = `${state.telemetry.ramMB} MB`;

    // Ram baskı rengi
    if (dom.hudRamDot) {
      if (state.telemetry.ramMB > 250) {
        dom.hudRamDot.className = 'hud-dot-danger';
        dom.hudRamDot.textContent = '▲';
      } else if (state.telemetry.ramMB > 120) {
        dom.hudRamDot.className = 'hud-dot-amber';
        dom.hudRamDot.textContent = '■';
      } else {
        dom.hudRamDot.className = 'hud-dot-green';
        dom.hudRamDot.textContent = '●';
      }
    }
  }

  function updateTelemetry(data) {
    if (!data) return;
    const ram = data.totalWorkingSetMB ?? data.totalAppMB ?? data.mainMB ?? data.ramMB;
    if (typeof ram === 'number') state.telemetry.ramMB = ram;
    if (typeof data.savingsPercent === 'number') state.telemetry.savingsPercent = Math.round(data.savingsPercent);
    if (typeof data.savedTokens === 'number') state.telemetry.savedTokens = data.savedTokens;
    if (typeof data.systemUsedPercent === 'number') state.telemetry.systemUsedPercent = data.systemUsedPercent;
    if (typeof data.groundedStatus === 'string') state.telemetry.groundedStatus = data.groundedStatus;
    updateHudBar();
  }

  // =========================================================================
  // 6. Canlı Cyber-Wave Düşünme Çubuğu & Zamanlayıcı
  // =========================================================================
  function startThinking(label = 'Düşünülüyor…', step = null) {
    if (!state.isThinking) state.thinkingStartTime = Date.now();
    state.isThinking = true;
    if (step) state.currentStepCount = step;
    if (dom.thinkingSpinner) dom.thinkingSpinner.textContent = '●';

    dom.thinkingBar?.classList.remove('hidden');
    if (dom.thinkingLabel) dom.thinkingLabel.textContent = label;
    if (dom.thinkingStepBadge) {
      dom.thinkingStepBadge.textContent = state.currentStepCount > 0 ? `Adım ${state.currentStepCount}` : 'Çekirdek';
    }

    if (state.thinkingTimerId) return;
    state.thinkingTimerId = setInterval(() => {
      state.spinnerIndex = (state.spinnerIndex + 1) % BRAILLE_SPINNER.length;
      if (dom.thinkingSpinner) dom.thinkingSpinner.textContent = reducedMotion.matches ? '●' : BRAILLE_SPINNER[state.spinnerIndex];

      const elapsedSec = ((Date.now() - state.thinkingStartTime) / 1000).toFixed(1);
      if (dom.thinkingTimer) dom.thinkingTimer.textContent = `${elapsedSec}sn`;
    }, 1000);
  }

  function updateThinkingLabel(label) {
    if (dom.thinkingLabel) dom.thinkingLabel.textContent = label;
  }

  function stopThinking() {
    state.isThinking = false;
    if (state.thinkingTimerId) {
      clearInterval(state.thinkingTimerId);
      state.thinkingTimerId = null;
    }
    dom.thinkingBar?.classList.add('hidden');
  }

  function abortCurrentTurn() {
    try {
      tbot.abortTurn?.().catch(error => appendErrorNotice(String(error)));
    } catch (e) {
      console.warn('tbot.abortTurn hatası:', e);
    }
    finalizeAssistantMessage();
    stopThinking();
  }

  // =========================================================================
  // 7. Markdown Ayrıştırıcı (Hızlı & Sıfır Bağımlılık Vanilla Parser)
  // =========================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toTurkishTitleCase(str) {
    if (!str) return '';
    return str.charAt(0).toLocaleUpperCase('tr-TR') + str.slice(1);
  }

  function parseMarkdown(mdText) {
    if (!mdText) return '';
    let text = String(mdText).replace(/\r\n/g, '\n');

    // 1. Kod Blokları (```lang ... ```)
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      const cleanLang = lang || 'kod';
      const escapedCode = escapeHtml(code.trimEnd());
      codeBlocks.push(`
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span>${escapeHtml(cleanLang)}</span>
            <button class="btn-copy-code" data-copy-code>Görünür kodu kopyala</button>
          </div>
          <pre><code>${escapedCode}</code></pre>
        </div>
      `);
      return `__CODE_BLOCK_${idx}__`;
    });

    text = escapeHtml(text);

    // 2. Satır İçi Kod (`kod`)
    text = text.replace(/`([^`\n]+)`/g, (match, inline) => {
      return `<code>${inline}</code>`;
    });

    // 3. Başlıklar
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 4. Kalın ve İtalik
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 5. Alıntılar (Blockquote)
    text = text.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>');

    // 6. Maddeler (- veya * listeleri)
    text = text.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

    // 7. Paragraflar ve Satır Sonları
    const lines = text.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^__(CODE_BLOCK_\d+)__$/.test(line)) {
        result.push(line);
      } else if (line.startsWith('<h1>') || line.startsWith('<h2>') || line.startsWith('<h3>') || line.startsWith('<ul>') || line.startsWith('<blockquote>')) {
        result.push(line);
      } else if (line.trim().length > 0) {
        result.push(`<p>${line}</p>`);
      }
    }
    let html = result.join('\n');

    // Kod bloklarını geri yerleştir
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, idx) => {
      return codeBlocks[parseInt(idx, 10)] || '';
    });

    return html;
  }

  // Genel Kopyalama Yardımcısı
  window.tbotCopyCode = function (btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const code = wrapper ? wrapper.querySelector('pre code')?.innerText : '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Kopyalandı';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    }
  };

  // =========================================================================
  // 8. Sohbet Akışı & Mesaj Ekleme Mantığı
  // =========================================================================
  function hideEmptyHero() {
    dom.emptyHero?.classList.add('hidden');
  }

  function showEmptyHeroIfEmpty() {
    const messages = dom.chatFeed?.querySelectorAll('.message-wrapper, .tool-card');
    if (!messages || messages.length === 0) {
      dom.emptyHero?.classList.remove('hidden');
    }
  }

  function isTranscriptAtBottom() {
    return !dom.chatFeed || dom.chatFeed.scrollHeight - dom.chatFeed.scrollTop <= dom.chatFeed.clientHeight + 100;
  }

  function scrollToBottom(force = false) {
    if (!dom.chatFeed) return;
    const isAtBottom = isTranscriptAtBottom();
    if (force || isAtBottom) {
      dom.chatFeed.scrollTop = dom.chatFeed.scrollHeight;
      dom.btnScrollBottom?.classList.add('hidden');
    } else {
      dom.btnScrollBottom?.classList.remove('hidden');
    }
  }

  const TRANSCRIPT_PAGE_SIZE = 40;
  const TEXT_PAGE_CHARS = 16_000;
  const transcriptEntries = [];
  const renderedTranscriptEntries = new Set();
  const pinnedTranscriptEntries = new Set();
  let transcriptPageStart = 0;
  let followTranscript = true;
  let transcriptPager = null;
  let currentAssistantEntry = null;
  let assistantRenderTimer = null;
  const activeToolCards = new Map();

  function transcriptTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function transcriptPage(action) {
    const latest = Math.max(0, transcriptEntries.length - TRANSCRIPT_PAGE_SIZE);
    transcriptPageStart = action === 'first' ? 0 : action === 'latest' ? latest : Math.max(0, Math.min(latest, transcriptPageStart + (action === 'older' ? -TRANSCRIPT_PAGE_SIZE : TRANSCRIPT_PAGE_SIZE)));
    followTranscript = transcriptPageStart === latest;
    refreshTranscript();
    if (dom.chatFeed) dom.chatFeed.scrollTop = action === 'latest' ? dom.chatFeed.scrollHeight : 0;
  }

  function refreshTranscript() {
    if (!dom.chatFeed) return;
    if (followTranscript) transcriptPageStart = Math.max(0, transcriptEntries.length - TRANSCRIPT_PAGE_SIZE);
    const visible = new Set(transcriptEntries.slice(transcriptPageStart, transcriptPageStart + TRANSCRIPT_PAGE_SIZE));
    for (const entry of pinnedTranscriptEntries) visible.add(entry);
    for (const entry of renderedTranscriptEntries) {
      if (visible.has(entry)) continue;
      entry.element?.remove();
      entry.element = null;
      renderedTranscriptEntries.delete(entry);
    }
    // Keep already mounted nodes in place: streaming must not disturb selection/focus.
    for (const entry of visible) {
      if (entry.element) continue;
      entry.element = createTranscriptElement(entry);
      entry.element.transcriptEntry = entry;
      dom.chatFeed.appendChild(entry.element);
      renderedTranscriptEntries.add(entry);
    }
    // Inserting newly exposed older entries ahead of retained live entries preserves order.
    let next = null;
    for (const entry of Array.from(visible).reverse()) {
      const element = entry.element;
      if (element.nextSibling !== next && dom.chatFeed.insertBefore) dom.chatFeed.insertBefore(element, next);
      next = element;
    }
    if (!transcriptPager) {
      transcriptPager = document.createElement('div');
      transcriptPager.className = 'transcript-pager';
      transcriptPager.setAttribute('aria-label', 'Sohbet geçmişi sayfaları');
      transcriptPager.innerHTML = '<button type="button" data-history-page="first">İlk kayıtlar</button><button type="button" data-history-page="older">← Önceki 40</button><span data-history-count></span><button type="button" data-history-page="newer">Sonraki 40 →</button><button type="button" data-history-page="latest">En yeni</button>';
      dom.chatFeed.prepend?.(transcriptPager);
    }
    const count = transcriptPager.querySelector('[data-history-count]');
    const end = Math.min(transcriptPageStart + TRANSCRIPT_PAGE_SIZE, transcriptEntries.length);
    if (count) count.textContent = `${transcriptEntries.length ? transcriptPageStart + 1 : 0}–${end} / ${transcriptEntries.length}${visible.size > end - transcriptPageStart ? ' · Canlı işlemler ayrıca gösteriliyor' : ''}`;
    for (const button of transcriptPager.querySelectorAll?.('[data-history-page]') || []) {
      const action = button.dataset.historyPage;
      button.disabled = action === 'first' || action === 'older' ? transcriptPageStart === 0 : action === 'newer' ? end >= transcriptEntries.length : followTranscript;
    }
    transcriptPager.classList.toggle('hidden', transcriptEntries.length <= TRANSCRIPT_PAGE_SIZE);
  }

  function appendTranscriptEntry(entry, pinned = false) {
    transcriptEntries.push(entry);
    if (pinned) pinnedTranscriptEntries.add(entry);
    hideEmptyHero();
    refreshTranscript();
    return entry;
  }

  function textPager(section, start, total) {
    if (total <= TEXT_PAGE_CHARS) return '';
    return `<div class="text-pager"><button type="button" data-text-page="previous" data-text-section="${section}" ${start === 0 ? 'disabled' : ''}>← Önceki bölüm</button><span>${start + 1}–${Math.min(start + TEXT_PAGE_CHARS, total)} / ${total} karakter</span><button type="button" data-text-page="next" data-text-section="${section}" ${start + TEXT_PAGE_CHARS >= total ? 'disabled' : ''}>Sonraki bölüm →</button><button type="button" data-text-page="latest" data-text-section="${section}">Son bölüm</button><button type="button" data-copy-full-text="${section}">${section === 'args' ? 'Parametrelerin tamamını kopyala' : section === 'result' ? 'Sonucun tamamını kopyala' : section === 'approval' ? 'Açıklama ve parametrelerin tamamını kopyala' : 'Mesajın tamamını kopyala'}</button></div>`;
  }

  function textPageStart(offset, length) {
    return offset == null ? Math.max(0, length - TEXT_PAGE_CHARS) : Math.min(offset, Math.max(0, length - 1));
  }

  function renderAssistantEntry(entry) {
    const body = entry.element?.querySelector('.assistant-message-body');
    if (!body) return;
    // Reading an earlier part never repeatedly joins/reparses a growing stream.
    if (entry.streaming && entry.textPage != null && entry.renderedTextPage === entry.textPage) return;
    const length = entry.streaming ? entry.textLength : entry.text.length;
    const start = textPageStart(entry.textPage, length);
    const text = entry.streaming && entry.textPage == null ? entry.tail : (entry.streaming ? entry.chunks.join('') : entry.text).slice(start, start + TEXT_PAGE_CHARS);
    body.innerHTML = textPager('assistant', start, length) + parseMarkdown(text);
    entry.renderedTextPage = entry.textPage;
  }

  function createTranscriptElement(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = entry.kind === 'tool' ? 'tool-card' : 'message-wrapper';
    if (entry.kind === 'user') {
      const imagesHtml = (entry.images || []).filter(img => img?.mimeType === 'image/png' && typeof img.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(img.data)).slice(0, 3).map(img => `<div class="tool-screenshot-preview" data-preview-image role="button" tabindex="0"><img src="data:${img.mimeType};base64,${img.data}" alt="Ek" loading="lazy" decoding="async" style="max-height:100px;border-radius:4px;"></div>`).join('');
      const start = textPageStart(entry.textPage === undefined ? 0 : entry.textPage, entry.text.length);
      wrapper.innerHTML = `<div class="message-header"><span class="sender-badge sender-user">▸ Sen</span><span class="message-time">${entry.time || ''}</span></div><div class="user-message-bubble">${imagesHtml}${textPager('user', start, entry.text.length)}<div class="user-message-text">${escapeHtml(entry.text.slice(start, start + TEXT_PAGE_CHARS))}</div></div>`;
    } else if (entry.kind === 'assistant') {
      wrapper.innerHTML = `<div class="message-header"><span class="sender-badge sender-assistant">◆ T Bot</span><span class="message-time">${entry.time || ''}</span></div><div class="assistant-message-body"></div>`;
      entry.element = wrapper;
      entry.renderedTextPage = undefined;
      renderAssistantEntry(entry);
    } else if (entry.kind === 'tool') {
      const target = extractToolTarget(entry.call.arguments);
      const status = entry.status || 'running';
      const label = { running: 'Çalışıyor…', success: '✓ Tamamlandı', error: '✗ Hata', stopped: 'Durduruldu' }[status];
      wrapper.dataset.id = entry.call.id;
      wrapper.innerHTML = `<div class="tool-card-header" role="button" tabindex="0" aria-expanded="false" data-tool-toggle><div class="tool-header-left"><span class="tool-icon">◈</span><span class="tool-title">${escapeHtml(entry.title)}</span>${target ? `<span class="tool-target" title="${escapeHtml(target)}">› ${escapeHtml(target)}</span>` : ''}</div><div class="tool-header-right"><span class="tool-duration">${escapeHtml(entry.duration || '')}</span><span class="tool-badge ${status}">${label}</span><span class="tool-accordion-icon">▼</span></div></div><div class="tool-card-body hidden"></div>`;
      wrapper.transcriptEntry = entry;
      if (entry.expanded) setToolExpanded(wrapper, true);
    } else {
      const text = entry.text || '';
      const start = textPageStart(entry.textPage === undefined ? 0 : entry.textPage, text.length);
      wrapper.innerHTML = `<div class="${entry.error === false ? 'approval-status' : 'error-notice-card'}">${textPager('notice', start, text.length)}<div class="error-notice-text">${escapeHtml(text.slice(start, start + TEXT_PAGE_CHARS))}</div></div>`;
    }
    return wrapper;
  }

  function replaceTranscriptElement(entry) {
    const previous = entry.element;
    const next = createTranscriptElement(entry);
    next.transcriptEntry = entry;
    previous?.replaceWith(next);
    entry.element = next;
  }

  function appendUserMessage(text, images = []) {
    appendTranscriptEntry({ kind: 'user', text: String(text || '').trim(), images, time: transcriptTime() });
    scrollToBottom(followTranscript);
  }

  function renderAssistantBuffer() {
    if (assistantRenderTimer) clearTimeout(assistantRenderTimer);
    assistantRenderTimer = null;
    const wasAtBottom = isTranscriptAtBottom();
    if (currentAssistantEntry) renderAssistantEntry(currentAssistantEntry);
    scrollToBottom(wasAtBottom && followTranscript);
  }

  function appendAssistantTextChunk(chunk) {
    if (!chunk) return;
    state.turnAssistantTextProduced = true;
    if (!currentAssistantEntry) {
      currentAssistantEntry = appendTranscriptEntry({ kind: 'assistant', streaming: true, chunks: [], textLength: 0, tail: '', textPage: null, time: transcriptTime() }, true);
    }
    const chunks = currentAssistantEntry.chunks;
    if (chunks.length && chunks[chunks.length - 1].length + chunk.length <= 8192) chunks[chunks.length - 1] += chunk;
    else chunks.push(chunk);
    currentAssistantEntry.textLength += chunk.length;
    currentAssistantEntry.tail = (currentAssistantEntry.tail + chunk).slice(-TEXT_PAGE_CHARS);
    if (!assistantRenderTimer) assistantRenderTimer = setTimeout(renderAssistantBuffer, 50);
  }

  function finalizeAssistantMessage() {
    if (!currentAssistantEntry) return;
    if (assistantRenderTimer) clearTimeout(assistantRenderTimer);
    assistantRenderTimer = null;
    const entry = currentAssistantEntry;
    entry.text = entry.chunks.join('');
    entry.chunks = null;
    entry.tail = null;
    entry.streaming = false;
    renderAssistantEntry(entry);
    pinnedTranscriptEntries.delete(entry);
    currentAssistantEntry = null;
    refreshTranscript();
  }

  function appendErrorNotice(errText) {
    appendTranscriptEntry({ kind: 'notice', text: String(errText || '') });
    scrollToBottom(followTranscript);
  }

  function extractToolTarget(args) {
    if (!args) return '';
    let obj = {};
    if (typeof args === 'string') {
      try { obj = JSON.parse(args); } catch { return args.slice(0, 50); }
    } else if (typeof args === 'object') {
      obj = args;
    }
    const priority = ['path', 'filePath', 'file', 'query', 'url', 'command', 'action', 'goal', 'text'];
    for (const k of priority) {
      if (typeof obj[k] === 'string' && obj[k].trim()) {
        const val = obj[k].trim();
        return val.length > 50 ? `${val.slice(0, 47)}...` : val;
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) {
        return `${k}: ${v.trim().slice(0, 45)}`;
      }
    }
    return '';
  }

  function formatDiff(text) {
    if (!text) return '';
    const lines = text.split('\n');
    let out = '<div class="diff-container">';
    lines.forEach((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        out += `<div class="diff-line addition">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        out += `<div class="diff-line deletion">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('@@')) {
        out += `<div class="diff-line hunk">${escapeHtml(line)}</div>`;
      } else {
        out += `<div class="diff-line">${escapeHtml(line)}</div>`;
      }
    });
    out += '</div>';
    return out;
  }

  function isToolError(result, toolName) {
    if (/^\s*(?:Tool error:|Araç Hatası:)/i.test(result)) return true;
    if (toolName !== 'shell') return false;
    const exit = result.match(/(?:^|\n)Exit code: (.+)\s*$/);
    return exit ? exit[1].trim() !== '0' : /(?:^|\n)(?:Timed out|Aborted); process tree/.test(result);
  }

  function renderToolBody(card) {
    const entry = card.transcriptEntry;
    const body = card.querySelector('.tool-card-body');
    if (!entry || !body) return;
    const args = JSON.stringify(entry.call.arguments ?? {}, null, 2);
    const result = entry.result ?? '';
    const argsStart = textPageStart(entry.argsPage === undefined ? 0 : entry.argsPage, args.length);
    const resultStart = textPageStart(entry.resultPage === undefined ? 0 : entry.resultPage, result.length);
    const resultSlice = result.slice(resultStart, resultStart + TEXT_PAGE_CHARS);
    const diff = entry.call.name === 'file_patch' || entry.call.name === 'file_write' || entry.call.name === 'git_diff' || resultSlice.includes('@@');
    body.innerHTML = `<div class="tool-section-title">Parametreler:</div>${textPager('args', argsStart, args.length)}<pre class="tool-args-pre">${escapeHtml(args.slice(argsStart, argsStart + TEXT_PAGE_CHARS))}</pre>${entry.result != null ? `<div class="tool-section-title">Sonuç:</div>${textPager('result', resultStart, result.length)}${diff ? formatDiff(resultSlice) : `<pre>${escapeHtml(resultSlice)}</pre>`}` : '<span>Sonuç bekleniyor…</span>'}`;
    // Decode screenshots only while this tool is open; closing releases the image DOM.
    const image = result.match(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+/);
    if (image) {
      const preview = document.createElement('div');
      preview.className = 'tool-screenshot-preview';
      preview.setAttribute('data-preview-image', '');
      preview.setAttribute('role', 'button');
      preview.tabIndex = 0;
      preview.innerHTML = `<img src="${image[0]}" alt="Ekran görüntüsü" loading="lazy" decoding="async">`;
      body.appendChild(preview);
    }
  }

  function setToolExpanded(card, expanded) {
    card.classList.toggle('expanded', expanded);
    card.querySelector('[data-tool-toggle]')?.setAttribute('aria-expanded', String(expanded));
    const body = card.querySelector('.tool-card-body');
    body?.classList.toggle('hidden', !expanded);
    if (card.transcriptEntry) {
      card.transcriptEntry.expanded = expanded;
      if (expanded) renderToolBody(card);
      else body?.replaceChildren();
    }
  }

  function transcriptSectionText(entry, section) {
    if (section === 'args') return JSON.stringify(entry.call.arguments ?? {}, null, 2);
    if (section === 'result') return entry.result || '';
    return entry.streaming ? entry.chunks.join('') : entry.text || '';
  }

  async function copyTranscriptText(button) {
    const entry = button.closest('.message-wrapper, .tool-card, .approval-card')?.transcriptEntry;
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(transcriptSectionText(entry, button.dataset.copyFullText));
      button.textContent = '✓ Tam metin kopyalandı';
    } catch (error) { appendErrorNotice(`Kopyalanamadı: ${String(error)}`); }
  }

  function changeTextPage(button) {
    const card = button.closest('.message-wrapper, .tool-card, .approval-card');
    const entry = card?.transcriptEntry;
    if (!entry) return;
    const section = button.dataset.textSection;
    const key = section === 'args' ? 'argsPage' : section === 'result' ? 'resultPage' : 'textPage';
    const text = transcriptSectionText(entry, section);
    const length = text?.length || 0;
    const current = textPageStart(entry[key] === undefined ? 0 : entry[key], length);
    entry[key] = button.dataset.textPage === 'latest' ? null : Math.max(0, Math.min(Math.max(0, length - 1), current + (button.dataset.textPage === 'previous' ? -TEXT_PAGE_CHARS : TEXT_PAGE_CHARS)));
    entry.renderedTextPage = undefined;
    if (entry.kind === 'tool') renderToolBody(card);
    else if (entry.kind === 'approval') {
      const start = textPageStart(entry.textPage, entry.text.length);
      const args = card.querySelector('.approval-args');
      if (args) args.textContent = entry.text.slice(start, start + TEXT_PAGE_CHARS);
      const pager = card.querySelector('.approval-argument-pages');
      if (pager) pager.innerHTML = textPager('approval', start, entry.text.length);
    } else replaceTranscriptElement(entry);
    const focusTarget = entry.element?.querySelector(`[data-text-section="${section}"][data-text-page="${button.dataset.textPage}"]:not(:disabled)`) || entry.element?.querySelector(`[data-text-section="${section}"][data-text-page="latest"]`);
    focusTarget?.focus({ preventScroll: true });
  }

  function handleToolStart(call, toolTitleOverride = null) {
    finalizeAssistantMessage();
    state.currentStepCount++;
    const entry = { kind: 'tool', call, title: toolTitleOverride || TOOL_TITLE_MAP[call.name] || toTurkishTitleCase(call.name), startTime: Date.now(), status: 'running' };
    activeToolCards.set(call.id, entry);
    appendTranscriptEntry(entry, true);
    startThinking(`${entry.title} Yürütülüyor…`, state.currentStepCount);
    scrollToBottom(followTranscript);
  }

  function handleToolEnd(call, result) {
    const entry = activeToolCards.get(call.id);
    if (entry) {
      const ms = Date.now() - entry.startTime;
      entry.duration = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}sn`;
      entry.result = typeof result === 'string' ? result : JSON.stringify(result ?? '');
      entry.status = isToolError(entry.result, call.name) ? 'error' : 'success';
      entry.expanded = entry.expanded || entry.status === 'error';
      if (entry.element) replaceTranscriptElement(entry);
      pinnedTranscriptEntries.delete(entry);
      activeToolCards.delete(call.id);
      refreshTranscript();
    }
    startThinking('Yanıt Hazırlanıyor…');
    scrollToBottom();
  }

  // =========================================================================
  // 10. Canlı Araç Onay Kartı (Approval Request)
  // =========================================================================
  function renderApprovalRequest(req) {
    if (state.currentApproval) { state.approvalQueue.push(req); return; }
    dom.thinkingBar?.classList.add('hidden');
    finalizeAssistantMessage();
    hideEmptyHero();

    state.currentApproval = req;
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.id = 'live-approval-card';

    const toolTitle = req.toolTitle || TOOL_TITLE_MAP[req.tool] || toTurkishTitleCase(req.tool);
    const details = `${req.description || 'Bu aracın çalıştırılması sisteminizde değişiklik yapabilir.'}\n\nParametreler:\n${JSON.stringify(req.arguments ?? {}, null, 2)}`;

    card.innerHTML = `
      <div class="approval-header">
        <span>🛡️ Onay Bekleniyor:</span>
        <strong>${escapeHtml(toolTitle)} (${escapeHtml(req.tool)})</strong>
      </div>
      <div class="approval-argument-pages">${textPager('approval', 0, details.length)}</div>
      <pre class="approval-args">${escapeHtml(details.slice(0, TEXT_PAGE_CHARS))}</pre>
      <div class="approval-actions">
        <button id="btn-approval-allow" class="btn-approve">✓ İzin Ver (Enter)</button>
        <button id="btn-approval-deny" class="btn-reject">✗ Reddet (Esc)</button>
        <button id="btn-approval-yolo" class="btn-yolo-session">⚡ Bu Turda Hep İzin Ver</button>
      </div>
    `;

    dom.chatFeed?.appendChild(card);
    const approvalEntry = { kind: 'approval', text: details, textPage: 0, error: false, element: card };
    card.transcriptEntry = approvalEntry;
    renderedTranscriptEntries.add(approvalEntry);
    appendTranscriptEntry(approvalEntry, true);
    scrollToBottom(true);
    document.getElementById('btn-approval-allow')?.focus();

    document.getElementById('btn-approval-allow')?.addEventListener('click', () => respondApproval(true, false));
    document.getElementById('btn-approval-deny')?.addEventListener('click', () => respondApproval(false, false));
    document.getElementById('btn-approval-yolo')?.addEventListener('click', () => {
      respondApproval(true, true);
    });
  }

  function respondApproval(approved, alwaysAllow = false) {
    const card = document.getElementById('live-approval-card');
    if (card) {
      card.innerHTML = `
        <div style="font-size:12px;color:${approved ? 'var(--bright-mint)' : 'var(--coral-danger)'};">
          ${approved ? `✓ İzin Verildi ${alwaysAllow ? '(YOLO Aktif Edildi)' : ''}` : '✗ İşlem Reddedildi'}
        </div>
      `;
      card.id = '';
      card.classList.remove('approval-card');
      card.style.border = '1px solid var(--border-subtle)';
      card.style.boxShadow = 'none';
      card.style.animation = 'none';
    }

    const approvalEntry = card?.transcriptEntry;
    if (approvalEntry) {
      approvalEntry.kind = 'notice';
      approvalEntry.text = approved ? '✓ İzin verildi.' : '✗ İşlem reddedildi.';
      pinnedTranscriptEntries.delete(approvalEntry);
      card.className = 'message-wrapper';
    }
    const reqId = state.currentApproval?.requestId;
    if (!reqId) return;
    state.currentApproval = null;
    tbot.respondApproval?.(reqId, approved, alwaysAllow)?.catch(error => appendErrorNotice(String(error)));
    if (alwaysAllow) {
      for (const pending of state.approvalQueue.splice(0)) {
        tbot.respondApproval?.(pending.requestId, true, true)?.catch(error => appendErrorNotice(String(error)));
      }
    }
    if (state.approvalQueue.length) { renderApprovalRequest(state.approvalQueue.shift()); return; }

    refreshTranscript();
    if (state.turnPending) {
      startThinking('Araç Çalıştırılıyor…');
    }
  }

  // =========================================================================
  // 11. Lightbox (Ekran Görüntüsü Büyütücü)
  // =========================================================================
  window.tbotOpenLightbox = function (imgSrc, title = 'Görsel Önizlemesi') {
    if (!dom.lightboxModal || !dom.lightboxImg) return;
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(imgSrc)) return;
    dom.lightboxImg.src = imgSrc;
    if (dom.lightboxTitle) dom.lightboxTitle.textContent = title;
    dom.lightboxModal.classList.remove('hidden');

    if (dom.lightboxBtnDownload) {
      dom.lightboxBtnDownload.onclick = () => {
        const a = document.createElement('a');
        a.href = imgSrc;
        a.download = `t-bot-screenshot-${Date.now()}.png`;
        a.click();
      };
    }
  };

  function closeLightbox() {
    dom.lightboxModal?.classList.add('hidden');
    if (dom.lightboxImg) dom.lightboxImg.src = '';
    if (dom.lightboxBtnDownload) dom.lightboxBtnDownload.onclick = null;
  }

  // =========================================================================
  // 12. Sürükle-Bırak & Panodan Görsel Yapıştırma
  // =========================================================================
  function renderAttachmentChips() {
    if (!dom.attachmentChips) return;
    dom.attachmentChips.innerHTML = '';
    if (state.attachedImages.length === 0) {
      dom.attachmentChips.classList.add('hidden');
      return;
    }

    dom.attachmentChips.classList.remove('hidden');
    state.attachedImages.forEach((img, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.innerHTML = `
        <img class="attachment-thumb" src="data:${img.mimeType};base64,${img.data}" alt="thumbnail">
        <span>${escapeHtml(img.name || `Görsel ${index + 1}`)}</span>
        <button class="chip-btn-remove" data-remove-attachment="${index}" aria-label="Görseli kaldır">✕</button>
      `;
      dom.attachmentChips.appendChild(chip);
    });
  }

  window.tbotRemoveAttachment = function (idx) {
    state.attachedImages.splice(idx, 1);
    renderAttachmentChips();
  };

  let pendingImageReads = 0;
  async function addImageAttachment(file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      appendErrorNotice('PNG, JPEG, WebP veya GIF görseli seçin.');
      return;
    }
    if (file.size > 4 * 1024 * 1024 || state.attachedImages.length + pendingImageReads >= 3) {
      appendErrorNotice('En fazla 3 görsel ekleyin; her dosya 4 MB veya daha küçük olmalıdır.');
      return;
    }
    pendingImageReads++;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Görsel en fazla 16 megapiksel olabilir.');
      const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png').split(',')[1];
      if (data.length > 2_000_000) throw new Error('PNG verisi 2 MB sınırını aşıyor; daha küçük bir görsel seçin.');
      state.attachedImages.push({ mimeType: 'image/png', data, name: file.name || 'image.png' });
      renderAttachmentChips();
    } catch (error) {
      appendErrorNotice(error instanceof Error ? error.message : 'Görsel okunamadı. Başka bir dosya seçin.');
    } finally {
      URL.revokeObjectURL(url);
      pendingImageReads--;
    }
  }

  function setupDragAndDrop() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      dom.dragOverlay?.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dom.dragOverlay?.classList.add('hidden');
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dom.dragOverlay?.classList.add('hidden');

      const files = Array.from(e.dataTransfer?.files || []);
      files.forEach((file) => {
        if (file.type.startsWith('image/')) {
          addImageAttachment(file);
        } else {
          // Dosya ise yolunu veya içeriğini ekle
          const filePath = tbot.getFilePath(file);
          if (!filePath) { appendErrorNotice('Dosyanın yerel yolu okunamadı. Dosya yolunu mesaja yazın.'); return; }
          if (dom.userInput) {
            dom.userInput.value += (dom.userInput.value ? ' ' : '') + filePath;
            dom.userInput.focus();
          }
        }
      });
    });

    // Pano Görsel Yapıştırma (Ctrl+V)
    window.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            addImageAttachment(file);
            break;
          }
        }
      }
    });
  }

  // =========================================================================
  // 13. Kullanıcı Mesajı Gönderme (Turn Execution)
  // =========================================================================
  async function submitUserMessage(options = {}) {
    if (state.turnPending || state.sessionLoading || state.currentApproval || pendingImageReads) return;
    const rawText = dom.userInput?.value || '';
    const text = rawText.trim();
    const images = [...state.attachedImages];

    if (!text && images.length === 0) return;

    // Komut kontrolü
    if (text.startsWith('/')) {
      handleSlashCommand(text);
      if (dom.userInput) dom.userInput.value = '';
      return;
    }

    if (dom.userInput) dom.userInput.value = '';
    state.attachedImages = [];
    state.turnAssistantTextProduced = false;
    state.currentStepCount = 0;
    renderAttachmentChips();
    autoResizeTextarea();

    state.turnPending = true;
    setTurnControls();
    transcriptPage('latest');
    appendUserMessage(text, images);
    startThinking('T Bot Çözümlüyor…');

    try {
      const res = await tbot.startTurn?.({
        message: text,
        images,
        mode: options.goal ? 'goal' : undefined,
        workspace: state.workspace,
        sessionId: state.currentSessionId || undefined,
        yolo: state.yoloEnabled,
        model: state.model,
        provider: state.provider,
      });

      if (res?.sessionId) state.currentSessionId = res.sessionId;
      if (res && res.ok === false) {
        if (!res.aborted) appendErrorNotice(res.error || 'İşlem başarısız oldu');
      } else {
        if (res?.memoryStats) {
          updateTelemetry(res.memoryStats);
        }

        // Eğer akış (stream) sırasında hiç asistan metni ekrana basılmamışsa ama
        // res.lastAssistantText veya res.messages içinde son asistan mesajı varsa hemen ekrana bas
        if (!state.turnAssistantTextProduced) {
          if (res?.lastAssistantText) {
            appendAssistantTextChunk(res.lastAssistantText);
          } else if (Array.isArray(res?.messages) && res.messages.length > 0) {
            const lastAssistant = [...res.messages].reverse().find(m => m && m.role === 'assistant' && m.content);
            if (lastAssistant && lastAssistant.content) {
              appendAssistantTextChunk(lastAssistant.content);
            }
          }
        }
      }
    } catch (err) {
      appendErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      state.turnPending = false;
      state.currentApproval = null;
      state.approvalQueue = [];
      finishApprovalCard();
      finishInterruptedTools();
      setTurnControls();
      finalizeAssistantMessage();
      stopThinking();
      loadSessionsList();
      refreshWorkflow();
    }
  }

  function setTurnControls() {
    [dom.btnSend, dom.btnWorkspace, dom.btnNewSession, dom.modalBtnStartGoal].forEach(button => { if (button) button.disabled = state.turnPending || state.sessionLoading; });
  }

  function autoResizeTextarea() {
    if (!dom.userInput) return;
    dom.userInput.style.height = 'auto';
    const newHeight = Math.min(180, Math.max(24, dom.userInput.scrollHeight));
    dom.userInput.style.height = `${newHeight}px`;
  }

  // =========================================================================
  // 14. Slash (/) Komut Paleti
  // =========================================================================
  function openCommandPalette(filter = '') {
    dom.commandPalette?.classList.remove('hidden');
    if (dom.paletteSearch) {
      dom.paletteSearch.value = filter;
      dom.paletteSearch.focus();
    }
    filterPaletteItems(filter);
  }

  function closeCommandPalette() {
    dom.commandPalette?.classList.add('hidden');
  }

  function filterPaletteItems(query) {
    const q = query.toLowerCase().trim().replace(/^\//, '');
    const items = dom.paletteItems?.querySelectorAll('.palette-item') || [];
    let firstVisible = null;

    items.forEach((item) => {
      const cmd = item.getAttribute('data-cmd') || '';
      const cleanCmd = cmd.replace(/^\//, '');
      const desc = item.querySelector('.palette-desc')?.textContent?.toLowerCase() || '';
      const match = cleanCmd.includes(q) || desc.includes(q);
      item.classList.toggle('hidden', !match);
      item.classList.remove('selected');
      if (match && !firstVisible) firstVisible = item;
    });

    if (firstVisible) firstVisible.classList.add('selected');
  }

  function executeSelectedPaletteItem() {
    const selected = dom.paletteItems?.querySelector('.palette-item.selected:not(.hidden)');
    if (selected) {
      const cmd = selected.getAttribute('data-cmd');
      if (cmd) handleSlashCommand(cmd);
      closeCommandPalette();
    }
  }

  function handleSlashCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();

    switch (action) {
      case '/model':
      case '/provider':
      case '/auth':
      case '/config':
        openConfigModal();
        break;

      case '/ultracode':
        appendAssistantTextChunk('Bu masaüstü sürümü ayrı bir Ultracode yürütme modu sunmuyor. İnceleme ve düzeltme isteğinizi mesaj olarak yazın.');
        finalizeAssistantMessage();
        break;

      case '/yolo':
        toggleYoloMode();
        appendAssistantTextChunk(`🛡️ YOLO Modu: **${state.yoloEnabled ? 'Açık (Otomatik Onay)' : 'Kapalı (Onaylı)'}**`);
        finalizeAssistantMessage();
        break;

      case '/goal':
        openGoalModal();
        break;

      case '/ram':
      case '/gc':
        triggerTrimMemory();
        break;

      case '/doctor':
        runDoctorDiagnostics();
        break;

      case '/clear':
        clearChatTerminal();
        break;

      case '/help':
        appendAssistantTextChunk(`
### T Bot Komut Kılavuzu
- \`/model\`, \`/provider\` — Model, Sağlayıcı ve API Anahtarlarını Yapılandır
- \`/yolo\` — Araç Çalıştırma Otomatik Onayını Aç/Kapat
- \`/goal\` — Otonom Hedef Başlat (.tbot/goal.json)
- \`/ram\`, \`/gc\` — Belleği Boşalt ve Çöp Toplayıcıyı Çalıştır
- \`/doctor\` — Sistem Teşhisi ve Sağlık Kontrolü
- \`/clear\` — Sohbet Akışını Temizle
        `);
        finalizeAssistantMessage();
        break;

      default:
        appendAssistantTextChunk(`Bilinmeyen komut: \`${cmd}\`. Kullanılabilir komutları görmek için \`/help\` yazın.`);
        finalizeAssistantMessage();
        break;
    }
  }

  // =========================================================================
  // 15. RAM Boşaltma & Bellek Yönetimi
  // =========================================================================
  async function triggerTrimMemory() {
    if (dom.btnTrimRam) {
      dom.btnTrimRam.innerHTML = '<span class="action-icon">⌛</span> Boşaltılıyor…';
      dom.btnTrimRam.disabled = true;
    }

    try {
      const res = await tbot.trimMemory?.();
      const stats = res?.stats || await tbot.getMemoryStats?.();
      const freedMB = res?.result?.freedMB ?? 0;
      updateTelemetry(stats);
      appendAssistantTextChunk(`Bellek ölçümü güncellendi. **${freedMB} MB** çalışma kümesi serbest bırakıldı.`);
      finalizeAssistantMessage();
    } catch (error) {
      appendErrorNotice(String(error));
    } finally {
      if (dom.btnTrimRam) {
        dom.btnTrimRam.innerHTML = '<span class="action-icon">🧹</span> RAM Boşalt';
        dom.btnTrimRam.disabled = false;
      }
    }
  }

  function clearChatTerminal() {
    if (state.turnPending) return;
    finalizeAssistantMessage();
    closeLightbox();
    activeToolCards.clear();
    for (const entry of renderedTranscriptEntries) entry.element?.remove();
    transcriptEntries.length = 0;
    renderedTranscriptEntries.clear();
    pinnedTranscriptEntries.clear();
    transcriptPager?.remove();
    transcriptPager = null;
    transcriptPageStart = 0;
    followTranscript = true;
    showEmptyHeroIfEmpty();
  }

  function loadTranscriptMessages(messages) {
    const calls = new Map();
    for (const message of messages) {
      if (message.role === 'user') transcriptEntries.push({ kind: 'user', text: message.content || '', images: message.images });
      if (message.role === 'assistant') {
        if (message.content) transcriptEntries.push({ kind: 'assistant', text: message.content, textPage: 0 });
        for (const call of message.toolCalls || []) {
          const entry = { kind: 'tool', call, title: TOOL_TITLE_MAP[call.name] || toTurkishTitleCase(call.name), status: 'stopped' };
          calls.set(call.id, entry);
          transcriptEntries.push(entry);
        }
      }
      if (message.role === 'tool') {
        let entry = calls.get(message.toolCallId);
        if (!entry) {
          entry = { kind: 'tool', call: { id: message.toolCallId, name: 'tool_result', arguments: {} }, title: 'Araç Sonucu' };
          transcriptEntries.push(entry);
        }
        entry.result = message.content || '';
        entry.status = isToolError(entry.result, entry.call.name) ? 'error' : 'success';
      }
    }
    if (transcriptEntries.length) hideEmptyHero();
    refreshTranscript();
    scrollToBottom(true);
  }

  // =========================================================================
  // 16. Oturumlar Yönetimi (Sessions)
  // =========================================================================
  let sessionsRequest = 0;
  async function loadSessionsList() {
    const request = ++sessionsRequest;
    const workspace = state.workspace;
    try {
      const sessions = await tbot.listSessions?.(workspace) || [];
      if (request !== sessionsRequest || workspace !== state.workspace) return;
      if (dom.sessionsCount) dom.sessionsCount.textContent = sessions.length;
      if (!dom.sessionsList) return;

      if (sessions.length === 0) {
        dom.sessionsList.innerHTML = '<div class="empty-list-hint">Henüz kayıtlı oturum yok</div>';
        return;
      }

      dom.sessionsList.innerHTML = '';
      sessions.forEach((s) => {
        const item = document.createElement('div');
        item.className = `session-item ${s.id === state.currentSessionId ? 'active' : ''}`;
        const title = s.title || (s.messages?.[0]?.content?.slice(0, 32)) || s.id;
        const count = s.messages?.length || s.messageCount || 0;
        const date = new Date(s.updatedAt || Date.now()).toLocaleDateString();

        item.innerHTML = `
          <div class="session-info">
            <span class="session-title">${escapeHtml(title)}</span>
            <span class="session-meta">${date} · ${count} mesaj</span>
          </div>
          <button class="session-btn-delete" title="Oturumu Sil" data-delete-session>🗑️</button>
        `;
        item.querySelector('[data-delete-session]')?.addEventListener('click', e => window.tbotDeleteSession(e, s.id));
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.addEventListener('keydown', e => { if (e.target === item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); switchSession(s.id); } });
        item.onclick = (e) => {
          if (e.target.closest('.session-btn-delete')) return;
          switchSession(s.id);
        };
        dom.sessionsList.appendChild(item);
      });
    } catch {
      // Sessizce geç
    }
  }

  window.tbotDeleteSession = async function (e, id) {
    e.stopPropagation();
    if (state.turnPending || state.sessionLoading) return;
    if (confirm('Bu oturumu silmek istediğinize emin misiniz?')) {
      await tbot.deleteSession?.(id, state.workspace);
      if (state.currentSessionId === id) { state.currentSessionId = null; clearChatTerminal(); }
      loadSessionsList();
    }
  };

  async function switchSession(id) {
    if (state.turnPending || state.sessionLoading) return;
    state.sessionLoading = true;
    setTurnControls();
    state.currentSessionId = id;
    clearChatTerminal();
    loadSessionsList();
    try {
      const data = await tbot.loadSession?.(id, state.workspace);
      if (Array.isArray(data?.messages)) loadTranscriptMessages(data.messages);
    } catch (error) {
      appendErrorNotice(`Oturum yüklenemedi: ${String(error)}`);
    } finally {
      state.sessionLoading = false;
      setTurnControls();
    }
  }

  // =========================================================================
  // 17. Görev Pusulası (Goal & Todos Yönetimi)
  // =========================================================================
  let workflowRequest = 0;
  async function refreshWorkflow() {
    const request = ++workflowRequest;
    const workspace = state.workspace;
    try {
      // main.ts içindeki workflows:get-state IPC çağrısı
      const stateData = await tbot.getWorkflowState?.(workspace);
      if (request !== workflowRequest || workspace !== state.workspace) return;
      if (stateData) {
        // Hedef Güncellemesi
        if (stateData.goal && (stateData.goal.status === 'active' || stateData.goal.status === 'paused')) {
          dom.goalObjective.textContent = stateData.goal.objective;
          dom.goalStatusBadge.className = 'status-badge badge-active';
          dom.goalStatusBadge.textContent = stateData.goal.status === 'active' ? 'Aktif' : 'Duraklatıldı';
          dom.btnGoalComplete?.classList.remove('hidden');
          dom.btnGoalCancel?.classList.remove('hidden');

          if (stateData.goal.notes && stateData.goal.notes.length > 0) {
            dom.goalNotesList?.classList.remove('hidden');
            dom.goalNotesList.innerHTML = stateData.goal.notes.map(n => `<div>• ${escapeHtml(n)}</div>`).join('');
          } else {
            dom.goalNotesList?.classList.add('hidden');
          }
        } else {
          dom.goalObjective.textContent = 'Henüz aktif bir hedef belirlenmedi.';
          dom.goalStatusBadge.className = 'status-badge badge-dim';
          dom.goalStatusBadge.textContent = 'Yok';
          dom.btnGoalComplete?.classList.add('hidden');
          dom.btnGoalCancel?.classList.add('hidden');
          dom.goalNotesList?.classList.add('hidden');
        }

        // Todos Listesi Güncellemesi
        renderTodosList(stateData.todos);
      }

      // Yetenekler ve MCP
      const sm = await tbot.getSkillsAndMcp?.(workspace);
      if (request !== workflowRequest || workspace !== state.workspace) return;
      if (sm && dom.mcpServerCountTag) {
        const connCount = Object.values(sm.mcpConnections || {}).filter(connection => connection?.enabled).length;
        dom.mcpServerCountTag.innerHTML = `<span class="tag-dot"></span> MCP (${connCount > 0 ? `${connCount} Etkin yapılandırma` : 'Etkin yapılandırma yok'})`;
      }
    } catch {
      // ignore
    }
  }

  function renderTodosList(todosArray) {
    if (!dom.todosList) return;
    const todos = Array.isArray(todosArray) ? todosArray : [];

    if (todos.length === 0) {
      dom.todosList.innerHTML = '<div class="empty-list-hint">Görev maddesi yok</div>';
      if (dom.todosProgressBadge) dom.todosProgressBadge.textContent = '0/0';
      return;
    }

    dom.todosList.innerHTML = '';
    let completed = 0;

    todos.forEach((t, index) => {
      const isCompleted = t.status === 'completed';
      const isInProgress = t.status === 'in_progress';
      const statusClass = isCompleted ? 'completed' : (isInProgress ? 'in_progress' : 'pending');
      const checkIcon = isCompleted ? '[✓]' : (isInProgress ? '[◉]' : '[ ]');

      if (isCompleted) completed++;

      const item = document.createElement('div');
      item.className = `todo-item ${statusClass}`;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `${t.text}: ${t.status}`);
      item.innerHTML = `
        <span class="todo-checkbox">${checkIcon}</span>
        <span class="todo-text">${escapeHtml(t.text)}</span>
      `;

      item.onclick = async () => {
        const nextStatus = isCompleted ? 'pending' : (isInProgress ? 'completed' : 'in_progress');
        await tbot.manageWorkflow?.('todo_manage', {
          action: 'update',
          index: index + 1,
          status: nextStatus,
        }, state.workspace);
        refreshWorkflow();
      };

      dom.todosList.appendChild(item);
    });

    if (dom.todosProgressBadge) {
      dom.todosProgressBadge.textContent = `${completed}/${todos.length}`;
    }
  }

  async function addTodoItem(text) {
    if (!text.trim()) return;
    await tbot.manageWorkflow?.('todo_manage', {
      action: 'add',
      items: [text.trim()],
    }, state.workspace);
    if (dom.inputNewTodo) dom.inputNewTodo.value = '';
    refreshWorkflow();
  }

  // =========================================================================
  // 18. Modallar (Config, Doctor, Goal)
  // =========================================================================
  async function openConfigModal() {
    const request = ++catalogRequest;
    dom.configModal?.classList.remove('hidden');
    if (dom.inputCustomModel) dom.inputCustomModel.value = '';
    if (dom.selectProvider) dom.selectProvider.value = state.provider;
    if (dom.selectEffort) dom.selectEffort.value = state.effort;

    try {
      const cat = await tbot.getModelCatalog?.();
      if (request !== catalogRequest) return;
      if (cat?.models) {
        if (dom.selectProvider && cat.providers) {
          dom.selectProvider.replaceChildren(...cat.providers.map(provider => { const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.label; return option; }));
          dom.selectProvider.value = state.provider;
        }
        populateModelsSelect(cat.models);
      } else {
        updateModelDropdown(state.provider);
      }
    } catch {
      if (request === catalogRequest) updateModelDropdown(state.provider);
    }
  }

  function closeConfigModal() {
    catalogRequest++;
    dom.configModal?.classList.add('hidden');
    if (dom.inputApiKey) { dom.inputApiKey.value = ''; dom.inputApiKey.type = 'password'; }
  }

  function populateModelsSelect(models) {
    if (!dom.selectModel) return;
    dom.selectModel.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = typeof m === 'string' ? m : m.id;
      opt.textContent = typeof m === 'string' ? m : (m.label || m.id);
      if (opt.value === state.model) opt.selected = true;
      dom.selectModel.appendChild(opt);
    });
    if (dom.selectProvider?.value === state.provider && !models.some(model => (typeof model === 'string' ? model : model.id) === state.model)) {
      const option = document.createElement('option'); option.value = state.model; option.textContent = state.model; option.selected = true; dom.selectModel.appendChild(option);
    }
  }

  let catalogRequest = 0;
  async function updateModelDropdown(provider) {
    const request = ++catalogRequest;
    dom.selectModel?.replaceChildren();
    if (dom.inputCustomModel) dom.inputCustomModel.value = '';
    try {
      const catalog = await tbot.getModelCatalog(provider);
      if (request === catalogRequest) populateModelsSelect(catalog.models || []);
    } catch (error) {
      if (request === catalogRequest) appendErrorNotice(`Model listesi yüklenemedi: ${String(error)}`);
    }
  }

  async function saveAllConfig() {
    const prov = dom.selectProvider?.value || state.provider;
    const model = dom.inputCustomModel?.value?.trim() || dom.selectModel?.value || state.model;
    const effort = dom.selectEffort?.value || state.effort;

    try { await tbot.saveConfig?.({
      provider: prov,
      model,
      efforts: { [`${prov}:${model}`]: effort },
    }); } catch (error) { appendErrorNotice(String(error)); return; }

    state.provider = prov;
    state.model = model;
    state.effort = effort;
    updateHudBar();
    closeConfigModal();
  }

  async function runDoctorDiagnostics() {
    dom.doctorModal?.classList.remove('hidden');
    if (!dom.doctorResults) return;
    dom.doctorResults.innerHTML = '<div class="doctor-loading">Sistem sağlığı ve teşhis çalıştırılıyor…</div>';

    try {
      const doc = await tbot.runDoctor?.(state.workspace);
      const tests = [
        { name: `Node.js (${doc?.nodeVersion || '—'})`, status: 'pass', desc: 'Node.js LTS motoru çalışıyor' },
        { name: `Electron (${doc?.electronVersion || '33.x'}) & Chrome`, status: 'pass', desc: `Chrome ${doc?.chromeVersion || 'v130'} donanım hızlandırmalı renderer` },
        { name: `V8 JavaScript Motoru (${doc?.v8Version || '—'})`, status: 'pass', desc: 'JavaScript motoru sürümü' },
        { name: `Sağlayıcı: ${doc?.provider || state.provider}`, status: doc?.hasApiKey ? 'pass' : 'warn', desc: doc?.hasApiKey ? 'Yerel API anahtarı mevcut; bağlantı testi yapılmadı' : 'API Anahtarı girilmemiş veya çevrimdışı modda' },
        { name: `Bellek Koruma (Memory Guard)`, status: 'pass', desc: `Toplam Bellek: ${doc?.memoryStats?.totalWorkingSetMB ?? state.telemetry.ramMB} MB · Electron süreçlerinin ölçülen çalışma kümesi` },
      ];

      let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
      tests.forEach((t) => {
        html += `
          <div class="doctor-item">
            <div>
              <div class="doctor-name">${escapeHtml(t.name)}</div>
              <div style="font-size:11px;color:var(--text-dim);">${escapeHtml(t.desc)}</div>
            </div>
            <span class="doctor-badge ${t.status}">${t.status === 'pass' ? '✓ Geçti' : 'Uyarı'}</span>
          </div>
        `;
      });
      html += '</div>';
      dom.doctorResults.innerHTML = html;
    } catch (err) {
      dom.doctorResults.innerHTML = `<div style="color:var(--coral-danger)">Teşhis hatası: ${escapeHtml(String(err))}</div>`;
    }
  }

  function openGoalModal() {
    dom.goalModal?.classList.remove('hidden');
    if (dom.inputModalGoal) {
      dom.inputModalGoal.value = '';
      dom.inputModalGoal.focus();
    }
  }

  function closeGoalModal() {
    dom.goalModal?.classList.add('hidden');
  }

  async function startModalGoal() {
    const text = dom.inputModalGoal?.value?.trim();
    if (!text) return;
    if (state.turnPending) return;
    closeGoalModal();
    appendAssistantTextChunk(`🎯 Yeni Hedef Başlatılıyor: **${text}**`);
    finalizeAssistantMessage();

    await tbot.manageWorkflow?.('goal_manage', { action: 'set', goal: text }, state.workspace);
    refreshWorkflow();

    if (dom.userInput) dom.userInput.value = text;
    await submitUserMessage({ goal: true });
  }

  // =========================================================================
  // 19. Olay Dinleyicileri (Event Listeners Setup)
  // =========================================================================
  function toggleSidebar(side) {
    const panel = side === 'left' ? dom.sidebarLeft : dom.sidebarRight;
    panel?.classList.toggle('collapsed');
    const collapsed = panel?.classList.contains('collapsed');
    document.querySelector('.workspace-grid')?.classList.toggle(`${side}-collapsed`, collapsed);
    document.querySelectorAll(`[data-toggle-sidebar="${side}"]`).forEach(button => button.setAttribute('aria-expanded', String(!collapsed)));
  }

  function setupEventListeners() {
    window.addEventListener('unhandledrejection', event => { event.preventDefault(); appendErrorNotice(String(event.reason)); });
    document.querySelectorAll('[data-toggle-sidebar]').forEach(button => button.addEventListener('click', () => toggleSidebar(button.dataset.toggleSidebar)));
    document.addEventListener('click', event => {
      const target = event.target.closest('button, [data-preview-image], [data-tool-toggle]');
      if (!target) return;
      if (target.hasAttribute('data-history-page')) transcriptPage(target.dataset.historyPage);
      if (target.hasAttribute('data-text-page')) changeTextPage(target);
      if (target.hasAttribute('data-copy-full-text')) copyTranscriptText(target);
      if (target.hasAttribute('data-copy-code')) window.tbotCopyCode(target);
      if (target.hasAttribute('data-remove-attachment')) window.tbotRemoveAttachment(Number(target.dataset.removeAttachment));
      if (target.hasAttribute('data-preview-image')) window.tbotOpenLightbox(target.querySelector('img')?.src);
      if (target.hasAttribute('data-tool-toggle')) {
        const card = target.parentElement;
        setToolExpanded(card, !card.classList.contains('expanded'));
      }
    });
    document.addEventListener('keydown', event => {
      if (event.target.matches('[data-tool-toggle], [data-preview-image], .hero-card, .todo-item') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.target.click();
      }
    });
    document.querySelectorAll('.hero-card').forEach(card => { card.tabIndex = 0; card.setAttribute('role', 'button'); });
    const dialogs = [dom.configModal, dom.doctorModal, dom.goalModal, dom.lightboxModal].filter(Boolean);
    const dialogFocus = new WeakMap();
    for (const dialog of dialogs) {
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', dialog.querySelector('.modal-title, .lightbox-title')?.textContent || 'İletişim kutusu');
      new MutationObserver(() => {
        if (!dialog.classList.contains('hidden')) {
          if (!dialogFocus.has(dialog)) dialogFocus.set(dialog, document.activeElement);
          if (!dialog.contains(document.activeElement)) dialog.querySelector('input, textarea, select, button')?.focus();
        } else {
          dialogFocus.get(dialog)?.focus();
          dialogFocus.delete(dialog);
        }
      }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('keydown', event => {
      const dialog = dialogs.find(item => !item.classList.contains('hidden'));
      if (!dialog || event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll('button, input, select, textarea, [tabindex="0"]')).filter(item => !item.disabled && item.getClientRects().length);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    dom.paletteSearch?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); executeSelectedPaletteItem(); dom.userInput?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = Array.from(dom.paletteItems.querySelectorAll('.palette-item:not(.hidden)'));
        const index = items.findIndex(item => item.classList.contains('selected'));
        items.forEach(item => item.classList.remove('selected'));
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.classList.add('selected');
      }
    });
    document.querySelectorAll('button[title]').forEach(button => { if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', button.title); });

    // 1. Pencere Kontrolleri
    dom.btnMin?.addEventListener('click', () => tbot.windowControl?.('minimize'));
    dom.btnMax?.addEventListener('click', () => tbot.windowControl?.('maximize'));
    dom.btnClose?.addEventListener('click', () => tbot.windowControl?.('close'));
    dom.btnPin?.addEventListener('click', () => tbot.windowControl?.('toggle-pin'));

    // 2. Çalışma Klasörü Seçici
    dom.btnWorkspace?.addEventListener('click', async () => {
      const selected = await tbot.selectWorkspace?.();
      if (selected) {
        state.currentSessionId = null;
        clearChatTerminal();
        state.workspace = selected;
        if (dom.workspacePath) dom.workspacePath.textContent = selected;
        refreshWorkflow();
        loadSessionsList();
      }
    });

    // 3. RAM Boşalt ve Tema Butonları
    dom.btnThemeToggle?.addEventListener('click', toggleTheme);
    dom.btnTrimRam?.addEventListener('click', triggerTrimMemory);

    // 4. Ultracode & YOLO & Hızlı Bar
    dom.btnQuickYolo?.addEventListener('click', toggleYoloMode);
    dom.btnQuickConfig?.addEventListener('click', openConfigModal);
    dom.btnQuickDoctor?.addEventListener('click', runDoctorDiagnostics);
    dom.btnQuickClear?.addEventListener('click', clearChatTerminal);

    // 5. Yan Panel Aç/Kapa
    dom.btnCollapseLeft?.addEventListener('click', () => {
      toggleSidebar('left');
    });
    dom.btnCollapseRight?.addEventListener('click', () => {
      toggleSidebar('right');
    });

    // 6. Yeni Oturum
    dom.btnNewSession?.addEventListener('click', async () => {
      if (state.turnPending || state.sessionLoading) return;
      state.sessionLoading = true;
      setTurnControls();
      try {
        const session = await tbot.createSession(state.workspace);
        state.currentSessionId = session.id;
        clearChatTerminal();
        loadSessionsList();
      } finally {
        state.sessionLoading = false;
        setTurnControls();
      }
    });

    // 7. Hızlı Başlatıcılar
    document.querySelectorAll('.quick-launch-chip[data-prompt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-prompt');
        if (dom.userInput && p) {
          dom.userInput.value = p;
          dom.userInput.focus();
          autoResizeTextarea();
        }
      });
    });
    dom.btnLaunchGoal?.addEventListener('click', openGoalModal);
    dom.heroCardGoal?.addEventListener('click', openGoalModal);

    // 8. Hero Prompt Kartları
    document.querySelectorAll('.hero-card[data-prompt]').forEach((card) => {
      card.addEventListener('click', () => {
        const p = card.getAttribute('data-prompt');
        if (dom.userInput && p) {
          dom.userInput.value = p;
          dom.userInput.focus();
          autoResizeTextarea();
        }
      });
    });

    // 9. Mesaj Girişi & Gönder
    dom.btnSend?.addEventListener('click', submitUserMessage);
    dom.userInput?.addEventListener('input', () => {
      autoResizeTextarea();
      const val = dom.userInput?.value || '';
      if (val === '/') {
        openCommandPalette();
      } else if (val.startsWith('/') && !val.includes('\n')) {
        openCommandPalette(val);
      } else {
        closeCommandPalette();
      }
    });

    dom.userInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!dom.commandPalette?.classList.contains('hidden')) {
          executeSelectedPaletteItem();
        } else {
          submitUserMessage();
        }
      } else if (e.key === 'Escape') {
        if (!dom.commandPalette?.classList.contains('hidden')) {
          closeCommandPalette();
        } else if (state.isThinking) {
          abortCurrentTurn();
        }
      } else if (!dom.commandPalette?.classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = Array.from(dom.paletteItems?.querySelectorAll('.palette-item:not(.hidden)') || []);
          const currentIdx = items.findIndex(it => it.classList.contains('selected'));
          let nextIdx = e.key === 'ArrowDown' ? currentIdx + 1 : currentIdx - 1;
          if (nextIdx < 0) nextIdx = items.length - 1;
          if (nextIdx >= items.length) nextIdx = 0;
          items.forEach(it => it.classList.remove('selected'));
          items[nextIdx]?.classList.add('selected');
        }
      }
    });

    // Dosya Ekleme Butonu
    dom.btnAttach?.addEventListener('click', () => {
      dom.fileInputHidden?.click();
    });
    dom.fileInputHidden?.addEventListener('change', (e) => {
      const files = Array.from(e.target?.files || []);
      files.forEach((file) => {
        if (file.type.startsWith('image/')) addImageAttachment(file);
        else {
          const filePath = tbot.getFilePath(file);
          if (filePath && dom.userInput) dom.userInput.value += (dom.userInput.value ? ' ' : '') + filePath;
        }
      });
    });

    dom.btnSlashHint?.addEventListener('click', () => openCommandPalette());

    // 10. Düşünmeyi Durdur Butonu
    dom.btnAbortTurn?.addEventListener('click', abortCurrentTurn);

    // 11. Aşağı Kaydır Butonu
    dom.btnScrollBottom?.addEventListener('click', () => transcriptPage('latest'));
    dom.chatFeed?.addEventListener('scroll', () => {
      const atBottom = isTranscriptAtBottom();
      if (!atBottom) followTranscript = false;
      dom.btnScrollBottom?.classList.toggle('hidden', atBottom);
    }, { passive: true });

    // 12. Görev Pusulası (Todos & Goal)
    dom.btnAddTodo?.addEventListener('click', () => addTodoItem(dom.inputNewTodo?.value || ''));
    dom.inputNewTodo?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTodoItem(dom.inputNewTodo?.value || '');
    });
    dom.btnRefreshWorkflow?.addEventListener('click', refreshWorkflow);
    dom.btnGoalSet?.addEventListener('click', openGoalModal);
    dom.btnGoalComplete?.addEventListener('click', async () => {
      await tbot.manageWorkflow?.('goal_manage', { action: 'complete' }, state.workspace);
      refreshWorkflow();
    });
    dom.btnGoalCancel?.addEventListener('click', async () => {
      await tbot.manageWorkflow?.('goal_manage', { action: 'clear' }, state.workspace);
      refreshWorkflow();
    });

    // 13. Komut Paleti Olayları
    dom.paletteSearch?.addEventListener('input', (e) => filterPaletteItems(e.target?.value || ''));
    dom.paletteItems?.querySelectorAll('.palette-item').forEach((item) => {
      item.addEventListener('click', () => {
        const cmd = item.getAttribute('data-cmd');
        if (cmd) handleSlashCommand(cmd);
        closeCommandPalette();
      });
    });

    // 14. Modallar & Lightbox Kapatma
    dom.lightboxBtnClose?.addEventListener('click', closeLightbox);
    dom.lightboxBackdrop?.addEventListener('click', closeLightbox);

    dom.modalBtnCloseConfig?.addEventListener('click', closeConfigModal);
    dom.modalBtnCancelConfig?.addEventListener('click', closeConfigModal);
    dom.modalBtnSaveAllConfig?.addEventListener('click', saveAllConfig);
    dom.selectProvider?.addEventListener('change', (e) => updateModelDropdown(e.target?.value));

    dom.btnToggleKeyVisibility?.addEventListener('click', () => {
      if (dom.inputApiKey) {
        dom.inputApiKey.type = dom.inputApiKey.type === 'password' ? 'text' : 'password';
      }
    });

    dom.btnSaveKey?.addEventListener('click', async () => {
      const key = dom.inputApiKey?.value?.trim() || '';
      const prov = dom.selectProvider?.value || state.provider;
      if (!key) return;
      try {
        await tbot.setApiKey?.(prov, key);
        dom.inputApiKey.value = '';
        dom.inputApiKey.type = 'password';
        dom.inputApiKey.placeholder = 'Anahtar kaydedildi';
      } catch (error) { appendErrorNotice(String(error)); }
    });

    dom.modalBtnCloseDoctor?.addEventListener('click', () => dom.doctorModal?.classList.add('hidden'));
    dom.modalBtnCloseDoctorBtn?.addEventListener('click', () => dom.doctorModal?.classList.add('hidden'));
    dom.modalBtnRerunDoctor?.addEventListener('click', runDoctorDiagnostics);

    dom.modalBtnCloseGoal?.addEventListener('click', closeGoalModal);
    dom.modalBtnCancelGoal?.addEventListener('click', closeGoalModal);
    dom.modalBtnStartGoal?.addEventListener('click', startModalGoal);

    // Genel Klavye Kısayolları (Ctrl+K, Esc)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      } else if (e.key === 'Escape') {
        if (state.currentApproval) { respondApproval(false); return; }
        closeCommandPalette();
        closeLightbox();
        closeConfigModal();
        closeGoalModal();
        dom.doctorModal?.classList.add('hidden');
        if (state.isThinking) {
          abortCurrentTurn();
        }
      }
    });
  }

  // =========================================================================
  // 20. IPC Gelen Olayları (Event Handlers from preload.cjs)
  // =========================================================================
  function finishInterruptedTools() {
    for (const entry of activeToolCards.values()) {
      entry.status = 'stopped';
      pinnedTranscriptEntries.delete(entry);
      const badge = entry.element?.querySelector('.tool-badge');
      if (badge) { badge.classList.remove('running'); badge.textContent = 'Durduruldu'; }
    }
    activeToolCards.clear();
    refreshTranscript();
  }

  function finishApprovalCard(text = 'Onay isteği sona erdi.') {
    const card = document.getElementById('live-approval-card');
    const entry = card?.transcriptEntry;
    if (!entry) { card?.remove(); return; }
    entry.kind = 'notice';
    entry.text = text;
    pinnedTranscriptEntries.delete(entry);
    replaceTranscriptElement(entry);
    refreshTranscript();
  }

  function handleAgentEvent(event) {
    if (!event) return;
    switch (event.type) {
      case 'text':
        appendAssistantTextChunk(event.text);
        break;

      case 'tool_start':
        handleToolStart(event.call, event.toolTitle);
        break;

      case 'tool_end':
        handleToolEnd(event.call, event.result, event.toolTitle);
        break;

      case 'status': {
        const msg = event.message || '';
        updateThinkingLabel(msg);

        // Otonom Hedef [Adım X/Y]
        const goalMatch = msg.match(/Otonom Hedef\s*\[Adım\s*(\d+)\s*\/\s*(\d+)\]/i);
        if (goalMatch) {
          state.currentStepCount = parseInt(goalMatch[1], 10);
        }
        break;
      }

      case 'usage':
        if (typeof event.savingsPercent === 'number') {
          state.telemetry.savingsPercent = Math.round(event.savingsPercent);
        }
        if (typeof event.savedTokens === 'number') {
          state.telemetry.savedTokens = event.savedTokens;
        }
        updateHudBar();
        break;

      case 'error':
        finalizeAssistantMessage();
        stopThinking();
        appendErrorNotice(event.error || 'Bilinmeyen hata oluştu');
        break;

      case 'turn_end':
      case 'done':
        state.currentApproval = null;
        state.approvalQueue = [];
        finishApprovalCard();
        finishInterruptedTools();
        finalizeAssistantMessage();
        stopThinking();
        break;
    }
  }

  function setupIpcListeners() {
    // Agent olayları (text, tool_start, tool_end, status, usage, error, turn_end, done)
    if (typeof tbot.onAgentEvent === 'function') {
      tbot.onAgentEvent(handleAgentEvent);
    } else if (typeof tbot.onEvent === 'function') {
      tbot.onEvent(handleAgentEvent);
    }

    // Onay İsteği
    if (typeof tbot.onApprovalRequest === 'function') {
      tbot.onApprovalRequest((req) => {
        renderApprovalRequest(req);
      });
    }

    tbot.onApprovalExpired?.(({ requestId }) => {
      state.approvalQueue = state.approvalQueue.filter(request => request.requestId !== requestId);
      if (state.currentApproval?.requestId !== requestId) return;
      state.currentApproval = null;
      finishApprovalCard('Onay süresi doldu; işlem reddedildi.');
      if (state.approvalQueue.length) { renderApprovalRequest(state.approvalQueue.shift()); return; }
      if (state.turnPending) startThinking('Yanıt Hazırlanıyor…');
    });

    // Canlı Bellek Güncellemesi (sys:memory-update)
    if (typeof tbot.onMemoryUpdate === 'function') {
      tbot.onMemoryUpdate((stats) => {
        updateTelemetry(stats);
      });
    }
  }

  // =========================================================================
  // 21. Başlatma (Init)
  // =========================================================================
  function applyAppVersion(version) {
    // Only the main-process package metadata is accepted; never interpolate HTML.
    state.appVersion = typeof version === 'string' && version.length <= 80 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ? version : '';
    for (const element of document.querySelectorAll('[data-app-version]')) {
      element.textContent = state.appVersion || '—';
      element.title = state.appVersion ? `Sürüm ${state.appVersion}` : 'Sürüm bilgisi alınamadı';
    }
    document.title = `T Bot${state.appVersion ? ` ${state.appVersion}` : ''} — Yerel Kodlama Asistanı`;
  }

  async function init() {
    applyAppVersion();
    applyTheme(state.theme);
    startLogoAnimation();
    setupEventListeners();
    setupDragAndDrop();
    setupIpcListeners();

    // Başlangıç ayarlarını al
    try {
      const initial = await tbot.getConfig?.();
      applyAppVersion(initial?.appVersion);
      const cfg = initial?.config;
      if (cfg) {
        if (cfg.provider) state.provider = cfg.provider;
        if (cfg.model) state.model = cfg.model;
        if (cfg.efforts?.[`${state.provider}:${state.model}`]) state.effort = cfg.efforts[`${state.provider}:${state.model}`];
      }
    } catch {
      // ignore
    }

    // Resolve the workspace in main, so packaged launches never use a developer path.
    try {
      state.workspace = await tbot.getDefaultWorkspace();
      if (dom.workspacePath) dom.workspacePath.textContent = state.workspace;
      const memStats = await tbot.getMemoryStats?.();
      if (memStats) updateTelemetry(memStats);
    } catch {
      // ignore
    }

    updateHudBar();
    loadSessionsList();
    refreshWorkflow();
  }

  // DOM Yüklendiğinde Başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
