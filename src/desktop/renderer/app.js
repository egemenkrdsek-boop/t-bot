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
    currentSessionId: null,
    isThinking: false,
    turnPending: false,
    thinkingStartTime: 0,
    thinkingTimerId: null,
    spinnerIndex: 0,
    turnAssistantTextProduced: false,
    yoloEnabled: false,
    currentStepCount: 0,
    attachedImages: [], // { mimeType: 'image/png', data: base64, name: string }
    currentApproval: null,
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
    state.isThinking = true;
    state.thinkingStartTime = Date.now();
    if (step) state.currentStepCount = step;

    dom.thinkingBar?.classList.remove('hidden');
    if (dom.thinkingLabel) dom.thinkingLabel.textContent = label;
    if (dom.thinkingStepBadge) {
      dom.thinkingStepBadge.textContent = state.currentStepCount > 0 ? `Adım ${state.currentStepCount}` : 'Çekirdek';
    }

    if (state.thinkingTimerId) clearInterval(state.thinkingTimerId);
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
            <button class="btn-copy-code" data-copy-code>Kopyala</button>
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

  function scrollToBottom(force = false) {
    if (!dom.chatFeed) return;
    const isAtBottom = dom.chatFeed.scrollHeight - dom.chatFeed.scrollTop <= dom.chatFeed.clientHeight + 100;
    if (force || isAtBottom) {
      dom.chatFeed.scrollTop = dom.chatFeed.scrollHeight;
      dom.btnScrollBottom?.classList.add('hidden');
    } else {
      dom.btnScrollBottom?.classList.remove('hidden');
    }
  }

  function appendUserMessage(text, images = []) {
    hideEmptyHero();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    let imagesHtml = '';
    if (images && images.length > 0) {
      imagesHtml = '<div class="message-images-grid" style="display:flex;gap:6px;margin-bottom:8px;">';
      images.filter(img => img?.mimeType === 'image/png' && typeof img.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(img.data)).slice(0, 3).forEach((img, idx) => {
        const src = `data:${img.mimeType};base64,${img.data}`;
        imagesHtml += `<div class="tool-screenshot-preview" data-preview-image role="button" tabindex="0"><img src="${src}" alt="Ek" style="max-height:100px;border-radius:4px;"></div>`;
      });
      imagesHtml += '</div>';
    }

    wrapper.innerHTML = `<div class="message-header"><span class="sender-badge sender-user">▸ Sen</span><span class="message-time">${time}</span></div><div class="user-message-bubble">${imagesHtml}<div class="user-message-text">${escapeHtml(String(text || '').trim())}</div></div>`;

    dom.chatFeed?.appendChild(wrapper);
    scrollToBottom(true);
  }

  let currentAssistantWrapper = null;
  let currentAssistantTextBuffer = '';
  let assistantRenderTimer = null;
  function renderAssistantBuffer() {
    if (assistantRenderTimer) clearTimeout(assistantRenderTimer);
    assistantRenderTimer = null;
    const body = currentAssistantWrapper?.querySelector('.assistant-message-body');
    if (body) body.innerHTML = parseMarkdown(currentAssistantTextBuffer);
    scrollToBottom();
  }

  function appendAssistantTextChunk(chunk) {
    if (!chunk) return;
    state.turnAssistantTextProduced = true;
    hideEmptyHero();
    if (!currentAssistantWrapper) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      currentAssistantWrapper = document.createElement('div');
      currentAssistantWrapper.className = 'message-wrapper';
      currentAssistantWrapper.innerHTML = `<div class="message-header"><span class="sender-badge sender-assistant">◆ T Bot</span><span class="message-time">${time}</span></div><div class="assistant-message-body"></div>`;
      dom.chatFeed?.appendChild(currentAssistantWrapper);
      currentAssistantTextBuffer = '';
    }

    currentAssistantTextBuffer += chunk;
    if (!assistantRenderTimer) assistantRenderTimer = setTimeout(renderAssistantBuffer, 50);
  }

  function finalizeAssistantMessage() {
    renderAssistantBuffer();
    currentAssistantWrapper = null;
    currentAssistantTextBuffer = '';
  }

  function appendErrorNotice(errText) {
    hideEmptyHero();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.innerHTML = `<div class="message-header"><span class="sender-badge text-danger">⚠️ Hata</span><span class="message-time">${time}</span></div><div class="error-notice-card"><span class="error-icon">✕</span><div class="error-notice-text">${escapeHtml(String(errText || ''))}</div></div>`;
    dom.chatFeed?.appendChild(wrapper);
    scrollToBottom(true);
  }

  // =========================================================================
  // 9. Araç Çağrısı Kartları & Diff Görünümü
  // =========================================================================
  const activeToolCards = new Map();

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

  function handleToolStart(call, toolTitleOverride = null) {
    finalizeAssistantMessage();
    hideEmptyHero();
    state.currentStepCount++;

    const callId = call.id || `call_${Date.now()}`;
    const toolTitle = toolTitleOverride || TOOL_TITLE_MAP[call.name] || toTurkishTitleCase(call.name);
    const target = extractToolTarget(call.arguments);

    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.id = callId;
    card.dataset.startTime = String(Date.now());

    card.innerHTML = `
      <div class="tool-card-header" role="button" tabindex="0" aria-expanded="false" data-tool-toggle>
        <div class="tool-header-left">
          <span class="tool-icon">◈</span>
          <span class="tool-title">${escapeHtml(toolTitle)}</span>
          ${target ? `<span class="tool-target" title="${escapeHtml(target)}">› ${escapeHtml(target)}</span>` : ''}
        </div>
        <div class="tool-header-right">
          <span class="tool-badge running">Çalışıyor…</span>
          <span class="tool-accordion-icon">▼</span>
        </div>
      </div>
      <div class="tool-card-body hidden">
        <div class="tool-section-title">Parametreler:</div>
        <pre class="tool-args-pre">${escapeHtml(JSON.stringify(call.arguments, null, 2))}</pre>
        <div class="tool-result-area"></div>
      </div>
    `;

    dom.chatFeed?.appendChild(card);
    activeToolCards.set(callId, card);
    startThinking(`${toolTitle} Yürütülüyor…`, state.currentStepCount);
    scrollToBottom(true);
  }

  function handleToolEnd(call, result, toolTitleOverride = null) {
    const callId = call.id;
    const card = activeToolCards.get(callId);
    const toolTitle = toolTitleOverride || TOOL_TITLE_MAP[call.name] || toTurkishTitleCase(call.name);

    let durationText = '';
    if (card?.dataset.startTime) {
      const ms = Date.now() - parseInt(card.dataset.startTime, 10);
      durationText = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}sn`;
    }

    const isError = /error|hata|fail/i.test(typeof result === 'string' ? result : JSON.stringify(result));

    if (card) {
      const headerRight = card.querySelector('.tool-header-right');
      if (headerRight) {
        headerRight.innerHTML = `
          <span class="tool-duration">${durationText}</span>
          <span class="tool-badge ${isError ? 'error' : 'success'}">${isError ? '✗ Hata' : '✓ Tamamlandı'}</span>
          <span class="tool-accordion-icon">▼</span>
        `;
      }
      if (isError) card.classList.add('error');

      const bodyEl = card.querySelector('.tool-card-body');
      if (bodyEl) {
        bodyEl.classList.remove('hidden');
        const resultArea = bodyEl.querySelector('.tool-result-area');
        if (resultArea) {
          const strResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

          // Eğer file_patch diff içeriyorsa renkli diff bas
          if (call.name === 'file_patch' || call.name === 'file_write' || strResult.includes('@@')) {
            resultArea.innerHTML = `<div class="tool-section-title">Değişiklik Özeti:</div>${formatDiff(strResult)}`;
          } else {
            resultArea.innerHTML = `<div class="tool-section-title">Sonuç:</div><pre>${escapeHtml(strResult)}</pre>`;
          }

          // Eğer sonuçta base64 ekran görüntüsü varsa
          const base64Match = strResult.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
          if (base64Match || call.name === 'computer' || call.name === 'browser_screenshot') {
            const imgSrc = base64Match ? base64Match[0] : (strResult.startsWith('data:image') ? strResult : null);
            if (imgSrc) {
              const previewDiv = document.createElement('div');
              previewDiv.className = 'tool-screenshot-preview';
              previewDiv.title = 'Büyütmek için tıklayın';
              previewDiv.onclick = () => window.tbotOpenLightbox(imgSrc, `${toolTitle} Ekran Görüntüsü`);
              previewDiv.innerHTML = `<img src="${imgSrc}" alt="Screenshot">`;
              resultArea.appendChild(previewDiv);
            }
          }
        }
      }
    }

    activeToolCards.delete(callId);
    startThinking('Yanıt Hazırlanıyor…');
    scrollToBottom();
  }

  // =========================================================================
  // 10. Canlı Araç Onay Kartı (Approval Request)
  // =========================================================================
  function renderApprovalRequest(req) {
    dom.thinkingBar?.classList.add('hidden');
    finalizeAssistantMessage();
    hideEmptyHero();

    state.currentApproval = req;
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.id = 'live-approval-card';

    const toolTitle = req.toolTitle || TOOL_TITLE_MAP[req.tool] || toTurkishTitleCase(req.tool);

    card.innerHTML = `
      <div class="approval-header">
        <span>🛡️ Onay Bekleniyor:</span>
        <strong>${escapeHtml(toolTitle)} (${escapeHtml(req.tool)})</strong>
      </div>
      <div class="approval-desc">${escapeHtml(req.description || 'Bu aracın çalıştırılması sisteminizde değişiklik yapabilir.')}</div>
      <pre class="approval-args">${escapeHtml(JSON.stringify(req.arguments, null, 2))}</pre>
      <div class="approval-actions">
        <button id="btn-approval-allow" class="btn-approve">✓ İzin Ver (Enter)</button>
        <button id="btn-approval-deny" class="btn-reject">✗ Reddet (Esc)</button>
        <button id="btn-approval-yolo" class="btn-yolo-session">⚡ Bu Turda Hep İzin Ver</button>
      </div>
    `;

    dom.chatFeed?.appendChild(card);
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

    const reqId = state.currentApproval?.requestId;
    state.currentApproval = null;
    tbot.respondApproval?.(reqId, approved, alwaysAllow);

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
    if (state.turnPending || state.currentApproval || pendingImageReads) return;
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

      if (res && res.ok === false) {
        appendErrorNotice(res.error || 'İşlem başarısız oldu');
      } else {
        if (res?.sessionId) {
          state.currentSessionId = res.sessionId;
        }

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
      setTurnControls();
      finalizeAssistantMessage();
      stopThinking();
      loadSessionsList();
      refreshWorkflow();
    }
  }

  function setTurnControls() {
    [dom.btnSend, dom.btnWorkspace, dom.btnNewSession, dom.modalBtnStartGoal].forEach(button => { if (button) button.disabled = state.turnPending; });
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
### T Bot 2.0 Siber-Zen Komut Kılavuzu
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
    activeToolCards.clear();
    if (dom.chatFeed) {
      const messages = Array.from(dom.chatFeed.querySelectorAll('.message-wrapper, .tool-card, .approval-card'));
      messages.forEach(m => m.remove());
    }
    showEmptyHeroIfEmpty();
  }

  // =========================================================================
  // 16. Oturumlar Yönetimi (Sessions)
  // =========================================================================
  async function loadSessionsList() {
    try {
      const sessions = await tbot.listSessions?.(state.workspace) || [];
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
    if (confirm('Bu oturumu silmek istediğinize emin misiniz?')) {
      await tbot.deleteSession?.(id, state.workspace);
      loadSessionsList();
    }
  };

  async function switchSession(id) {
    if (state.turnPending) return;
    state.currentSessionId = id;
    clearChatTerminal();
    loadSessionsList();
    try {
      const data = await tbot.loadSession?.(id, state.workspace);
      if (data?.messages) {
        data.messages.forEach((m) => {
          if (m.role === 'user') appendUserMessage(m.content, m.images);
          else if (m.role === 'assistant') {
            appendAssistantTextChunk(m.content);
            finalizeAssistantMessage();
          }
        });
      }
    } catch {
      // Sessizce geç
    }
  }

  // =========================================================================
  // 17. Görev Pusulası (Goal & Todos Yönetimi)
  // =========================================================================
  async function refreshWorkflow() {
    try {
      // main.ts içindeki workflows:get-state IPC çağrısı
      const stateData = await tbot.getWorkflowState?.(state.workspace);
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
      const sm = await tbot.getSkillsAndMcp?.(state.workspace);
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
    dom.configModal?.classList.remove('hidden');
    if (dom.inputCustomModel) dom.inputCustomModel.value = '';
    if (dom.selectProvider) dom.selectProvider.value = state.provider;
    if (dom.selectEffort) dom.selectEffort.value = state.effort;

    try {
      const cat = await tbot.getModelCatalog?.();
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
      updateModelDropdown(state.provider);
    }
  }

  function closeConfigModal() {
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
      if (target.hasAttribute('data-copy-code')) window.tbotCopyCode(target);
      if (target.hasAttribute('data-remove-attachment')) window.tbotRemoveAttachment(Number(target.dataset.removeAttachment));
      if (target.hasAttribute('data-preview-image')) window.tbotOpenLightbox(target.querySelector('img')?.src);
      if (target.hasAttribute('data-tool-toggle')) {
        const expanded = target.parentElement.classList.toggle('expanded');
        target.setAttribute('aria-expanded', String(expanded));
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
      if (state.turnPending) return;
      const session = await tbot.createSession?.(state.workspace);
      state.currentSessionId = session?.id || `session_${Date.now()}`;
      clearChatTerminal();
      loadSessionsList();
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
    dom.btnScrollBottom?.addEventListener('click', () => scrollToBottom(true));
    dom.chatFeed?.addEventListener('scroll', () => {
      const atBottom = dom.chatFeed.scrollHeight - dom.chatFeed.scrollTop <= dom.chatFeed.clientHeight + 100;
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
        document.getElementById('live-approval-card')?.remove();
        activeToolCards.clear();
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
  async function init() {
    applyTheme(state.theme);
    startLogoAnimation();
    setupEventListeners();
    setupDragAndDrop();
    setupIpcListeners();

    // Başlangıç ayarlarını al
    try {
      const cfg = await tbot.getConfig?.();
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
