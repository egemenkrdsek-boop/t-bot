/**
 * T Bot 3.0 — local agent desktop controller
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
    ultracodeMode: false,
    workspacePermission: 'ask', // main'den gelen kalıcı çalışma alanı izni ('ask' | 'allow')
    runMode: 'agent',
    pendingPlan: null,
    pendingPlanRequest: '',
    turnPolicy: { active: false, yolo: false }, // çalışan turun efektif politikası
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
    commands: [],
    unavailableCommands: [],
    theme: localStorage.getItem('tbot_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  };

  // Tool titles come from src/theme.ts through the main process; no second copy.
  let TOOL_TITLE_MAP = {};


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
    btnQuickPlan: document.getElementById('btn-quick-plan'),
    btnQuickUltracode: document.getElementById('btn-quick-ultracode'),
    btnQuickSubagents: document.getElementById('btn-quick-subagents'),
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
    hudModeVal: document.getElementById('hud-mode-val'),
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

    mcpModal: document.getElementById('mcp-modal'),
    mcpStatusList: document.getElementById('mcp-status-list'),
    selectMcpService: document.getElementById('select-mcp-service'),
    inputMcpToken: document.getElementById('input-mcp-token'),
    modalBtnCloseMcp: document.getElementById('modal-btn-close-mcp'),
    modalBtnConnectMcp: document.getElementById('modal-btn-connect-mcp'),
    modalBtnRemoveMcp: document.getElementById('modal-btn-remove-mcp'),

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
  // 3. 14x14 pixel logo rendering (Canvas Rendering)
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

    ctx.fillStyle = isLight ? '#FFFFFF' : '#0A0F0B';
    ctx.fillRect(0, 0, size, size);

    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 14; x++) {
        const char = LOGO_MATRIX[y]?.[x] || '.';
        if (char === '.') {
          ctx.fillStyle = isLight ? '#EEF4E9' : '#151B16';
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize - 0.2, pixelSize - 0.2);
          continue;
        }

        const diag = x + y * 0.8;
        const diff = Math.abs(diag - wavePos);
        const isHighlight = diff < 2.5;

        if (char === 'W') {
          ctx.fillStyle = '#FFFFFF';
        } else if (isHighlight) {
          ctx.fillStyle = isLight ? '#65B817' : '#D6FF9A';
        } else {
          const t = (x + y) / 26;
          const r = Math.round((isLight ? 77 : 132) + ((isLight ? 101 : 184) - (isLight ? 77 : 132)) * t);
          const g = Math.round((isLight ? 154 : 204) + ((isLight ? 184 : 236) - (isLight ? 154 : 204)) * t);
          const b = Math.round((isLight ? 15 : 50) + ((isLight ? 23 : 110) - (isLight ? 15 : 50)) * t);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
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
        dom.themeToggleIcon.textContent = '◐';
        dom.themeToggleLabel.textContent = 'Açık';
      } else {
        dom.themeToggleIcon.textContent = '◐';
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
  // Görünen mod her zaman efektif moddur: YOLO + kalıcı alan izni + tur durumu.
  function updateApprovalModeDisplay() {
    const workspaceAuto = state.workspacePermission === 'allow';
    const turnActive = state.turnPolicy.active;
    const effectiveYolo = turnActive ? state.turnPolicy.yolo : state.yoloEnabled;
    const auto = effectiveYolo || workspaceAuto;

    dom.btnQuickYolo?.classList.toggle('yolo-active', auto);
    dom.btnQuickYolo?.classList.toggle('yolo-turn', turnActive);
    if (dom.yoloIcon) dom.yoloIcon.textContent = auto ? '●' : '○';
    if (dom.yoloLabel) {
      if (turnActive) dom.yoloLabel.textContent = effectiveYolo ? 'YOLO (Bu Tur)' : (workspaceAuto ? 'Oto (Alan)' : 'Onaylı (Bu Tur)');
      else if (workspaceAuto) dom.yoloLabel.textContent = 'Oto (Alan)';
      else dom.yoloLabel.textContent = effectiveYolo ? 'YOLO' : 'Onaylı';
    }
    dom.btnQuickYolo?.setAttribute('aria-pressed', String(auto));
    dom.btnQuickYolo?.setAttribute('title', turnActive
      ? (effectiveYolo ? 'Bu turda araçlar otomatik onaylanıyor' : 'Bu turda araçlar için onay isteniyor')
      : (workspaceAuto ? 'Bu çalışma alanı için kalıcı otomatik onay açık' : (effectiveYolo ? 'YOLO Modu: Araçları onaysız otomatik yürüt' : 'Onaylı Mod: Araçlar için izin istenir')));
  }

  async function applyApprovalPolicy() {
    try {
      const policy = await tbot.getApprovalPolicy?.(state.workspace, state.yoloEnabled);
      if (policy && typeof policy.workspacePermission === 'string') state.workspacePermission = policy.workspacePermission;
    } catch {
      // Politika alınamazsa mevcut görünümü koru.
    }
    updateApprovalModeDisplay();
  }

  function toggleYoloMode() {
    state.yoloEnabled = !state.yoloEnabled;
    // Tur sürerken toggle mevcut turun politikasını günceller ("bu tur için geçerli").
    if (state.turnPolicy.active) {
      state.turnPolicy.yolo = state.yoloEnabled;
      try {
        tbot.setTurnPolicy?.(state.yoloEnabled)?.catch?.(error => appendErrorNotice(String(error)));
      } catch (e) {
        console.warn('tbot.setTurnPolicy hatası:', e);
      }
    }
    updateApprovalModeDisplay();
  }

  // =========================================================================
  // 5. Live telemetry and status line
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
    const modeLabel = state.runMode === 'plan' ? (state.pendingPlan ? 'Plan Hazır' : 'Plan')
      : state.runMode === 'ultracode' ? 'Ultracode'
        : state.runMode === 'subagents' ? 'Subagents'
          : state.runMode === 'plan-apply' ? 'Plan Uygula' : 'Ajan';
    if (dom.hudModeVal) dom.hudModeVal.textContent = modeLabel;

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
  // 6. Run spine and elapsed timer
  // =========================================================================
  const RUN_PHASES = ['Keşif', 'Plan', 'Uygulama', 'Doğrulama'];

  function toolRunPhase(name) {
    const tool = String(name || '');
    if (tool === 'project_verify' || tool === 'artifact_read') return 4;
    if (tool === 'todo_manage' || tool === 'goal_manage' || tool === 'delegate_task') return 2;
    if (['file_read', 'file_outline', 'file_search', 'file_glob', 'file_list', 'repo_map', 'skill_list', 'skills_list', 'mcp_catalog'].includes(tool)) return 1;
    return 3;
  }

  function updateRunSpine(step = 0) {
    if (typeof document.querySelectorAll !== 'function') return;
    const nodes = document.querySelectorAll('.run-node');
    if (!nodes.length) return;
    const active = Math.max(0, Math.min(nodes.length - 1, (step || 1) - 1));
    nodes.forEach((node, index) => node.classList.toggle('active', index === active));
    if (dom.thinkingStepBadge) dom.thinkingStepBadge.textContent = RUN_PHASES[active] || RUN_PHASES[0];
  }

  function startThinking(label = 'Düşünülüyor…', step = null) {
    if (!state.isThinking) state.thinkingStartTime = Date.now();
    state.isThinking = true;
    if (step) state.currentStepCount = step;
    if (dom.thinkingSpinner) dom.thinkingSpinner.textContent = '●';

    dom.thinkingBar?.classList.remove('hidden');
    if (dom.thinkingLabel) dom.thinkingLabel.textContent = label;
    updateRunSpine(state.currentStepCount);

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

  // Tek Esc yönlendirmesi: onay kartı açıksa yalnız onayı reddeder ve durur;
  // aksi halde çalışan turu iptal eder. Hem input hem global handler bunu kullanır.
  function handleEscape() {
    if (state.currentApproval) {
      // Onay beklenirken tur iptal edilmez; zamanlayıcı da durdurulur.
      stopThinking();
      respondApproval(false);
      return true;
    }
    if (state.isThinking) {
      abortCurrentTurn();
      return true;
    }
    return false;
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

  const UI_CONJUNCTIONS = new Set(['ve', 'ile', 'veya', 'yahut', 'ya', 'da', 'de', 'ki', 'ama', 'fakat', 'lakin', 'ancak', 'için', 'gibi', 'kadar', 'üzere', 'mı', 'mi', 'mu', 'mü']);
  const UI_ACRONYMS = new Map([
    ['RAM', 'RAM'], ['CPU', 'CPU'], ['API', 'API'], ['APİ', 'API'], ['AST', 'AST'], ['MCP', 'MCP'],
    ['CLI', 'CLI'], ['CLİ', 'CLI'], ['TUI', 'TUI'], ['TUİ', 'TUI'], ['HUD', 'HUD'], ['LLM', 'LLM'],
    ['ID', 'ID'], ['İD', 'ID'], ['URL', 'URL'], ['JSON', 'JSON'], ['SSE', 'SSE'], ['YOLO', 'YOLO'],
    ['GC', 'GC'], ['MB', 'MB'], ['GB', 'GB'], ['KB', 'KB'], ['PID', 'PID'], ['PİD', 'PID'], ['OK', 'OK'], ['UI', 'UI'], ['UX', 'UX'],
  ]);

  function titleWord(word, isFirst) {
    if (!word) return word;
    const upper = word.toLocaleUpperCase('tr-TR');
    if (UI_ACRONYMS.has(upper)) return UI_ACRONYMS.get(upper);
    const lower = word.toLocaleLowerCase('tr-TR');
    if (!isFirst && UI_CONJUNCTIONS.has(lower)) return lower;
    return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');
  }

  function toTurkishTitleCase(str) {
    if (!str) return '';
    let index = 0;
    return String(str).split(/(\s+)/).map(token => {
      if (/^\s+$/.test(token)) return token;
      const match = token.match(/^([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)(.*?)([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)$/);
      if (!match) return token;
      const [, leading, core, trailing] = match;
      if (!core) return token;
      const first = index === 0;
      index++;
      const cased = core.split(/([-/])/).map((part, partIndex) => part === '-' || part === '/' ? part : titleWord(part, first && partIndex === 0)).join('');
      return leading + cased + trailing;
    }).join('');
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
  // Bellek üst sınırı: çok uzun oturumlarda en eski kayıtlar bellekten düşer.
  const MAX_TRANSCRIPT_ENTRIES = 4000;
  const transcriptEntries = [];
  const renderedTranscriptEntries = new Set();
  const pinnedTranscriptEntries = new Set();
  let transcriptPageStart = 0;
  let followTranscript = true;
  let transcriptPager = null;
  let currentAssistantEntry = null;
  let assistantRenderTimer = null;
  const activeToolCards = new Map();
  // Diskteki oturum geçmişinin sayfalı yükleme imleci.
  const sessionHistory = { sessionId: null, total: 0, loadedFrom: 0, loading: false };

  function transcriptTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Diskte daha eski kayıt varsa IPC ile bir sayfa daha çeker (mevcut DOM
  // sayfalamasını korur; yalnızca gerçek oturum yüklendiğinde etkin olur).
  async function loadOlderHistory() {
    const sessionId = sessionHistory.sessionId;
    if (!sessionId || sessionHistory.loading || sessionHistory.loadedFrom <= 0) return;
    if (typeof tbot.loadSessionMessages !== 'function') return;
    sessionHistory.loading = true;
    const limit = TRANSCRIPT_PAGE_SIZE;
    const offset = Math.max(0, sessionHistory.loadedFrom - limit);
    try {
      const page = await tbot.loadSessionMessages(sessionId, state.workspace, { offset, limit });
      if (sessionId !== state.currentSessionId || !page || !Array.isArray(page.messages)) return;
      prependTranscriptMessages(page.messages);
      sessionHistory.loadedFrom = typeof page.offset === 'number' ? page.offset : offset;
      transcriptPageStart = 0;
      followTranscript = false;
      refreshTranscript();
      if (dom.chatFeed) dom.chatFeed.scrollTop = 0;
    } catch (error) {
      appendErrorNotice(`Geçmiş yüklenemedi: ${String(error)}`);
    } finally {
      sessionHistory.loading = false;
    }
  }

  function transcriptPage(action) {
    const wantsOlder = action === 'older' || action === 'first';
    if (wantsOlder && transcriptPageStart === 0 && sessionHistory.sessionId && sessionHistory.loadedFrom > 0 && !sessionHistory.loading) {
      void loadOlderHistory();
      return;
    }
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

  function dropTranscriptEntry(entry) {
    if (!entry) return;
    pinnedTranscriptEntries.delete(entry);
    renderedTranscriptEntries.delete(entry);
    if (entry.element) { entry.element.remove?.(); entry.element = null; }
  }

  function trimTranscriptEntries() {
    let dropped = false;
    while (transcriptEntries.length > MAX_TRANSCRIPT_ENTRIES) {
      dropTranscriptEntry(transcriptEntries.shift());
      dropped = true;
    }
    return dropped;
  }

  function appendTranscriptEntry(entry, pinned = false) {
    transcriptEntries.push(entry);
    if (pinned) pinnedTranscriptEntries.add(entry);
    trimTranscriptEntries();
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
      const label = { running: 'Çalışıyor…', success: '✓ Tamamlandı', error: '✗ Hata', denied: '⊘ Reddedildi', stopped: 'Durduruldu' }[status];
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
    const entry = appendTranscriptEntry({ kind: 'user', text: String(text || '').trim(), images, time: transcriptTime() });
    scrollToBottom(followTranscript);
    return entry;
  }

  // Gönderim sonrası base64 görsel verisini bırakır; DOM'da zaten önizleme kalmaz.
  function releaseUserImages(entry) {
    if (!entry || entry.kind !== 'user' || !entry.images || entry.images.length === 0) return;
    entry.images = [];
    if (entry.element) replaceTranscriptElement(entry);
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

  // Kullanıcı/ajan reddi ve bilinmeyen araç "Tamamlandı" sayılmamalıdır.
  function isToolDenied(result) {
    return /^\s*(?:Tool action denied|Tool denied:|Araç reddedildi)/i.test(result);
  }

  function isToolUnknown(result) {
    return /^\s*(?:Unknown tool:|Bilinmeyen araç)/i.test(result);
  }

  function toolStatus(result, toolName) {
    if (isToolDenied(result)) return 'denied';
    if (isToolUnknown(result)) return 'error';
    return isToolError(result, toolName) ? 'error' : 'success';
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
    state.currentStepCount = toolRunPhase(call.name);
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
      entry.status = toolStatus(entry.result, call.name);
      entry.expanded = entry.expanded || entry.status === 'error' || entry.status === 'denied';
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
    // Onay beklerken düşünme zamanlayıcısı durur; karar sonrası yeniden başlar.
    stopThinking();
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
        <span>Onay Bekleniyor:</span>
        <strong>${escapeHtml(toolTitle)} (${escapeHtml(req.tool)})</strong>
      </div>
      <div class="approval-argument-pages">${textPager('approval', 0, details.length)}</div>
      <pre class="approval-args">${escapeHtml(details.slice(0, TEXT_PAGE_CHARS))}</pre>
      <div class="approval-actions">
        <button id="btn-approval-allow" class="btn-approve">✓ İzin Ver (Enter)</button>
        <button id="btn-approval-deny" class="btn-reject">✗ Reddet (Esc)</button>
        <button id="btn-approval-yolo" class="btn-yolo-session">Bu Turda İzin Ver</button>
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
    const rawText = options.text != null ? String(options.text) : (dom.userInput?.value || '');
    const text = rawText.trim();
    const images = [...state.attachedImages];

    if (!text && images.length === 0) return;

    if (!options.mode && text.startsWith('/')) {
      await handleSlashCommand(text);
      if (dom.userInput) dom.userInput.value = '';
      return;
    }

    if (dom.userInput && options.text == null) dom.userInput.value = '';
    state.attachedImages = [];
    state.turnAssistantTextProduced = false;
    state.currentStepCount = 0;
    const effectiveMode = options.mode || (options.goal ? 'goal' : state.ultracodeMode ? 'ultracode' : undefined);
    state.runMode = effectiveMode || 'agent';
    renderAttachmentChips();
    autoResizeTextarea();

    state.turnPending = true;
    state.turnPolicy = { active: true, yolo: state.yoloEnabled };
    updateApprovalModeDisplay();
    setTurnControls();
    transcriptPage('latest');
    const userEntry = appendUserMessage(options.display || text, images);
    startThinking(effectiveMode === 'plan' ? 'Plan Hazırlanıyor' : effectiveMode === 'ultracode' ? 'Ultracode Çalışıyor' : effectiveMode === 'subagents' ? 'Alt Ajanlar Çalışıyor' : 'T Bot Çözümlüyor');

    try {
      const res = await tbot.startTurn?.({
        message: text,
        images,
        mode: effectiveMode,
        plan: options.plan,
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
        if (res?.memoryStats) updateTelemetry(res.memoryStats);
        if (options.mode === 'plan') {
          state.pendingPlan = res?.lastAssistantText || null;
          state.pendingPlanRequest = text;
          if (state.pendingPlan) appendTranscriptEntry({ kind: 'notice', text: 'Plan hazır. Uygulamak için /plan apply yazın.', error: false });
        } else if (options.mode === 'plan-apply') {
          state.pendingPlan = null;
          state.pendingPlanRequest = '';
        }
        if (!state.turnAssistantTextProduced && res?.lastAssistantText) {
          appendAssistantTextChunk(res.lastAssistantText);
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
      releaseUserImages(userEntry);
      state.turnPolicy = { active: false, yolo: false };
      state.runMode = state.pendingPlan ? 'plan' : state.ultracodeMode ? 'ultracode' : 'agent';
      updateApprovalModeDisplay();
      updateHudBar();
      loadSessionsList();
      refreshWorkflow();
      applyApprovalPolicy();
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
  async function loadCommandMetadata() {
    try {
      const titles = await tbot.getToolTitles?.();
      if (titles && typeof titles === 'object' && !Array.isArray(titles)) TOOL_TITLE_MAP = titles;
    } catch {
      // Tool titles are cosmetic; localized fallback still works.
    }

    try {
      const catalog = await tbot.getCommands?.();
      if (Array.isArray(catalog?.available)) {
        state.commands = catalog.available.filter(command =>
          command && typeof command.name === 'string' && typeof command.description === 'string');
      }
      if (Array.isArray(catalog?.unavailable)) {
        state.unavailableCommands = catalog.unavailable.filter(command =>
          command && typeof command.name === 'string');
      }
      renderPaletteCatalog();
    } catch {
      // The static palette remains available when metadata cannot be read.
    }
  }

  function renderPaletteCatalog() {
    if (!dom.paletteItems || state.commands.length === 0) return;
    const items = state.commands.map((command, index) => {
      const item = document.createElement('div');
      item.className = `palette-item${index === 0 ? ' selected' : ''}`;
      item.setAttribute('data-cmd', command.name);
      const name = document.createElement('span');
      name.className = 'palette-cmd';
      name.textContent = command.name;
      const description = document.createElement('span');
      description.className = 'palette-desc';
      description.textContent = command.description;
      item.append(name, description);
      return item;
    });
    dom.paletteItems.replaceChildren(...items);
  }

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

  function closeTopmostOverlay() {
    const overlays = [
      { element: dom.commandPalette, close: closeCommandPalette },
      { element: dom.lightboxModal, close: closeLightbox },
      { element: dom.configModal, close: closeConfigModal },
      { element: dom.mcpModal, close: closeMcpModal },
      { element: dom.doctorModal, close: () => dom.doctorModal?.classList.add('hidden') },
      { element: dom.goalModal, close: closeGoalModal },
    ];
    for (const overlay of overlays) {
      if (overlay.element && !overlay.element.classList.contains('hidden')) {
        overlay.close();
        return true;
      }
    }
    return false;
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

  async function handleSlashCommand(cmd) {
    const text = String(cmd || '').trim();
    const match = text.match(/^\/([a-z0-9_-]+)\s*([\s\S]*)$/i);
    const action = match ? '/' + match[1].toLowerCase() : '';
    const argument = match ? match[2].trim() : '';

    const notice = (message) => {
      appendTranscriptEntry({ kind: 'notice', text: message, error: false });
      scrollToBottom(followTranscript);
    };

    const unavailable = state.unavailableCommands.find(command => command.name === action);
    if (unavailable) {
      notice(`\`${action}\` masaüstünde desteklenmiyor. Aynı komutu CLI/TUI üzerinde kullanabilirsiniz.`);
      return;
    }

    const showReport = (title, rows) => {
      appendAssistantTextChunk(`### ${title}\n\n${rows.map(row => `- ${row}`).join('\n')}`);
      finalizeAssistantMessage();
    };

    switch (action) {
      case '/model':
      case '/provider':
      case '/auth':
      case '/config':
        openConfigModal();
        break;

      case '/tokens': {
        const report = await tbot.getTokenReport?.();
        if (!report) {
          notice('Token raporu alınamadı.');
          break;
        }
        showReport('Token ve Bağlam Raporu', [
          `Ham token: **${Number(report.totalRawTokens || 0).toLocaleString('tr-TR')}**`,
          `Gönderilen girdi: **${Number(report.totalSentInputTokens || 0).toLocaleString('tr-TR')}**`,
          `Üretilen çıktı: **${Number(report.totalOutputTokens || 0).toLocaleString('tr-TR')}**`,
          `Önbelleklenen: **${Number(report.totalCachedTokens || report.cachedTokens || 0).toLocaleString('tr-TR')}**`,
          `Şema budaması: **${Number(report.totalPrunedSchemaTokens || 0).toLocaleString('tr-TR')}**`,
          `Geçmiş sıkıştırma: **${Number(report.totalCompressedHistoryTokens || 0).toLocaleString('tr-TR')}**`,
          `Bağlam önbelleği: **${Number(report.totalContextCacheSavedTokens || 0).toLocaleString('tr-TR')}**`,
          `Yerel tasarruf: **${Number(report.totalSavedTokens || 0).toLocaleString('tr-TR')} tok (%${Number(report.savingsPercent || 0)})**`,
          'Not: bu değerler yerel tahminlerdir; sağlayıcı faturası veya rakip ölçümü değildir.',
        ]);
        break;
      }

      case '/memory': {
        const factsRequest = tbot.getMemoryFacts ? tbot.getMemoryFacts(state.workspace) : Promise.resolve([]);
        const statsRequest = tbot.getMemoryStats ? tbot.getMemoryStats() : Promise.resolve(null);
        const [facts, stats] = await Promise.all([
          factsRequest.catch(() => []),
          statsRequest.catch(() => null),
        ]);
        const rows = [];
        if (stats) rows.push(`Heap: **${Number(stats.heapUsedMB || 0)} MB** / ${Number(stats.heapTotalMB || 0)} MB · RSS: **${Number(stats.rssMB || 0)} MB** · baskı: **${stats.pressure || '—'}**`);
        if (Array.isArray(facts) && facts.length) {
          for (const fact of facts.slice(0, 20)) rows.push(`[${String(fact.scope || 'project').toUpperCase()}] **${escapeHtml(String(fact.key || ''))}** = ${escapeHtml(String(fact.value || ''))}`);
          if (facts.length > 20) rows.push(`... ${facts.length - 20} madde daha`);
        } else {
          rows.push('Kayıtlı bellek maddesi yok.');
        }
        showReport('Bellek ve RAM Durumu', rows);
        break;
      }

      case '/remember': {
        const eq = argument.indexOf('=');
        let key = '';
        let value = '';
        if (eq >= 0) {
          key = argument.slice(0, eq).trim();
          value = argument.slice(eq + 1).trim();
        } else {
          value = argument.trim();
          key = value.split(/\s+/).slice(0, 3).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '') || `fact_${Date.now()}`;
        }
        if (!value) {
          notice('Kullanım: /remember <anahtar> = <değer>');
          break;
        }
        const result = tbot.rememberFact
          ? await tbot.rememberFact(state.workspace, key, value).catch(error => ({ ok: false, error: String(error) }))
          : { ok: false, error: 'Masaüstü köprüsü bu sürümde bellek yazmayı desteklemiyor.' };
        notice(result?.ok ? `Kaydedildi: **${escapeHtml(key)}**` : `Kaydedilemedi: ${escapeHtml(String(result?.error || 'bilinmeyen hata'))}`);
        break;
      }

      case '/forget': {
        if (!argument) {
          notice('Kullanım: /forget <anahtar>');
          break;
        }
        const result = tbot.forgetFact
          ? await tbot.forgetFact(state.workspace, argument).catch(error => ({ ok: false, error: String(error) }))
          : { ok: false, error: 'Masaüstü köprüsü bu sürümde bellek silmeyi desteklemiyor.' };
        notice(result?.ok ? `Silindi: **${escapeHtml(argument)}**` : `Bulunamadı veya silinemedi: ${escapeHtml(String(result?.error || argument))}`);
        break;
      }

      case '/skills': {
        const result = tbot.getSkillsAndMcp
          ? await tbot.getSkillsAndMcp(state.workspace).catch(() => null)
          : null;
        const all = [...(result?.builtinSkills || []), ...(result?.customSkills || [])];
        if (!all.length) {
          notice('Yetenek listesi alınamadı.');
          break;
        }
        if (argument) {
          const skill = all.find(item => String(item.id || '').toLowerCase() === argument.toLowerCase());
          if (!skill) {
            notice(`Yetenek bulunamadı: ${escapeHtml(argument)}`);
            break;
          }
          showReport(`/${skill.id}`, [
            escapeHtml(String(skill.description || '')),
            escapeHtml(String(skill.guidance || 'Ek yönerge yok.')),
          ]);
          break;
        }
        showReport('Yetenekler', all.slice(0, 40).map(skill => `**/${escapeHtml(String(skill.id || '?'))}** — ${escapeHtml(String(skill.description || ''))}`));
        break;
      }

      case '/effort': {
        const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
        if (!argument) {
          openConfigModal();
          break;
        }
        const effort = argument.toLowerCase();
        if (!levels.includes(effort)) {
          notice('Kullanım: /effort low|medium|high|xhigh|max');
          break;
        }
        try {
          await tbot.saveConfig?.({ efforts: { [`${state.provider}:${state.model}`]: effort } });
        } catch (error) {
          appendErrorNotice(`Efor kaydedilemedi: ${String(error)}`);
          break;
        }
        state.effort = effort;
        updateHudBar();
        notice(`Düşünme eforu: **${effort}**`);
        break;
      }

      case '/sessions': {
        const sessions = await tbot.listSessions?.(state.workspace).catch(() => []) || [];
        if (!sessions.length) {
          notice('Kayıtlı oturum yok.');
          break;
        }
        showReport('Oturumlar', sessions.slice(0, 30).map(session =>
          `\`${escapeHtml(String(session.id || ''))}\` — ${escapeHtml(String(session.title || 'Yeni Oturum'))} (${escapeHtml(String(session.updatedAt || ''))})`));
        break;
      }

      case '/resume': {
        if (!argument) {
          notice('Kullanım: /resume <oturum-id>');
          break;
        }
        if (state.turnPending || state.sessionLoading) {
          notice('Oturum değiştirmek için önce çalışan turu durdurun.');
          break;
        }
        await switchSession(argument);
        if (state.currentSessionId === argument) notice(`Oturuma devam ediliyor: **${escapeHtml(argument)}**`);
        break;
      }

      case '/gui': {
        const mode = (argument || 'live').toLowerCase();
        const result = await tbot.setGuiMode?.(mode).catch(error => ({ ok: false, error: String(error) }));
        notice(result?.ok ? result.message : `GUI modu değiştirilemedi: ${escapeHtml(String(result?.error || 'bilinmeyen hata'))}`);
        break;
      }

      case '/bot': {
        const sub = (argument.split(/\s+/)[0] || 'status').toLowerCase();
        if (sub === 'token') {
          const token = argument.slice(argument.toLowerCase().indexOf('token') + 5).trim();
          const result = await tbot.setBotToken?.(token, state.workspace).catch(error => ({ ok: false, error: String(error) }));
          notice(result?.ok ? 'Telegram bot tokenı kaydedildi. Başlatmak için /bot start yazın.' : `Token kaydedilemedi: ${escapeHtml(String(result?.error || 'bilinmeyen hata'))}`);
          break;
        }
        if (sub === 'allow') {
          const chatId = argument.slice(argument.toLowerCase().indexOf('allow') + 5).trim();
          const result = await tbot.allowBotChat?.(chatId).catch(error => ({ ok: false, error: String(error) }));
          notice(result?.ok ? `İzinli sohbet eklendi: ${escapeHtml(chatId)}` : `Sohbet eklenemedi: ${escapeHtml(String(result?.error || 'bilinmeyen hata'))}`);
          break;
        }
        if (sub === 'start') {
          const result = await tbot.startBot?.(state.workspace).catch(error => ({ ok: false, error: String(error) }));
          notice(result?.ok ? `Telegram botu aktif: @${escapeHtml(String(result.username || 'tbot'))}` : `Bot başlatılamadı: ${escapeHtml(String(result?.error || 'bilinmeyen hata'))}`);
          break;
        }
        if (sub === 'stop') {
          await tbot.stopBot?.().catch(() => undefined);
          notice('Telegram botu durduruldu.');
          break;
        }
        const status = await tbot.getBotStatus?.().catch(() => null);
        notice(status?.running
          ? `Telegram botu aktif: @${escapeHtml(String(status.username || 'tbot'))} · ${Number(status.handledCount || 0)} mesaj`
          : 'Telegram botu pasif. Başlatmak için /bot start, token için /bot token <TOKEN>.');
        break;
      }

      case '/imagegen': {
        if (!argument) {
          notice('Kullanım: /imagegen <istek>');
          break;
        }
        await submitUserMessage({ text: `/imagegen ${argument}`, display: `/imagegen ${argument}`, mode: 'agent' });
        break;
      }

      case '/mcp':
        await openMcpModal();
        break;

      case '/status': {
        showReport('Oturum Durumu', [
          `Sağlayıcı: **${escapeHtml(state.provider || '—')}** · Model: **${escapeHtml(state.model || '—')}** · Efor: **${escapeHtml(state.effort || '—')}**`,
          `Çalışma alanı: \`${escapeHtml(state.workspace || '—')}\``,
          `Oturum: \`${escapeHtml(state.currentSessionId || 'yeni')}\``,
          `Onay modu: **${state.yoloEnabled ? 'otomatik' : 'onaylı'}**`,
          `RAM: **${Number(state.telemetry.ramMB || 0)} MB** · Bağlam tasarrufu: **%${Number(state.telemetry.savingsPercent || 0)}** (${Number(state.telemetry.savedTokens || 0).toLocaleString('tr-TR')} tok)`,
        ]);
        break;
      }

      case '/plan': {
        if (!argument) {
          notice('Kullanım: /plan <istek> veya /plan apply');
          break;
        }
        if (argument.toLowerCase() === 'apply') {
          if (!state.pendingPlan) {
            notice('Uygulanacak plan yok. Önce /plan <istek> ile plan oluşturun.');
            break;
          }
          await submitUserMessage({ text: state.pendingPlanRequest, display: '/plan apply', mode: 'plan-apply', plan: state.pendingPlan });
          break;
        }
        await submitUserMessage({ text: argument, display: `/plan ${argument}`, mode: 'plan' });
        break;
      }

      case '/ultracode': {
        const toggle = argument.toLowerCase();
        if (!argument || toggle === 'on' || toggle === 'off') {
          state.ultracodeMode = toggle === 'on' ? true : toggle === 'off' ? false : !state.ultracodeMode;
          notice(`Ultracode modu: **${state.ultracodeMode ? 'açık' : 'kapalı'}**`);
          break;
        }
        await submitUserMessage({ text: argument, display: `/ultracode ${argument}`, mode: 'ultracode' });
        break;
      }

      case '/subagents': {
        if (!argument) {
          notice('Kullanım: /subagents <görev>');
          break;
        }
        await submitUserMessage({ text: argument, display: `/subagents ${argument}`, mode: 'subagents' });
        break;
      }

      case '/yolo':
        toggleYoloMode();
        appendAssistantTextChunk(`YOLO Modu: **${state.yoloEnabled ? 'Açık (Otomatik Onay)' : 'Kapalı (Onaylı)'}**`);
        finalizeAssistantMessage();
        break;

      case '/goal':
        if (argument) {
          if (dom.inputModalGoal) dom.inputModalGoal.value = argument;
          await startModalGoal();
        } else {
          const workflow = await tbot.getWorkflowState?.(state.workspace).catch(() => null);
          if (workflow?.goal?.status === 'active' || workflow?.goal?.status === 'paused') {
            showReport('Aktif Hedef', [
              escapeHtml(String(workflow.goal.objective || '')),
              `Durum: **${escapeHtml(String(workflow.goal.status))}**`,
              ...(Array.isArray(workflow.goal.notes) ? workflow.goal.notes.slice(0, 10).map(note => `Not: ${escapeHtml(String(note))}`) : []),
            ]);
          } else {
            notice('Aktif hedef yok. Yeni hedef için /goal <hedef> veya arayüzdeki “+ Hedef” düğmesini kullanın.');
          }
        }
        break;

      case '/ram':
      case '/gc':
        triggerTrimMemory();
        break;

      case '/doctor':
        runDoctorDiagnostics();
        break;

      case '/clear':
        void clearSession();
        break;

      case '/help': {
        let rows = state.commands.map(command => `\`${command.usage}\` — ${command.description}`);
        if (!rows.length) {
          const fallback = tbot.getCommandsHelp ? await tbot.getCommandsHelp().catch(() => '') : '';
          if (fallback) {
            appendAssistantTextChunk(`### T Bot Komut Kılavuzu\n\n\`\`\`\n${String(fallback)}\n\`\`\``);
            finalizeAssistantMessage();
            break;
          }
          rows = ['Komut kataloğu yüklenemedi. CLI/TUI üzerinde `/help` kullanın.'];
        }
        if (state.unavailableCommands.length) {
          rows.push('');
          rows.push(`Yalnızca CLI/TUI: ${state.unavailableCommands.map(command => command.name).join(', ')}`);
        }
        showReport('T Bot Komut Kılavuzu', rows);
        break;
      }

      case '/frontenddesign':
      case '/backend':
      case '/codereview':
      case '/debuganalysis': {
        if (!argument) {
          notice(`Kullanım: ${action} <istek>`);
          break;
        }
        await submitUserMessage({ text: `${action} ${argument}`, display: `${action} ${argument}`, mode: 'agent' });
        break;
      }

      default:
        appendAssistantTextChunk(`Bilinmeyen komut: \`${action || text}\`. Kullanılabilir komutları görmek için \`/help\` yazın.`);
        finalizeAssistantMessage();
        break;
    }
  }

  // =========================================================================
  // 15. RAM Boşaltma & Bellek Yönetimi
  // =========================================================================
  async function triggerTrimMemory() {
    if (dom.btnTrimRam) {
      dom.btnTrimRam.innerHTML = '<span class="action-icon">…</span> Boşaltılıyor…';
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
        dom.btnTrimRam.innerHTML = '<span class="action-icon">⌫</span> RAM';
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
    sessionHistory.sessionId = null;
    sessionHistory.total = 0;
    sessionHistory.loadedFrom = 0;
    sessionHistory.loading = false;
    state.pendingPlan = null;
    state.pendingPlanRequest = '';
    state.runMode = 'agent';
    showEmptyHeroIfEmpty();
  }

  function buildTranscriptEntries(messages) {
    const entries = [];
    const calls = new Map();
    for (const message of messages) {
      if (message.role === 'user') entries.push({ kind: 'user', text: message.content || '', images: message.images });
      if (message.role === 'assistant') {
        if (message.content) entries.push({ kind: 'assistant', text: message.content, textPage: 0 });
        for (const call of message.toolCalls || []) {
          const entry = { kind: 'tool', call, title: TOOL_TITLE_MAP[call.name] || toTurkishTitleCase(call.name), status: 'stopped' };
          calls.set(call.id, entry);
          entries.push(entry);
        }
      }
      if (message.role === 'tool') {
        let entry = calls.get(message.toolCallId);
        if (!entry) {
          entry = { kind: 'tool', call: { id: message.toolCallId, name: 'tool_result', arguments: {} }, title: 'Araç Sonucu' };
          entries.push(entry);
        }
        entry.result = message.content || '';
        entry.status = toolStatus(entry.result, entry.call.name);
      }
    }
    return entries;
  }

  function loadTranscriptMessages(messages) {
    transcriptEntries.push(...buildTranscriptEntries(messages));
    trimTranscriptEntries();
    if (transcriptEntries.length) hideEmptyHero();
    refreshTranscript();
    scrollToBottom(true);
  }

  function prependTranscriptMessages(messages) {
    const entries = buildTranscriptEntries(messages);
    if (!entries.length) return;
    transcriptEntries.unshift(...entries);
    trimTranscriptEntries();
    hideEmptyHero();
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
          <button class="session-btn-delete" title="Oturumu Sil" data-delete-session>×</button>
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
      if (typeof tbot.loadSessionMessages === 'function') {
        // Yalnızca en yeni sayfa IPC ile gelir; eskisi talep üzerine çekilir.
        const page = await tbot.loadSessionMessages(id, state.workspace, { offset: -1, limit: TRANSCRIPT_PAGE_SIZE });
        if (Array.isArray(page?.messages)) {
          loadTranscriptMessages(page.messages);
          sessionHistory.sessionId = id;
          sessionHistory.total = typeof page.total === 'number' ? page.total : page.messages.length;
          sessionHistory.loadedFrom = typeof page.offset === 'number' ? page.offset : 0;
        }
      } else {
        const data = await tbot.loadSession?.(id, state.workspace);
        if (Array.isArray(data?.messages)) loadTranscriptMessages(data.messages);
      }
    } catch (error) {
      appendErrorNotice(`Oturum yüklenemedi: ${String(error)}`);
    } finally {
      state.sessionLoading = false;
      setTurnControls();
    }
  }

  // /clear gerçek IPC ile oturumu boşaltır; hata olursa sessizce başarı gösterme.
  async function clearSession() {
    if (state.turnPending || state.sessionLoading) return;
    state.sessionLoading = true;
    setTurnControls();
    try {
      const res = await tbot.clearSession?.(state.currentSessionId || undefined, state.workspace);
      if (!res || res.ok === false || !res.session?.id) {
        throw new Error(res?.error || 'Oturum temizlenemedi.');
      }
      state.currentSessionId = res.session.id;
      clearChatTerminal();
      await loadSessionsList();
      applyApprovalPolicy();
    } catch (error) {
      appendErrorNotice(`Oturum temizlenemedi: ${error instanceof Error ? error.message : String(error)}`);
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
      dom.todosList.innerHTML = '<div class="empty-list-hint">Görev Maddesi Yok</div>';
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

  async function openMcpModal() {
    dom.mcpModal?.classList.remove('hidden');
    if (dom.inputMcpToken) dom.inputMcpToken.value = '';
    const data = await tbot.listMcp?.().catch(error => ({ error: String(error) }));
    if (data?.error) {
      appendErrorNotice(`MCP listesi alınamadı: ${data.error}`);
      return;
    }
    const presets = Array.isArray(data?.presets) ? data.presets : [];
    if (dom.selectMcpService) {
      dom.selectMcpService.replaceChildren(...presets.map(preset => {
        const option = document.createElement('option');
        option.value = String(preset.id);
        option.textContent = `${preset.label}${preset.enabled ? ' — bağlı' : ''}`;
        return option;
      }));
    }
    if (dom.mcpStatusList) {
      dom.mcpStatusList.innerHTML = presets.length
        ? presets.map(preset => `<div class="mcp-status-row"><span>${escapeHtml(String(preset.label || preset.id))}</span><span class="${preset.enabled ? 'mcp-on' : 'mcp-off'}">${preset.enabled ? (preset.hasToken ? 'bağlı' : 'token yok') : 'kapalı'}</span></div>`).join('')
        : '<div class="empty-list-hint">MCP servisi tanımlı değil.</div>';
    }
  }

  function closeMcpModal() {
    dom.mcpModal?.classList.add('hidden');
    if (dom.inputMcpToken) dom.inputMcpToken.value = '';
  }

  async function connectMcpFromModal() {
    const service = dom.selectMcpService?.value;
    const token = dom.inputMcpToken?.value?.trim() || '';
    if (!service) return;
    const result = await tbot.connectMcp?.(service, token || undefined, state.workspace).catch(error => ({ ok: false, error: String(error) }));
    if (!result?.ok) {
      appendErrorNotice(`MCP bağlantısı kurulamadı: ${result?.error || 'bilinmeyen hata'}`);
      return;
    }
    if (result.warning) appendTranscriptEntry({ kind: 'notice', text: String(result.warning), error: false });
    if (dom.inputMcpToken) dom.inputMcpToken.value = '';
    await openMcpModal();
  }

  async function removeMcpFromModal() {
    const service = dom.selectMcpService?.value;
    if (!service) return;
    const result = await tbot.removeMcp?.(service).catch(error => ({ ok: false, error: String(error) }));
    if (!result?.ok) {
      appendErrorNotice(`MCP bağlantısı kaldırılamadı: ${result?.error || 'bilinmeyen hata'}`);
      return;
    }
    await openMcpModal();
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
    appendAssistantTextChunk(`Yeni Hedef Başlatılıyor: **${text}**`);
    finalizeAssistantMessage();

    await tbot.manageWorkflow?.('goal_manage', { action: 'set', goal: text }, state.workspace);
    refreshWorkflow();

    if (dom.userInput) dom.userInput.value = text;
    await submitUserMessage({ goal: true });
  }

  // =========================================================================
  // 19. Olay Dinleyicileri (Event Listeners Setup)
  // =========================================================================
  function setSidebar(side, collapsed) {
    const panel = side === 'left' ? dom.sidebarLeft : dom.sidebarRight;
    if (!panel) return;
    panel.classList.toggle('collapsed', collapsed);
    const grid = typeof document.querySelector === 'function' ? document.querySelector('.workspace-grid') : null;
    grid?.classList.toggle(`${side}-collapsed`, collapsed);
    if (typeof document.querySelectorAll === 'function') {
      document.querySelectorAll(`[data-toggle-sidebar="${side}"]`).forEach(button => {
        button.setAttribute('aria-expanded', String(!collapsed));
        button.classList.toggle('is-active', !collapsed);
      });
    }
  }

  function toggleSidebar(side) {
    const panel = side === 'left' ? dom.sidebarLeft : dom.sidebarRight;
    if (!panel) return;
    setSidebar(side, !panel.classList.contains('collapsed'));
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
    const dialogs = [dom.configModal, dom.mcpModal, dom.doctorModal, dom.goalModal, dom.lightboxModal].filter(Boolean);
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

    // Pencere gizliyken gelen onay isteği, pencere öne geldiğinde görünür olsun.
    window.addEventListener('focus', () => {
      if (!state.currentApproval) return;
      const card = document.getElementById('live-approval-card');
      card?.scrollIntoView?.({ block: 'center' });
      card?.querySelector?.('#btn-approval-allow')?.focus?.();
    });

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
        applyApprovalPolicy();
      }
    });

    // 3. RAM Boşalt ve Tema Butonları
    dom.btnThemeToggle?.addEventListener('click', toggleTheme);
    dom.btnTrimRam?.addEventListener('click', triggerTrimMemory);

    // 4. Ultracode & YOLO & Hızlı Bar
    dom.btnQuickYolo?.addEventListener('click', toggleYoloMode);
    dom.btnQuickConfig?.addEventListener('click', openConfigModal);
    dom.btnQuickDoctor?.addEventListener('click', runDoctorDiagnostics);
    dom.btnQuickClear?.addEventListener('click', () => void clearSession());
    const primeMode = (prefix) => {
      if (state.turnPending || state.sessionLoading) return;
      if (dom.userInput) {
        dom.userInput.value = prefix;
        dom.userInput.focus();
        autoResizeTextarea();
      }
    };
    dom.btnQuickPlan?.addEventListener('click', () => primeMode('/plan '));
    dom.btnQuickUltracode?.addEventListener('click', () => primeMode('/ultracode '));
    dom.btnQuickSubagents?.addEventListener('click', () => primeMode('/subagents '));

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
        } else if (handleEscape()) {
          // Aynı guard: onay açıkken yalnız onay reddedilir, tur iptal edilmez.
          e.stopPropagation();
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
    // The palette is rebuilt from the shared command catalog after startup.
    // Delegate clicks on the container so replaced items keep working.
    dom.paletteItems?.addEventListener('click', (event) => {
      const item = event.target?.closest?.('.palette-item');
      const cmd = item?.getAttribute('data-cmd');
      if (cmd) handleSlashCommand(cmd);
      closeCommandPalette();
    });

    // 14. Modallar & Lightbox Kapatma
    dom.lightboxBtnClose?.addEventListener('click', closeLightbox);
    dom.lightboxBackdrop?.addEventListener('click', closeLightbox);

    dom.modalBtnCloseConfig?.addEventListener('click', closeConfigModal);
    dom.modalBtnCancelConfig?.addEventListener('click', closeConfigModal);
    dom.modalBtnSaveAllConfig?.addEventListener('click', saveAllConfig);
    dom.selectProvider?.addEventListener('change', (e) => updateModelDropdown(e.target?.value));

    dom.modalBtnCloseMcp?.addEventListener('click', closeMcpModal);
    dom.modalBtnConnectMcp?.addEventListener('click', connectMcpFromModal);
    dom.modalBtnRemoveMcp?.addEventListener('click', removeMcpFromModal);

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
        const result = await tbot.setApiKey?.(prov, key);
        if (result?.error) throw new Error(result.error);
        dom.inputApiKey.value = '';
        dom.inputApiKey.type = 'password';
        dom.inputApiKey.placeholder = 'Anahtar kaydedildi';
        if (result?.warning) appendTranscriptEntry({ kind: 'notice', text: String(result.warning), error: false });
        await updateModelDropdown(prov);
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
        if (state.currentApproval) { handleEscape(); return; }
        if (closeTopmostOverlay()) return;
        handleEscape();
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

      case 'tool_end': {
        handleToolEnd(event.call, event.result, event.toolTitle);
        // Görev Pusulası'nı canlı tut: workflow araçları bitince hemen yenile.
        const toolName = event.call?.name;
        if (toolName === 'todo_manage' || toolName === 'goal_manage') void refreshWorkflow();
        break;
      }

      case 'status': {
        const msg = event.message || '';
        updateThinkingLabel(msg);

        // Otonom Hedef [Adım X/Y]
        const goalMatch = msg.match(/Otonom Hedef\s*\[Adım\s*(\d+)\s*\/\s*(\d+)\]/i);
        if (goalMatch) {
          state.currentStepCount = parseInt(goalMatch[1], 10);
          void refreshWorkflow();
        } else if (/Otonom Hedef\s*\[(?:Tamamlandı|Hedef)/i.test(msg)) {
          void refreshWorkflow();
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
      finishApprovalCard('Onay zaman aşımı (120 sn): işlem güvenli şekilde reddedildi.');
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
    setSidebar('left', false);
    setSidebar('right', false);
    if (window.innerWidth < 1080) setSidebar('right', true);
    if (window.innerWidth < 760) setSidebar('left', true);

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
      if (initial?.requiresApiKey && initial?.hasApiKey === false) {
        appendTranscriptEntry({ kind: 'notice', text: 'Sağlayıcı API anahtarı yapılandırılmamış. Ayarlar açılıyor; anahtar olmadan ajan turu başlatılamaz.', error: false });
        openConfigModal();
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

    await loadCommandMetadata();
    updateHudBar();
    updateApprovalModeDisplay();
    loadSessionsList();
    refreshWorkflow();
    applyApprovalPolicy();
  }

  // DOM Yüklendiğinde Başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
