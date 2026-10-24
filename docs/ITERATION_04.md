# Ітерація 04 — два стилі приземлення

Користувач просить ragdoll і кров після приземлення як окремий жорсткий режим. Аркадний варіант зі спалахом/кільцями зберігається й лишається початковим. Старий production build 0.2.1 окремо збережено в `releases/arcade-0.2.1`.

## Ownership

- Root: game.js, main.js, tests/game.test.js, scripts/browser-smoke.mjs, package/lock, документація та архів.
- Physics worker: src/ragdoll.js (новий), src/scene.js, tests/ragdoll.test.js (новий).
- UI worker: src/ui.js, src/style.css.
- Render worker: scripts/render-regression.mjs.

## Спільний state й поведінка

- `impactMode`: 'arcade' | 'hard', налаштування стилю фіналу; legacy save і новий браузер починають з arcade. Пишеться в rain-pain:v1.
- `runImpactMode`: snapshot вибору при start, не змінюється під час спроби. Додати в lastResult для підпису завершеної спроби.
- Main actions додають `impactMode(mode)`. Перемикач у меню, його текст ясно пояснює 'Спалах і дощові кола' / 'Ragdoll і кров'. Accessible aria-pressed, клавіатура/touch, місце на390×844. Ніякого запиту підтвердження.
- Геймплей/колізії/оцінки/рекорди однакові. Caught не запускає ragdoll або кров. Win+arcade має точний попередній ефект і cinematic1.3с. Win+hard має фізичне тіло/кров і cinematic3.6с, потім той самий фінальний текст та дії. Обрана нова спроба, menu і dispose очищають hard-ефекти й відновлюють arcadе presentation.

## Фізика й renderer

Залежність cannon-es для справжніх жорстких тіл і суглобів (голова/корпус/таз, обидві руки й ноги). Контакти зі статичною землею, згасання/тертя, сталий physics timestep/substeps і скінченні значення. Розчленування не потрібне; ragdoll зберігає цілісний впізнаваний персонаж у жовтому плащі. Фізика не працює в arcade/menu/flight/caught.

Жорсткий фінал: короткий спалах удару, тіло втрачає тонус і осідає/перекочується на мокрій вулиці, червоні частинки та плями крові на землі; камера коротко наближається/нахиляється, щоб результат читався. Швидке повернення стандартної камери при retry/menu, reducedMotion зменшує тремтіння/спалах. Нові visuals із фіксованого пулу, без збільшення resourceCount між спробами. Сценарій аркадного фіналу не видозмінювати.

Ragdoll physics worker узгодить із Render worker test API `scene.hardLanding` / `scene.ragdoll`: стан active, parts і stains для meaningful перевірки. Pure physics Node-тести повинні перевірити joints/finite/contact/settling/reset/dispose, не лише копіювати формули.

## Перевірки

Modes/legacy save/persistence/run snapshot/різна тривалість фіналу. Обидва реальні браузерні проходи з toggle, післяreload, retry в іншому режимі й touch. Render усі попередні98 + hard impact/settling/result/reducedMotion/cleanup/mode switching: finite, GL/pixels, стабільні resources, кров лише hard win. Точна фінальна фраза збережена.

## Результат 0.3.0 — 24.10.2026

Завершено. У меню є збережуваний перемикач Аркадний/Жорсткий; аркадний стандартний, оригінальний фінал не змінено. Жорсткий win має 13 фізичних тіл/12 суглобів, контакт/осідання, 32 частинки й 35 плям крові; всі hard-ефекти очищаються при menu/retry/caught. Старий build 0.2.1 доступний окремо через `/releases/arcade-0.2.1/`.

Пройдено `npm test` (33 тести), production build та 154 графічні сценарії (98 аркадних +56 hard) без NaN, помилок WebGL і великих чорних областей. GPU-ресурси стабільні — 282. Після виправлення test-helper (меню треба натискати всередині активного діалогу) пройдено повний інтерактивний сценарій через `npm run test:browser -- --skip-render`, оскільки графічна частина вже завершилась успішно й production-код не змінювався. Перевірено реальні win у двох режимах, фізичні контакти та видиму кров, режим після reload, повернення в arcade, phone/touch, archive assets/start. `browser-report.json`: passed=true, errors=[].

Звіти — `artifacts/render-regression-report.json`, `artifacts/render-hard-regression-report.json`, `artifacts/browser-report.json`. Майбутній звичайний `test:browser` за замовчуванням виконує графічну й інтерактивну частини разом.
