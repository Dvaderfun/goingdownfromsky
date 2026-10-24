# GitHub Pages

- Гра: https://dvaderfun.github.io/goingdownfromsky/
- Аркада 0.2.1: https://dvaderfun.github.io/goingdownfromsky/releases/arcade-0.2.1/
- Репозиторій: https://github.com/Dvaderfun/goingdownfromsky

GitHub Pages налаштований як `build_type=workflow`. Кожен push у `main` запускає `.github/workflows/pages.yml`: Node 24, `npm ci`, Node-тести, production build, завантаження `dist` та Pages deploy. Є також ручний `workflow_dispatch`. Build має contents/read і pages/read, deploy — pages/write та id-token/write; додаткові секрети не потрібні.

## Збірка й ресурси

Vite використовує `base: './'`; favicon має `%BASE_URL%`. Код гри, CSS і локальні шрифти працюють під шляхом репозиторію. Build копіює збережену аркаду з `releases/arcade-0.2.1` до `dist/releases/arcade-0.2.1` і додає `.nojekyll`. Notices залежностей і шрифтів — у `public/THIRD_PARTY_LICENSES.txt` та production root.

## Перевірка

```sh
npm run build
npm run test:pages
npm run test:pages -- https://dvaderfun.github.io/goingdownfromsky/
```

Локальна перевірка піднімає лише готовий `dist` під `/goingdownfromsky/`; запити поза ним отримують 404. Вона перевіряє WebGL, JS/CSS/шрифти/favicon, керування, збереження режиму, мобільний перемикач та незалежну аркаду. Для браузерних перевірок локально потрібен встановлений Edge; CI на Ubuntu запускає Node-тести та build. Ігрові/render-тести залишаються окремими gates, описаними в README.

## Перша публікація — 24.10.2026

Опубліковано commit `f061a695b3a2195ccea54dbdc16a5af0307b7605`. [GitHub Actions run 40090669930](https://github.com/Dvaderfun/goingdownfromsky/actions/runs/40090669930) завершив build і deploy з success; Node-тести й production build пройшли на Ubuntu/Node 24.

Локальний `npm run test:pages` і live `npm run test:pages -- https://dvaderfun.github.io/goingdownfromsky/` пройшли. У двох версіях завантажуються WebGL, JS/CSS, шрифти й favicon; перевірені керування, пауза/ривок, збереження режиму, phone selector і запуск старої аркади. Немає browser errors, невдалих ресурсів або запитів поза Pages prefix. Локальний звіт — `artifacts/pages-report.json` (останній live-прогін).

## Публікація 0.4.0 — 24.10.2026

Ітерація 06 / 0.5.0 підготовлена локально: 57 Node-тестів, production build, повний browser із 190 render-сценаріями та локальний test:pages пройшли, включно з «Дощем дня» під Pages prefix. Її публікацію ще не виконано; live версія лишається 0.4.0. Після публікації повторити live `test:pages` за процедурою вище.

Опубліковано commit ab9c20c3a65ad3547bacda4dc4a02740d7bd50a7. Pages run 40092018040 завершив build/deploy з success. 40 Node-тестів, 178 render-станів, build, серійний browser і local/live Pages перевірки пройшли. На живій основній URL видно новий rooftop intro, pause/skip і незмінний archive 0.2.1; WebGL, JS/CSS/fonts/favicon та керування працюють без помилок. Live звіт — artifacts/pages-report.json.
