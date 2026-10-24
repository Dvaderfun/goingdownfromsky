# Ітерація 05 — стартова катсцена

Користувач бачить початок уже в польоті. Замість короткого декоративного launch створюємо окремий intro: героїня стоїть на даху, робить крок до краю, відштовхується, а камера переходить до польоту. Симуляція падіння починається після завершення сцени.

## Ownership

- Root: src/game.js, src/main.js, package/lock, AGENTS/contracts, документи та публікація Pages.
- Scene worker: лише src/scene.js.
- UI/audio worker: лише src/ui.js, src/style.css, src/audio.js.
- Tests worker: tests/game.test.js, scripts/render-regression.mjs, scripts/browser-smoke.mjs, scripts/verify-pages.mjs.

## Контракт

`INTRO_DURATION=3.2`. `RainGame.start(level,seed,options={})` за замовчуванням запускає mode='intro'; `{skipIntro:true}` призначений для ізольованих тестів/scene fixtures. State: `introTime` 0..3.2, `introProgress` 0..1, `introStage`: roof(0–0.8s), approach(0.8–1.7), jump(1.7–2.5), transition(2.5–3.2), complete. `distance`, `elapsed`, `score`, focus і cooldown не змінюються в intro. Inputs move/point/dash/slow не діють до playing. `launchProgress` відображає introProgress і дорівнює 1 після intro: не робити другий 0.8s декоративний стрибок після катсцени.

`game.skipIntro()` і UI `actions.skipIntro()` (data-action="skipIntro") переводять поточний intro в playing з нульовою дистанцією/часом/очками й очищеними inputs. Space/Enter поза кнопками та skip-кнопка пропускають. Escape/P ставлять на паузу intro або playing; `resumeMode` у paused зберігає попередній mode для коректного resume і renderer кадру. Blur/hidden також пауза. Skip кнопка доступна тільки intro. Пауза не просуває introTime чи камеру. Menu/retry/next скидають стан intro й тіла hard landing.

Подія `takeoff` один раз при переході в jump; skip до jump також може запустити один takeoff. Root не змінює impactMode, paired NPC, physics або scoring.

## Renderer

Окрема композиція даху: перші 0.8с чітко видно героїню з ногами на даху й край перед нею, потім короткий крок і дуга стрибка за передній край. Візуальний дах має roofY≈−0.6 (верх плити≈−0.275), ноги героїні відповідають його висоті. Можна поставити її в roof-local z≈1.5 і довести до z≈2.45, край плити z=2.8; стрибок переходить до z=3. Камера крупніша й під кутом, щоб глибина даху/край читалися. У transition дах піднімається до звичного9.7, камера плавно повертається до gameplay view, а позиція персонажа закінчує точно (0,1.2,3). Інтерполяції зі state.introProgress, без випадкових стрибків або накопиченого часу renderer. Paused+resumeModeintro відтворює той самий кадр, game.skipIntro відразу встановлює нормальне кадрування.

Перед playing не показувати HUD керування польотом/руки-пастки; можна показати назву вежі й короткий текст сцени з кнопкою Пропустити / Space. Reduced motion зберігає зміст, прибирає розгойдування камери. Old archived0.2.1 не змінюється. Рендеринг у hard mode не запускає кров/rig у intro.

## Перевірки

Node: intro default/skip/clock freeze, inputs blocked, takeoff once, natural completion, pause/resume/menu/retry, snapshot hardmode. Старі game тестують gameplay з skipIntro=true. Browser: реально спостерігати roof→jump→playing, distance=0 у сцені, skip/key/touch, pause duringintro, потім попередні ігрові режими. Pages: новий сайт intro, archive стара негайна playing. Render: явні introStages, roof grounding/frame coverage, finite matrices, pause/no camera advancement, skip exactgameplay position; всі старі154 збережені.

## Локальні результати 0.4.0

Пройдено 40 Node-тестів, 178 графічних сценаріїв, production build, послідовний повний browser smoke та перевірку production під Pages prefix. Intro показує фактичні ноги на даху й відрив за край; у паузі поза/камера незмінні. Завершення та skip точно повертають персонажа до (0,1.2,3), без другого launch. Обидва фінали, збереження режиму/оцінки, touch і незалежний archive пройшли повторно. Паралельне GPU-навантаження вплинуло на перший запуск browser bot; послідовний повтор пройшов без змін автопілота чи gameplay.

Версію 0.4.0 опубліковано на https://dvaderfun.github.io/goingdownfromsky/. Commit ab9c20c і Pages run 40092018040 пройшли build/deploy. Live test:pages підтвердив новий intro, pause/skip, заморожені лічильники, правильні ресурси, керування й незмінний archive; errors=[]. Підсумковий запис — docs/NEXT_SESSION.md.
