import { levelConfig } from "./game.js";

const arrowDown =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v17m-7-7 7 7 7-7" stroke="currentColor" stroke-width="1.7"/></svg>';
const arrowRight =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12h17m-7-7 7 7-7 7" stroke="currentColor" stroke-width="1.7"/></svg>';
const numberFormat = new Intl.NumberFormat("uk-UA");
const clamp = (value, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number(value) || 0));
const gradeCopy = {
  S: "Майстерність без гальм.",
  A: "Близько до рук. Далеко від обіймів.",
  B: "Впевнено вниз. Додай трохи ризику.",
  C: "Земля твоя. Тепер лети зі стилем.",
};

export class GameUI {
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.mode = null;
    this.lastNearMisses = 0;
    this.toastTimer = null;
    this.comboTimer = null;
    this.focusReturn = null;
    this.selectedLevel = 1;
    this.latestUnlockedLevel = null;
    this.touchControls = window.matchMedia("(hover: none), (max-width: 760px)");

    root.innerHTML = `
      <div class="left-veil" aria-hidden="true"></div>
      <header class="masthead">
        <button class="brand" data-action="menu" aria-label="RAIN / PAIN — головний екран">
          <svg class="brand-mark" viewBox="0 0 38 38" fill="none" aria-hidden="true"><path d="m7 4-4 9m15-9-4 9m15-9-4 9M19 17v15m-6-6 6 6 6-6" stroke="currentColor" stroke-width="2"/></svg>
          <span>RAIN <span class="brand-slash">/</span> PAIN<small>THE ART OF FALLING</small></span>
        </button>
        <span class="header-edition">БРАУЗЕРНА АРКАДА <span>VOL. 01 / 2026</span></span>
        <nav class="utilities" aria-label="Налаштування гри">
          <button class="utility-button sound-button" data-action="mute" data-ref="sound" aria-pressed="false" aria-label="Вимкнути звук">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.5"/><path class="sound-wave" d="M15 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14" stroke="currentColor" stroke-width="1.5"/><path class="sound-slash" d="m15 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5"/></svg>
            <span data-ref="soundLabel">ЗВУК ON</span>
          </button>
          <button class="utility-button motion-button" data-action="motion" data-ref="motion" aria-pressed="false" aria-label="Зменшити рух та спалахи"><span class="motion-glyph" aria-hidden="true">≋</span><span data-ref="motionLabel">РУХ ON</span></button>
          <button class="utility-button pause-button" data-action="pause" data-ref="pauseButton" aria-label="Пауза" hidden><span aria-hidden="true">Ⅱ</span></button>
        </nav>
      </header>

      <section class="menu-screen" data-ref="menuScreen" aria-labelledby="game-title">
        <div class="hero-copy">
          <p class="eyebrow"><span class="signal-dot"></span> ПРОГНОЗ: ВІЛЬНЕ ПАДІННЯ</p>
          <h1 id="game-title" class="hero-title"><span class="rain-word">RAIN<span class="title-star" aria-hidden="true">✳</span></span><span class="pain-line"><span class="title-slash" aria-hidden="true">/</span><span>PAIN<span class="title-period">.</span></span></span></h1>
          <p class="hero-description">Падай крізь дощ.<br>Ухиляйся від чужих рук.<span class="objective-line">Мета — земля. Обійми — програш.</span></p>
          <div class="start-row"><button id="start-button" class="primary-button start-button" data-action="start"><span>Почати падіння</span>${arrowDown}</button><div class="attempt-note"><span data-ref="menuLevel">ВЕЖА 01</span><span data-ref="menuFloors">18 ПОВЕРХІВ</span><div class="tower-selector" aria-label="Вибрати відкриту вежу"><button data-action="prevLevel" data-ref="prevLevel" aria-label="Попередня вежа">←</button><span data-ref="towerPosition">01 / 01</span><button data-action="nextLevel" data-ref="nextLevel" aria-label="Наступна вежа">→</button></div></div></div>
          <p class="tower-record"><span>РЕКОРД ВЕЖІ</span><strong data-ref="menuTowerScore">ЩЕ ПОПЕРЕДУ</strong><span class="mini-grade" data-ref="menuTowerGrade" hidden></span></p>
          <div class="how-to" aria-label="Керування">
            <div><span class="key-pair"><kbd>A</kbd><kbd>D</kbd><span class="key-alternative">/ ← →</span></span><span>ухиляйся</span></div>
            <div><kbd class="wide-key">SPACE</kbd><span>ривок</span></div>
            <div><kbd class="wide-key">SHIFT</kbd><span>сповільни час</span></div>
          </div>
          <p class="touch-instruction">Веди пальцем, щоб ухилятися. Ривок і фокус — унизу.</p>
        </div>
        <aside class="scene-caption"><span class="caption-rule" aria-hidden="true"></span><div><p><span class="caption-kicker">ПЕРЕСЛІДУВАЧ</span>Стежить → спалах → зміни курс.</p><p class="risk-caption"><span class="risk-dot" aria-hidden="true"></span>Коралова крапля: більше очок + фокус.</p></div><span class="caption-arrow" aria-hidden="true">↙</span></aside>
        <section class="landing-style" aria-labelledby="landing-style-label" data-ref="landingStyle" data-impact-mode="arcade">
          <p id="landing-style-label" class="landing-style-label">СТИЛЬ ФІНАЛУ</p>
          <div class="landing-style-options" role="group" aria-labelledby="landing-style-label" aria-describedby="landing-style-description">
            <button class="landing-style-button" data-action="modeArcade" data-ref="modeArcade" aria-pressed="true"><span class="mode-mark" aria-hidden="true">◌</span>Аркадний</button>
            <button class="landing-style-button" data-action="modeHard" data-ref="modeHard" aria-pressed="false"><span class="mode-mark" aria-hidden="true">×</span>Жорсткий</button>
          </div>
          <p id="landing-style-description" class="landing-style-description" data-ref="impactModeDescription" aria-live="polite">Спалах і дощові кола</p>
        </section>
        <aside class="menu-record"><span class="record-icon" aria-hidden="true">↗</span><span>ТВІЙ РЕКОРД<strong data-ref="menuBest">0</strong></span></aside>
        <div class="menu-location"><span class="location-cross" aria-hidden="true">+</span><span>KYIV, UA<br><span class="location-muted">00:17 / RAIN EXPECTED</span></span></div>
      </section>

      <section class="intro-screen" data-ref="introScreen" aria-label="Стартова сцена на даху" hidden>
        <div class="intro-caption"><p class="intro-eyebrow">ВЕЖА <span data-ref="introLevel">01</span> · ДАХ</p><h2 data-ref="introName">Тихий район</h2><p>Місто ще спить. Дощ уже почався.</p></div>
        <button class="intro-skip" data-action="skipIntro" data-ref="skipIntroButton" aria-label="Пропустити стартову сцену — пробіл"><span>Пропустити</span><kbd>SPACE</kbd><span class="intro-skip-arrow" aria-hidden="true">↘</span></button>
      </section>

      <section class="game-hud" data-ref="hud" aria-label="Стан гри" hidden>
        <div class="hud-readout">
          <div class="level-readout"><span class="micro-label">РІВЕНЬ <span data-ref="levelNumber">01</span></span><strong data-ref="levelName">Тихий район</strong></div>
          <span class="hud-divider" aria-hidden="true"></span>
          <div class="floor-readout"><span class="micro-label">ДО ЗЕМЛІ</span><strong><span data-ref="remainingFloors">30</span><span class="floor-unit"> ПОВ.</span></strong></div>
          <span class="hud-divider score-divider" aria-hidden="true"></span>
          <div class="score-readout"><span class="micro-label">ОЧКИ</span><strong data-ref="score">0</strong></div>
        </div>
        <div class="descent-meter" aria-label="Прогрес падіння"><span class="meter-roof">ДАХ</span><div class="descent-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-ref="descentProgress"><span class="descent-fill" data-ref="descentFill"></span><span class="descent-pointer" data-ref="descentPointer"></span></div><span class="meter-ground">ЗЕМЛЯ</span><span class="descent-percent" data-ref="progressPercent">0%</span></div>
        <div class="combo-flash" data-ref="comboFlash" aria-live="polite"><strong data-ref="comboNumber">×2</strong><span>НА МЕЖІ</span></div>
        <div class="flight-status"><span class="status-dot" aria-hidden="true"></span><span data-ref="windLabel">ТИХИЙ ВІТЕР</span><span class="flight-speed"><span data-ref="speed">11</span> м/с</span></div>
        <p class="tutorial-hint" data-ref="tutorialHint" role="status" aria-live="polite" hidden></p>
        <div class="ability-controls">
          <button class="ability-button dash-ability" data-action="dash" data-ref="dashButton" aria-label="Ривок — пробіл"><span class="ability-top"><span class="ability-symbol" aria-hidden="true">↯</span><span>РИВОК</span><kbd>SPACE</kbd></span><span class="ability-meter"><span data-ref="dashFill"></span></span><span class="ability-state" data-ref="dashState">ГОТОВО</span></button>
          <button class="ability-button focus-ability" data-action="slow" data-ref="focusButton" aria-label="Утримувати для сповільнення часу — Shift"><span class="ability-top"><span class="ability-symbol focus-symbol" aria-hidden="true">◎</span><span>ФОКУС</span><kbd>SHIFT</kbd></span><span class="ability-meter"><span data-ref="focusFill"></span></span><span class="ability-state" data-ref="focusState">65%</span></button>
        </div>
        <div class="touch-movement" aria-label="Рух персонажа"><button class="touch-direction" data-action="left" aria-label="Рух ліворуч">←</button><button class="touch-direction" data-action="right" aria-label="Рух праворуч">→</button></div>
        <p class="game-help">A / D — РУХ <span>ESC — ПАУЗА</span></p>
      </section>

      <div class="overlay-screen" data-ref="pauseScreen" hidden>
        <section class="pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-ref="pauseDialog">
          <p class="eyebrow"><span class="signal-dot"></span> ГРАВІТАЦІЯ ЗАЧЕКАЄ</p>
          <h2 id="pause-title">Затримай<br>дихання<span class="yellow-period">.</span></h2>
          <p class="panel-description">Дощ нікуди не поспішає. Ти теж можеш.</p>
          <button class="primary-button resume-button" data-action="resume"><span>Продовжити</span>${arrowDown}</button>
          <button class="text-button pause-menu" data-action="menu">На головну <span aria-hidden="true">↗</span></button>
          <span class="pause-escape">ESC / ПОВЕРНУТИСЯ В ДОЩ</span>
        </section>
      </div>

      <div class="overlay-screen result-overlay" data-ref="resultScreen" hidden>
        <section class="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title" data-ref="resultDialog">
          <div class="result-topline"><p class="eyebrow"><span class="signal-dot"></span><span data-ref="resultEyebrow">ІДЕАЛЬНЕ ПАДІННЯ</span></p><span class="result-level" data-ref="resultLevel">LEVEL 01 / COMPLETE</span></div>
          <h2 id="result-title" data-ref="resultTitle"><span data-ref="resultLine1">На вулиці rain — </span><span data-ref="resultLine2">на душі pain</span></h2>
          <div class="result-description-row"><p class="panel-description result-description" data-ref="resultDescription">Приземлення гучне. Наступний будинок вищий.</p><span class="new-best-stamp" data-ref="newBest" hidden>НОВИЙ<br>РЕКОРД ↗</span></div>
          <p class="result-impact-mode" data-ref="resultImpactMode" data-impact-mode="arcade">АРКАДНИЙ ФІНАЛ</p>
          <div class="result-performance" data-ref="resultPerformance" hidden><span class="grade-badge" data-ref="gradeBadge" aria-label="Оцінка стилю польоту"><strong data-ref="resultGrade">C</strong><span>СТИЛЬ</span></span><div class="grade-description"><p data-ref="gradeDescription">Земля твоя. Тепер лети зі стилем.</p><span>БЛИЗЬКІ ПРОЛЬОТИ · РИЗИКОВІ КРАПЛІ · КОМБО</span></div></div>
          <dl class="result-stats"><div class="result-score-stat"><dt>ОЧКИ</dt><dd data-ref="resultScore">0</dd></div><div><dt>НА МЕЖІ</dt><dd data-ref="resultNear">0</dd></div><div><dt>КРАПЛІ</dt><dd data-ref="resultDrops">0</dd></div><div class="risk-stat"><dt>З НИХ РИЗИКОВІ</dt><dd data-ref="resultRiskDrops">0</dd></div><div><dt>КОМБО</dt><dd data-ref="resultCombo">×0</dd></div><div><dt>ЧАС</dt><dd data-ref="resultTime">0.0<span>с</span></dd></div></dl>
          <p class="result-tower-record"><span data-ref="resultRecordLabel">РЕКОРД ЦІЄЇ ВЕЖІ</span><strong data-ref="resultTowerScore">0</strong><span class="mini-grade" data-ref="resultTowerGrade" hidden></span></p>
          <div class="result-actions"><button id="next-button" class="primary-button" data-action="next" data-ref="nextButton"><span>Вище. Ще вище.</span>${arrowRight}</button><button id="retry-button" class="secondary-button" data-action="retry" data-ref="retryButton"><span>Ще одне падіння</span><span aria-hidden="true">↻</span></button><button class="text-button result-menu" data-action="menu">На головну <span aria-hidden="true">↗</span></button></div>
          <p class="result-footnote" data-ref="resultFootnote">ДОЩ ТРИВАЄ. РІВЕНЬ ЗРОСТАЄ.</p>
        </section>
      </div>

      <footer class="city-strip"><span><span class="footer-dot" aria-hidden="true"></span> KYIV AFTER DARK</span><span class="footer-weather">ДОЩ: 100% <span>НАСТРІЙ: МІНЛИВИЙ</span></span><span class="footer-signature">MADE TO FALL <span aria-hidden="true">↘</span></span></footer>
      <div class="toast-message" data-ref="toast" role="status" aria-live="polite"></div>
    `;

    this.refs = Object.fromEntries(
      [...root.querySelectorAll("[data-ref]")].map((element) => [
        element.dataset.ref,
        element,
      ]),
    );
    this.bindActions();
    this.keyHandler = (event) => this.trapFocus(event);
    root.addEventListener("keydown", this.keyHandler);
    window.addEventListener("blur", () => this.releaseHeldActions());
  }

  text(name, value) {
    const text = String(value);
    if (this.refs[name].textContent !== text)
      this.refs[name].textContent = text;
  }

  bindActions() {
    for (const button of this.root.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;
      if (action === "slow" || action === "left" || action === "right") {
        this.bindHold(button, action);
      } else {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (action === "prevLevel" || action === "nextLevel") {
            this.selectedLevel = Math.max(
              1,
              Math.min(
                this.latestUnlockedLevel || 1,
                this.selectedLevel + (action === "prevLevel" ? -1 : 1),
              ),
            );
            this.updateMenu(this.menuState);
          } else if (action === "start") {
            this.actions.start?.(this.selectedLevel);
          } else if (action === "modeArcade" || action === "modeHard") {
            if (this.mode === "menu")
              this.actions.impactMode?.(action === "modeHard" ? "hard" : "arcade");
          } else {
            this.actions[action]?.();
          }
        });
      }
    }
  }

  bindHold(button, action) {
    const hold = () => {
      if (button.disabled || this.mode !== "playing") return;
      button.dataset.held = "true";
      if (action === "slow") this.actions.slow?.(true);
      else this.actions.move?.(action === "left" ? -1 : 1);
    };
    const release = () => {
      if (button.dataset.held !== "true") return;
      button.dataset.held = "false";
      if (action === "slow") this.actions.slow?.(false);
      else this.actions.move?.(0);
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.setPointerCapture?.(event.pointerId);
      hold();
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("keydown", (event) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) hold();
    });
    button.addEventListener("keyup", (event) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      release();
    });
    button.addEventListener("blur", release);
  }

  releaseHeldActions() {
    for (const button of this.root.querySelectorAll('[data-held="true"]'))
      button.dataset.held = "false";
    this.actions.slow?.(false);
    this.actions.move?.(0);
  }

  trapFocus(event) {
    if (event.key !== "Tab" || !this.modal) return;
    const buttons = [
      ...this.modal.querySelectorAll("button:not([disabled])"),
    ].filter((button) => !button.hidden);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  setMode(mode, resumeMode) {
    if (this.mode === mode && this.resumeMode === resumeMode) return;
    const previous = this.mode;
    this.mode = mode;
    this.resumeMode = resumeMode;
    const sceneMode = mode === "paused" ? resumeMode || "playing" : mode;
    this.root.dataset.mode = mode;
    this.root.dataset.sceneMode = sceneMode;
    this.refs.menuScreen.hidden = mode !== "menu";
    this.refs.introScreen.hidden = sceneMode !== "intro";
    this.refs.skipIntroButton.disabled = mode !== "intro";
    this.refs.hud.hidden = !["playing", "paused", "caught", "impact"].includes(
      mode,
    ) || sceneMode === "intro";
    this.refs.pauseScreen.hidden = mode !== "paused";
    this.refs.resultScreen.hidden = mode !== "result";
    this.refs.pauseButton.hidden = mode !== "playing" && mode !== "intro";
    this.root.classList.toggle(
      "cinematic",
      mode === "caught" || mode === "impact",
    );
    if (mode !== "playing") this.releaseHeldActions();

    const modal =
      mode === "paused"
        ? this.refs.pauseDialog
        : mode === "result"
          ? this.refs.resultDialog
          : null;
    if (modal) {
      if (!this.modal) this.focusReturn = document.activeElement;
      this.modal = modal;
      requestAnimationFrame(() => {
        if (this.mode !== mode) return;
        modal
          .querySelector("button:not([hidden]):not([disabled])")
          ?.focus({ preventScroll: true });
      });
    } else {
      this.modal = null;
      if (mode === "menu" && previous) {
        this.root
          .querySelector('[data-action="start"]')
          ?.focus({ preventScroll: true });
      } else if (previous === "paused") {
        this.focusReturn?.focus?.({ preventScroll: true });
      } else if (mode === "intro") {
        requestAnimationFrame(() => {
          if (this.mode === "intro")
            this.refs.skipIntroButton.focus({ preventScroll: true });
        });
      } else if (mode === "playing") {
        document.activeElement?.blur?.();
      }
    }
  }

  update(state) {
    const mode = state.mode || "menu";
    const progress = clamp(state.progress);
    const focus = clamp(state.focus);
    const cooldown = Math.max(0, Number(state.dashCooldown) || 0);
    const level = Math.max(1, Number(state.level) || 1);
    const levelNumber = String(level).padStart(2, "0");
    const score = Math.max(0, Math.round(state.score || 0));

    this.root.classList.toggle("reduced-motion", Boolean(state.reducedMotion));
    this.refs.sound.setAttribute("aria-pressed", String(Boolean(state.muted)));
    this.refs.sound.setAttribute(
      "aria-label",
      state.muted ? "Увімкнути звук" : "Вимкнути звук",
    );
    this.refs.sound.dataset.muted = String(Boolean(state.muted));
    this.text("soundLabel", state.muted ? "ЗВУК OFF" : "ЗВУК ON");
    this.refs.motion.setAttribute(
      "aria-pressed",
      String(Boolean(state.reducedMotion)),
    );
    this.refs.motion.setAttribute(
      "aria-label",
      state.reducedMotion
        ? "Увімкнути повні анімації"
        : "Зменшити рух та спалахи",
    );
    this.text("motionLabel", state.reducedMotion ? "РУХ OFF" : "РУХ ON");
    this.text(
      "menuBest",
      numberFormat.format(Math.round(state.bestScore || 0)),
    );
    this.updateMenu(state);
    this.text("levelNumber", levelNumber);
    this.text("levelName", state.levelName || "Чужі вікна");
    this.text("introLevel", levelNumber);
    this.text("introName", state.levelName || "Чужі вікна");
    this.text(
      "remainingFloors",
      Math.max(0, Math.ceil((state.floors || 0) * (1 - progress))),
    );
    this.text("score", numberFormat.format(score));
    this.text("progressPercent", `${Math.round(progress * 100)}%`);
    this.refs.descentProgress.setAttribute(
      "aria-valuenow",
      String(Math.round(progress * 100)),
    );
    this.refs.descentFill.style.transform = `scaleY(${progress})`;
    this.refs.descentPointer.style.top = `${progress * 100}%`;
    this.refs.dashFill.style.transform = `scaleX(${clamp(1 - cooldown / 1.65)})`;
    this.refs.dashButton.disabled = cooldown > 0 || mode !== "playing";
    this.refs.focusButton.disabled = mode !== "playing";
    this.refs.focusButton.classList.toggle("is-active", Boolean(state.slow));
    this.refs.focusFill.style.transform = `scaleX(${focus})`;
    this.text(
      "dashState",
      cooldown > 0 ? `${cooldown.toFixed(1)} с` : "ГОТОВО",
    );
    this.text(
      "focusState",
      state.slow ? "ЧАС У ТВОЇХ РУКАХ" : `${Math.round(focus * 100)}%`,
    );
    const fallSpeed = Number(state.fallSpeed ?? state.speed);
    this.text("speed", Math.round(Number.isFinite(fallSpeed) ? fallSpeed : 0));
    let hint = mode === "playing" ? state.tutorialHint || "" : "";
    if (this.touchControls.matches && hint.startsWith("A / D"))
      hint = "Веди пальцем — обирай траєкторію";
    this.text("tutorialHint", hint);
    this.refs.tutorialHint.hidden = !hint;
    this.refs.tutorialHint.dataset.phase =
      state.launchProgress < 1 ? "launch" : "flight";
    const wind = Number(state.wind) || 0;
    this.text(
      "windLabel",
      Math.abs(wind) < 0.4
        ? "ТИХИЙ ВІТЕР"
        : wind < 0
          ? "← ПОРИВИ ВІТРУ"
          : "ПОРИВИ ВІТРУ →",
    );

    if (
      mode === "playing" &&
      (state.combo || 0) > 1 &&
      (state.nearMisses || 0) > this.lastNearMisses
    ) {
      this.text("comboNumber", `×${state.combo}`);
      this.refs.comboFlash.classList.remove("is-visible");
      void this.refs.comboFlash.offsetWidth;
      this.refs.comboFlash.classList.add("is-visible");
      clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(
        () => this.refs.comboFlash.classList.remove("is-visible"),
        1300,
      );
    }
    this.lastNearMisses = state.nearMisses || 0;

    if (mode === "result") this.updateResult(state);
    this.setMode(mode, state.resumeMode);
  }

  updateMenu(state) {
    if (!state) return;
    this.menuState = state;
    const hard = state.impactMode === "hard";
    this.refs.landingStyle.dataset.impactMode = hard ? "hard" : "arcade";
    this.refs.modeArcade.setAttribute("aria-pressed", String(!hard));
    this.refs.modeHard.setAttribute("aria-pressed", String(hard));
    this.text("impactModeDescription", hard ? "Ragdoll і кров" : "Спалах і дощові кола");
    const unlocked = Math.max(1, Number(state.unlockedLevel) || 1);
    if (this.latestUnlockedLevel !== unlocked) this.selectedLevel = unlocked;
    this.latestUnlockedLevel = unlocked;
    this.selectedLevel = Math.max(1, Math.min(unlocked, this.selectedLevel));
    const selected = levelConfig(this.selectedLevel);
    const levelLabel = String(selected.level).padStart(2, "0");
    this.text("menuLevel", `ВЕЖА ${levelLabel}`);
    this.text("menuFloors", `${selected.floors} ПОВЕРХІВ`);
    this.text("towerPosition", `${levelLabel} / ${String(unlocked).padStart(2, "0")}`);
    this.refs.prevLevel.disabled = this.selectedLevel <= 1;
    this.refs.nextLevel.disabled = this.selectedLevel >= unlocked;
    const record = state.levelRecords?.[selected.level];
    this.text(
      "menuTowerScore",
      record ? numberFormat.format(Math.round(record.score || 0)) : "ЩЕ ПОПЕРЕДУ",
    );
    const grade = record?.grade in gradeCopy ? record.grade : "";
    this.text("menuTowerGrade", grade);
    this.refs.menuTowerGrade.hidden = !grade;
  }

  updateResult(state) {
    const result = state.lastResult || state;
    const won = state.outcome === "win";
    const hard = (result.runImpactMode ?? state.runImpactMode) === "hard";
    this.refs.resultImpactMode.dataset.impactMode = hard ? "hard" : "arcade";
    this.text("resultImpactMode", hard ? "ЖОРСТКИЙ ФІНАЛ" : "АРКАДНИЙ ФІНАЛ");
    this.refs.resultImpactMode.hidden = !won;
    this.refs.resultDialog.classList.toggle("is-win", won);
    this.refs.resultDialog.classList.toggle("is-caught", !won);
    this.text("resultEyebrow", won ? "ІДЕАЛЬНЕ ПАДІННЯ" : "ТЕБЕ СПІЙМАЛИ");
    this.text(
      "resultLevel",
      `LEVEL ${String(result.level || state.level || 1).padStart(2, "0")} / ${won ? "COMPLETE" : "TRY AGAIN"}`,
    );
    this.text("resultLine1", won ? "На вулиці rain — " : "Обійми? ");
    this.text("resultLine2", won ? "на душі pain" : "Не цього разу.");
    this.text(
      "resultDescription",
      won
        ? "Приземлення гучне. Наступний будинок вищий."
        : "Чужі руки зіпсували траєкторію. Дощ дає ще одну спробу.",
    );
    this.text(
      "resultScore",
      numberFormat.format(Math.round(result.score || 0)),
    );
    this.text("resultNear", result.nearMisses || 0);
    this.text("resultDrops", result.drops || 0);
    this.text("resultRiskDrops", result.riskDrops || 0);
    this.text("resultCombo", `×${result.bestCombo || 0}`);
    this.text("resultTime", `${(Number(result.elapsed) || 0).toFixed(1)} с`);
    const grade = won && result.grade in gradeCopy ? result.grade : "";
    this.refs.resultPerformance.hidden = !grade;
    this.text("resultGrade", grade);
    this.text("gradeDescription", gradeCopy[grade] || "");
    this.refs.gradeBadge.dataset.grade = grade;
    this.refs.gradeBadge.setAttribute("aria-label", `Оцінка стилю польоту ${grade}`);
    const record = state.levelRecords?.[result.level || state.level];
    const recordScore = result.levelBestScore ?? record?.score ?? 0;
    this.text("resultTowerScore", numberFormat.format(Math.round(recordScore)));
    this.text(
      "resultRecordLabel",
      result.newLevelBest ? "НОВИЙ РЕКОРД ЦІЄЇ ВЕЖІ ↗" : "РЕКОРД ЦІЄЇ ВЕЖІ",
    );
    const bestGrade = record ? record.grade : result.grade;
    const recordGrade = bestGrade in gradeCopy ? bestGrade : "";
    this.text("resultTowerGrade", recordGrade);
    this.refs.resultTowerGrade.hidden = !recordGrade;
    this.refs.newBest.hidden = !result.newBest;
    this.refs.nextButton.hidden = !won;
    this.refs.retryButton.className = won
      ? "secondary-button"
      : "primary-button";
    this.text(
      "resultFootnote",
      won ? "ДОЩ ТРИВАЄ. РІВЕНЬ ЗРОСТАЄ." : "НЕ КОЖНІ ОБІЙМИ ВАРТО ПРИЙМАТИ.",
    );
  }

  toast(message, kind = "info") {
    clearTimeout(this.toastTimer);
    this.refs.toast.textContent = message;
    this.refs.toast.dataset.kind = kind;
    this.refs.toast.classList.add("is-visible");
    this.toastTimer = setTimeout(
      () => this.refs.toast.classList.remove("is-visible"),
      2400,
    );
  }
}
