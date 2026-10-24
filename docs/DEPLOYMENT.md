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

Фактичний підсумок першого deploy буде записано в `docs/NEXT_SESSION.md` після завершення GitHub Actions і live-перевірки.
