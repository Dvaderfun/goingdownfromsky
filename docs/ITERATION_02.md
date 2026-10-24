# Ітерація 02 — стиль польоту

Узгоджений обсяг: відчуття падіння, короткий стрибок із даху, рука-переслідувач із чесним попередженням, ризикові краплі, оцінка C/B/A/S і рекорд кожної будівлі. Перший рівень має авторську послідовність хвиль для навчання. Рендеринг залишається скінченним та проходить графічну перевірку після попереднього NaN-дефекту.

## Ownership цієї ітерації

- Root: game.js, main.js, tests/game.test.js, scripts/browser-smoke.mjs, package та src/contracts.md.
- Scene worker: src/scene.js, scripts/render-regression.mjs.
- UI worker: src/ui.js, src/style.css.
- Audio/docs worker: src/audio.js, README.md, docs/GAME_DESIGN.md, ARCHITECTURE.md, NEXT_SESSION.md, SESSION_NOTES.md.

## Доповнення спільного state

- `launchProgress`: 0..1, візуальний стрибок у перші 0.8 секунди гри; mode залишається playing, ранніх колізій немає.
- `fallSpeed`: реальна швидкість падіння (base `speed` із конфігурації), м’який розгін та до 10% прискорення біля землі. `fallIntensity`: 0..1 для дощу/волосся/звуку.
- `nearTimer`: 0..0.25, `pickupTimer`: 0..0.35; підтримують коротку реакцію на близький проліт/краплю.
- `tutorialHint`: короткий український текст для першого рівня, пустий на інших.
- Hazards: новий type `hunter`, numeric `phase`, `stage`: tracking/locked/reaching/passed (звичайні руки можуть мати warning/reaching/passed), `locked` bool, `targetX` число. Hunter слідкує в межах ±1.15 від baseX, фіксується при y≥−7.2, активний при y>−4.5. Після фіксації НЕ рухає ціль. Збережені x/y точно відповідають колізії; дозволений safeLane лишається поза досяжністю.
- Pickups: `risk` boolean; ризикові краплі теплі коралові, звичайні бірюзові. `at` — числова фаза/координата. Жодної арифметики з ID.
- `riskDrops`: зібрані небезпечні краплі; звичайний `drops` включає всі краплі.
- `lastResult.grade`: C/B/A/S для успішного фіналу, null для caught; `riskDrops`, `newLevelBest`, `levelBestScore` додаються до наявних полів.
- `levelRecords`: object keyed by numeric level strings, values `{score, grade}`; grade може бути null. Пишеться в той самий rain-pain:v1 save, старі saves сумісні.

## Нові аудіоподії

`tracking`: один навчальний момент, `lock`: фіксація hunter цілі, `risk`: ризикова крапля. Наявні start/dash/near/drop/catch/impact/win/pause зберігаються. Root додає toast на перше tracking, risk дає окремий відгук. Без повторних allocations кожного кадру.

## Перевірки

Node: hunter фіксується та не стежить після lock; safeLane доступна; risk awards once; rank thresholds; legacy/per-level save; pause/retry усіх нових значень. Browser: справжній фінал і grade, навчальна підказка, storage/next/retry/touch. Render: новий hunter tracking/locked/reaching, risk/normal pickups, launch/near FX, усі старі переходи й finite/pixel assertions.

## Результат 0.2.0

Ітерацію завершено. Пройдено 24 Node-тести (100 прохідних маршрутів на п’яти рівнях складності), production build, 62 графічні сценарії та повний браузерний цикл без помилок. Клавіатурний політ: 2935 очок, 4 ризикові краплі, комбо ×6, оцінка A; рекорд і grade збережено після reload, selector і touch працюють.

Фінальний графічний повтор уточнив реальний hunter кадр на 84 м: stage=locked, x=targetX, точний reticle, скінченні об’єкти/вершини, GL=0; 237 GPU-ресурсів лишаються стабільними. Звіт: `artifacts/render-iteration02-final-report.json` (62/62). Наступні пріоритети — `docs/NEXT_SESSION.md`.
