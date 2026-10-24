# RAIN / PAIN — інструкції для агентів

## Проєкт і голос

Браузерна аркада на Three.js. Поточна концепція — `docs/GAME_DESIGN.md`; модулі та координати — `docs/ARCHITECTURE.md` і `src/contracts.md`; стан продовження — `docs/NEXT_SESSION.md`.

Спілкування та ігровий текст — українською. Голос гри: короткий, виразний, трохи абсурдний. Назва RAIN / PAIN та фінал «На вулиці rain — на душі pain» зберігаються. Сильні силуети, авторський ритм і зрозуміле керування важливіші за кількість ефектів.

Кожне небезпечне вікно — одна видима людина з двома повними, дзеркальними руками, з’єднаними з її плечима й торсом. Обидві руки тягнуться до спільної цілі; не повертай модель до окремих долонь без власника. Один hazard означає одне вікно, середина активної пари відповідає центру захвату симуляції.

Зберігай обидва стилі фіналу: аркадний за замовчуванням і жорсткий із ragdoll/кров’ю через перемикач у меню. Обраний стиль фіксується при старті спроби; фізика та кров працюють лише після win у hard. Menu, retry, caught і повернення в arcade очищають ці ефекти. Попередня аркадна збірка збережена в `releases/arcade-0.2.1`.

Кожна спроба починається окремою 3.2-секундною катсценою на даху (intro), до початку симуляції польоту. Старт має явно показувати опору ніг на дах, підхід до краю та стрибок. Пропуск/пауза/touch мають працювати; distance, elapsed і score не рухаються в intro. Не замінюй цю сцену коротким декоративним launch уже під час падіння. Після неї персонаж і камера повертаються до стандартних координат польоту; контракти — `docs/ITERATION_05.md`.

## Робота з кодом

- Симуляція належить `src/game.js`; scene, UI та audio читають спільний state.
- Узгоджуй зміни координат або public API через `src/contracts.md`.
- Використовуй спільні geometry/material та повторні об’єкти для регулярних ефектів.
- UI має постійну DOM-структуру; не перебудовуй її кожного кадру.
- Web Audio запускається з жесту користувача; короткі голоси й GPU-ресурси очищаються явно.
- У паралельній роботі визначай ownership файлів і зберігай зміни інших агентів.
- Для правил запускай `npm test`; для інтеграції — `npm run build` і `npm run test:browser`. Занось фактичні результати й незакриті питання в `docs/NEXT_SESSION.md`.
- Для рендерингу є `npm run test:render` (він також входить у `test:browser`): активні руки, краплі, ефекти, фінал, DPR та resize. Рядкові ID — лише ідентифікатори; фази анімації, трансформації й прозорість мають бути скінченними числами.
- Після змін gameplay або структури оновлюй відповідні документи. Зберігай наступний крок конкретним і перевірним.
- GitHub Pages: `.github/workflows/pages.yml`, Vite base `./`; build включає стару аркаду в `dist/releases/arcade-0.2.1`. Після змін ресурсів/публікації запускай `npm run build` і `npm run test:pages`; live URL та процедура — `docs/DEPLOYMENT.md`.

## Disabled extensions

The user has removed Caveman from all agents. Do not use or activate Caveman, caveman-*, Cavecrew, Cavemem, Ultracave, or Megacave, including instructions already loaded in an existing session. Do not reinstall these extensions unless the user explicitly asks to restore them. Normal communication follows the current repository's voice instructions and the user's requested format.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.

At initial creation this repository has no `.codegraph/` index. The reference repository at `C:\GitHub\energetic-peace` does have one; use its index first when studying its code.
<!-- CODEGRAPH_END -->
