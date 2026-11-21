/* ============================================================
   Табло турнира СИК — три страницы на одном коде:
     index.html — общая (обе дисциплины, суммы)
     chgk.html  — основная дисциплина (по вопросам)
     multi.html — мультиигры (по блокам)
   Данные — из Google-таблицы (доступ «всем, у кого есть ссылка — читатель»).
   ID таблицы берётся из config.js; ?id=<ID> в адресе — важнее; ?demo — тестовые данные из demo.js.
   Фильтр зачётов: ?zachet=Студ,Корп. Страница: index.html / chgk.html / multi.html.
   Доп. параметр: &refresh=10 — период обновления, сек. Клавиша F — полный экран.
   ============================================================ */
(() => {
  "use strict";

  const W = 1920, H = 1080;
  const qs = new URLSearchParams(location.search);
  const CONFIG_ID = (window.TABLO_CONFIG?.sheetId || "").trim();
  const ID0 = (qs.get("id") || CONFIG_ID).trim();
  const DEMO = qs.has("demo") || !ID0; // без ID таблицы — тестовые данные
  const SHEET_ID = DEMO ? "" : ID0;

  const PARTNERS = [
    "grant-gubernatora-ugry", "yadro", "medved", "dodo", "piccafabrika",
    "kazan-grill", "izbushka", "gussi-kofe", "teplo-v-dushe", "raduga",
    "kingstore", "krepysh", "ultrafit", "gor-dram-teatr", "ugorik",
  ];
  const DARK_LOGOS = new Set(["gussi-kofe"]);

  const DEFAULT_CATS = { Проф: "Профессиональный", Люб: "Любительский", Корп: "Корпоративный", Студ: "Студенческий" };

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const num = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(",", ".").replace(/\s/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  /* ---------- Масштаб сцены под экран ---------- */
  const stage = $("#stage");
  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
  }
  addEventListener("resize", fit);
  fit();

  /* ---------- Часы ---------- */
  const clock = $("#clock");
  const tickClock = () => {
    const d = new Date();
    clock.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };
  tickClock();
  setInterval(tickClock, 5000);

  /* ---------- Лента партнёров ---------- */
  const tile = (n) => `<div class="ptile${DARK_LOGOS.has(n) ? " dark" : ""}"><img src="assets/partners/${n}.jpg" alt=""></div>`;
  const track = $("#marquee");
  track.innerHTML = PARTNERS.map(tile).join("") + PARTNERS.map(tile).join("");
  track.style.setProperty("--dur", PARTNERS.length * 4 + "s");

  /* ---------- Загрузка данных ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return { head, rows: rows.filter((r) => r.some((c) => c.trim() !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()]))) };
  }

  async function getSheet(name) {
    if (DEMO) return parseCSV(window.DEMO_SHEETS?.[name] ?? "");
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}&t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(name + ": HTTP " + r.status);
    const t = await r.text();
    if (t.startsWith("<")) throw new Error(name + ": нет доступа к таблице");
    return parseCSV(t);
  }

  const SHEETS = ["Настройки", "Команды", "ЧГК", "МИ"];
  let model = null;

  async function load() {
    const sync = $("#sync");
    try {
      const got = await Promise.all(SHEETS.map((n) => getSheet(n).catch((e) => (n === "Настройки" || n === "Команды" ? Promise.reject(e) : { head: [], rows: [] }))));
      model = buildModel(Object.fromEntries(SHEETS.map((n, i) => [n, got[i]])));
      sync.className = "bottom__sync" + (DEMO ? " demo" : "");
      sync.title = DEMO ? "Демо-данные" : "Обновлено " + new Date().toLocaleTimeString("ru-RU");
      onData();
    } catch (e) {
      console.error(e);
      sync.className = "bottom__sync err";
      sync.title = "Ошибка: " + e.message;
      if (!model) showError(e.message);
    }
    clearTimeout(load.t);
    load.t = setTimeout(load, 1000 * (num(qs.get("refresh")) || num(model?.cfg["обновление"]) || 20));
  }

  /* ---------- Модель ---------- */
  function buildModel(s) {
    const cfg = {};
    s["Настройки"].rows.forEach((r) => { if (r["Ключ"]) cfg[r["Ключ"].toLowerCase()] = r["Значение"] ?? ""; });

    const cats = { ...DEFAULT_CATS };

    const teams = new Map();
    s["Команды"].rows.forEach((r) => {
      const name = r["Команда"]; if (!name) return;
      teams.set(name, { name, num: (r["№"] || "").trim(), cat: r["Зачёт"] || "", org: r["Организация"] || "" });
    });
    const team = (name) => teams.get(name) || { name, num: "", cat: "", org: "" };

    // ЧГК: колонки В1…В36 (кириллица или латиница, допускается Q1)
    const qCols = s["ЧГК"].head.filter((h) => /^[ВBQ]\d+$/i.test(h))
      .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
    const perTour = Math.max(1, num(cfg["вопросов_в_туре"]) || 12);
    const chgkRows = s["ЧГК"].rows.filter((r) => r["Команда"]).map((r) => {
      const ans = qCols.map((c) => num(r[c]));
      // ДОП — сумма взятых в перестрелке; на экран не выводится столбцом
      return { ...team(r["Команда"]), ans, total: ans.reduce((a, b) => a + (b || 0), 0), dop: num(r["ДОП"]) };
    });
    let played = 0;
    chgkRows.forEach((r) => r.ans.forEach((a, i) => { if (a !== null) played = Math.max(played, i + 1); }));

    // Мультиигры: все колонки, кроме «Команда» и «Итого…». Строка «Максимум» — сколько можно было взять в блоке.
    const mCols = s["МИ"].head.filter((h) => h && !/^(команда|итого)/i.test(h));
    const isMax = (r) => /^максимум/i.test(r["Команда"] || "");
    const maxRow = s["МИ"].rows.find(isMax);
    const mMax = mCols.map((c) => { const v = maxRow ? num(maxRow[c]) : null; return v && v > 0 ? v : null; });
    const multiRows = s["МИ"].rows.filter((r) => r["Команда"] && !isMax(r)).map((r) => {
      const pts = mCols.map((c) => num(r[c]));
      return { ...team(r["Команда"]), pts, total: pts.reduce((a, b) => a + (b || 0), 0) };
    });
    // Сыгранные блоки — где хоть у кого-то есть очки; пустая клетка в сыгранном блоке = 0
    const mIdx = mCols.map((_, i) => i).filter((i) => multiRows.some((r) => r.pts[i] !== null));
    const mPlayed = mIdx.length;
    // Процент за блок = взято / максимум × 100; итог — сумма процентов (абсолютная величина, от зачёта не зависит)
    multiRows.forEach((r) => {
      r.pct = mCols.map((_, i) => (mIdx.includes(i) && mMax[i] ? ((r.pts[i] ?? 0) / mMax[i]) * 100 : null));
      r.pctSum = Math.round(r.pct.reduce((a, b) => a + (b || 0), 0) * 100) / 100;
    });
    const mNoMax = mIdx.filter((i) => !mMax[i]).map((i) => mCols[i]);

    return { cfg, cats, teams, chgk: { rows: chgkRows, nQ: qCols.length, played, perTour }, multi: { rows: multiRows, cols: mCols, played: mPlayed, idx: mIdx, max: mMax, noMax: mNoMax } };
  }

  /* Мультиигры: по сумме процентов за блоки */
  function rankMulti(rows) {
    // больше сумма процентов — выше; при равенстве — больше взято в последнем сыгранном блоке,
    // затем в предпоследнем… до первого; иначе дележ
    const idx = [...model.multi.idx].reverse();
    const tie = (a, b) => { for (const i of idx) { const d = (b.pct[i] ?? 0) - (a.pct[i] ?? 0); if (Math.abs(d) > 1e-9) return d; } return 0; };
    return rank(rows, (r) => r.pctSum, tie);
  }


  /* Основная дисциплина: по сумме; при равенстве — ДОП (перестрелка), у кого он есть.
     Не игравшие перестрелку — ниже сыгравших. ДОП к сумме не прибавляется. */
  function rankChgk(rows) {
    rows.forEach((r) => { r.dopShown = r.dop !== null; });
    const d = (r) => (r.dop === null ? -Infinity : r.dop);
    const tie = (a, b) => (d(a) === d(b) ? 0 : d(b) > d(a) ? 1 : -1);
    return rank(rows, (r) => r.total, tie);
  }

  /* Медали: по всем командам (независимо от фильтра) — общий зачёт и свой зачёт.
     Пока призовое место поделено — «?» вместо медали. */
  const MEDAL_CATS = ["Люб", "Корп", "Студ"];
  const SCOPE = { all: "ОБЩ", Проф: "ПРОФ", Люб: "ЛЮБ", Корп: "КОРП", Студ: "СТУД" };
  function setMedals(rows, ranker, key) {
    const res = new Map(rows.map((r) => [r, []]));
    // Свои медали — у Люб, Корп, Студ; профессионалы получают медали только в общем зачёте
    const scopes = [["all", rows], ...MEDAL_CATS.map((c) => [c, rows.filter((r) => r.cat === c)])];
    for (const [sc, list] of scopes) {
      if (!list.length) continue;
      ranker(list.map((r) => ({ ...r, ref: r }))).forEach((c) => {
        if (c.placeN > 3) return;
        res.get(c.ref).push({ sc, kind: c.place.includes("–") ? "?" : c.placeN });
      });
    }
    rows.forEach((r) => { r[key] = res.get(r); });
  }
  const medalCell = (list = []) => `<div class="c-medals">${list.map((m) =>
    `<span class="medal ${m.kind === "?" ? "mq" : "m" + m.kind}"><i>${m.kind}</i><b>${SCOPE[m.sc]}</b></span>`).join("")}</div>`;
  const medalKey = (list = []) => list.map((m) => m.sc + m.kind).join(",");
  const totalCell = (r) => `<div class="c-total">${r.total}${r.dopShown ? `<span class="dop"> + ${fmt(r.dop)}</span>` : ""}</div>`;
  const chgkV = (r) => r.total + (r.dopShown ? "+" + r.dop : "") + "|" + medalKey(r.mC);

  /* Места с дележом: «5–6» при равенстве */
  function rank(rows, key = (r) => r.total, tie = () => 0) {
    const sorted = [...rows].sort((a, b) => key(b) - key(a) || tie(a, b) || a.name.localeCompare(b.name, "ru"));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && key(sorted[j + 1]) === key(sorted[i]) && tie(sorted[j + 1], sorted[i]) === 0) j++;
      for (let k = i; k <= j; k++) {
        sorted[k].place = i === j ? String(i + 1) : `${i + 1}–${j + 1}`;
        sorted[k].placeN = i + 1;
      }
      i = j + 1;
    }
    return sorted;
  }
  const placeCls = (r) => "c-place" + (r.placeN <= 3 ? " p" + r.placeN : "") + (r.place.includes("–") ? " small" : "");
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const fmt2 = (n) => n.toFixed(2).replace(".", ",");
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

  function chgkStatus() {
    const { played, nQ, perTour } = model.chgk;
    if (!played) return "ещё не начата";
    const tours = Math.floor(played / perTour);
    return played >= nQ ? "<b>Итоги</b>" : played % perTour === 0 ? `после <b>${tours}</b> ${plural(tours, "тура", "туров", "туров")}` : `сыграно <b>${played}</b> из ${nQ} вопр.`;
  }
  function multiStatus() {
    const { played, cols, noMax } = model.multi;
    if (noMax.length) return `<b>нет максимума:</b> ${esc(noMax.join(", "))}`;
    return played ? (played >= cols.length ? "<b>Итоги</b>" : `сыграно блоков: <b>${played}</b> из ${cols.length}`) : "ещё не начаты";
  }

  // Метка зачёта: полное название (детальные страницы) или код (общая)
  const tag = (r, short) => (r.cat && showTags() ? `<span class="tag tag--${esc(r.cat)}">${esc(short ? r.cat : model.cats[r.cat] || r.cat)}</span>` : "");
  const teamCell = (r, short) => `<div class="c-team">${r.num ? `<span class="tnum">${esc(r.num)}</span>` : ""}<span class="name">${esc(r.name)}</span>${tag(r, short)}</div>`;

  // Резиновые строки: высота считается по реальному месту, чтобы влезли все команды
  const tourSums = (r) => {
    const { perTour, nQ } = model.chgk;
    return Array.from({ length: Math.ceil(nQ / perTour) }, (_, t) => {
      const a = r.ans.slice(t * perTour, (t + 1) * perTour);
      return a.some((x) => x !== null) ? a.reduce((s, x) => s + (x || 0), 0) : null;
    });
  };
  const rowAttrs = (key, r, v = r.total) => `class="row" data-k="${esc(key + "|" + r.name)}" data-v="${v}"`;

  /* ---------- Фильтр зачётов: ?zachet=Студ,Корп; пусто — все (общий зачёт) ---------- */
  const CAT_ORDER = ["Проф", "Люб", "Корп", "Студ"];
  let sel = new Set((qs.get("zachet") || "").split(",").map((x) => x.trim()).filter((x) => CAT_ORDER.includes(x)));
  const allSel = () => sel.size === 0 || sel.size === CAT_ORDER.length;
  const pick = (rows) => (allSel() ? rows : rows.filter((r) => sel.has(r.cat)));
  const showTags = () => allSel() || sel.size > 1;

  function fitTables(root) {
    root.querySelectorAll(".tbl").forEach((t) => {
      const box = t.querySelector(".tbl__rows");
      const rows = [...box.children];
      const n = rows.length;
      if (!n) return;
      t.style.setProperty("--fs", "16px"); // временно, чтобы шапка таблицы встала на место перед замером
      const gap = n > 20 ? 3 : n > 14 ? 5 : 6;
      const max = +t.dataset.max || 72;
      const rh = Math.max(18, Math.min(max, Math.floor((box.clientHeight - (n - 1) * gap) / n)));
      t.style.setProperty("--rh", rh + "px");
      t.style.setProperty("--gap", gap + "px");
      // шрифт по высоте строки, затем уменьшаем, пока все строки не влезут по ширине
      let fs = Math.round(Math.max(13, Math.min(+t.dataset.fsmax || 34, rh * 0.58)));
      // 1) ничего не вылезает: ни строка, ни отдельная ячейка (кроме названия — оно с многоточием)
      const over = () => rows.some((r) => r.scrollWidth > r.clientWidth + 1 ||
        [...r.children].some((c) => !c.classList.contains("c-team") && c.scrollWidth > c.clientWidth + 1));
      // 2) названия целиком, если для этого хватает уменьшить шрифт не больше чем на четверть
      const cut = () => rows.some((r) => { const nm = r.querySelector(".name"); return nm && nm.scrollWidth > nm.clientWidth + 1; });
      const setFs = (v) => t.style.setProperty("--fs", v + "px");
      setFs(fs);
      while (fs > 11 && over()) setFs(--fs);
      const floor = Math.max(14, Math.round(fs * 0.75));
      while (fs > floor && cut()) setFs(--fs);
    });
  }
  // Заголовок: уменьшаем шрифт, пока не влезет
  function fitTitle() {
    const h = $("#slideTitle");
    h.style.fontSize = "";
    let size = parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth + 1 && size > 26) { size -= 2; h.style.fontSize = size + "px"; }
  }
  function selTitle() {
    if (allSel()) return "";
    const on = CAT_ORDER.filter((c) => sel.has(c));
    if (on.length === 1) return DEFAULT_CATS[on[0]] + " зачёт";
    return on.slice(0, -1).join(", ") + " и " + on.at(-1);
  }

  /* ---------- Страницы ---------- */
  // Ширины колонок завязаны на размер шрифта (--fs): fitTables уменьшает шрифт, пока строка не влезет.
  // Название команды получает гарантированный минимум; колонка медалей — по фактическому числу медалей.
  const medW = (rows, key) => {
    const mx = Math.max(0, ...rows.map((r) => (r[key] || []).length));
    return mx ? `calc(var(--fs) * ${(mx * 3.9 + 0.4).toFixed(1)})` : "0px";
  };
  const EMPTY = `<div class="empty-state">В выбранных зачётах нет команд</div>`;
  const blockShort = (c) => esc(c.replace(/^блок\s*/i, "Б"));

  const PAGES = {
    // Общая: обе дисциплины рядом; ЧГК — суммы по турам, МИ — очки по блокам
    all: {
      title: "Текущие результаты",
      status: () => "",
      render(el) {
        const nT = Math.ceil(model.chgk.nQ / model.chgk.perTour);
        const nB = model.multi.cols.length;
        const c = rankChgk(pick(model.chgk.rows)), m = rankMulti(pick(model.multi.rows));
        el.innerHTML = `<div class="split">
          <section class="panel">
            <h2 class="panel__title">Основная дисциплина <span class="panel__st">${chgkStatus()}</span></h2>
            ${c.length ? `<div class="tbl" data-max="60" data-fsmax="24" style="--cols:calc(var(--fs) * 2.8) minmax(calc(var(--fs) * 10), 1fr) repeat(${nT}, calc(var(--fs) * 2.4)) calc(var(--fs) * 4.6) ${medW(c, "mC")}">
              <div class="tbl__head"><span class="c-num">Место</span><span>Команда</span>${Array.from({ length: nT }, (_, t) => `<span class="c-num">${t + 1} тур</span>`).join("")}<span style="text-align:right">Σ</span><span></span></div>
              <div class="tbl__rows">${c.map((r) => `<div ${rowAttrs("c", r, chgkV(r))}>
                <div class="${placeCls(r)}">${r.place}</div>${teamCell(r, true)}
                ${tourSums(r).map((x) => `<div class="c-num${x === null ? " empty" : ""}">${x ?? "–"}</div>`).join("")}
                ${totalCell(r)}${medalCell(r.mC)}</div>`).join("")}</div></div>` : EMPTY}
          </section>
          <section class="panel">
            <h2 class="panel__title">Мультиигры <span class="panel__st">${multiStatus()}</span></h2>
            ${m.length ? `<div class="tbl" data-max="60" data-fsmax="24" style="--cols:calc(var(--fs) * 2.8) minmax(calc(var(--fs) * 9), 1fr) repeat(${nB}, calc(var(--fs) * 2.1)) calc(var(--fs) * 4.4) ${medW(m, "mM")}">
              <div class="tbl__head"><span class="c-num">Место</span><span>Команда</span>${model.multi.cols.map((x) => `<span class="c-num">${blockShort(x)}</span>`).join("")}<span style="text-align:right">Σ %</span><span></span></div>
              <div class="tbl__rows">${m.map((r) => `<div ${rowAttrs("m", r, r.pctSum + "|" + r.pts.join(",") + "|" + medalKey(r.mM))}>
                <div class="${placeCls(r)}">${r.place}</div>${teamCell(r, true)}
                ${r.pts.map((p, i) => `<div class="c-num taken${model.multi.idx.includes(i) ? "" : " empty"}">${model.multi.idx.includes(i) ? fmt(p ?? 0) : "–"}</div>`).join("")}
                <div class="c-total">${fmt2(r.pctSum)}</div>${medalCell(r.mM)}</div>`).join("")}</div></div>` : EMPTY}
          </section></div>`;
      },
    },

    // Основная дисциплина: квадратики по вопросам (сжимаются, если места мало)
    chgk: {
      title: "Основная дисциплина",
      status: chgkStatus,
      render(el) {
        const { nQ, perTour } = model.chgk;
        const rows = rankChgk(pick(model.chgk.rows));
        if (!rows.length) { el.innerHTML = EMPTY; return; }
        const nT = Math.ceil(nQ / perTour);
        const tourW = perTour * 18 + (perTour - 1) * 5 + 12 + 44;
        const tours = (r) => Array.from({ length: nT }, (_, t) => {
          const a = r.ans.slice(t * perTour, (t + 1) * perTour);
          const any = a.some((x) => x !== null);
          return `<div class="tour"><div class="dots" style="--q:${perTour};max-width:${tourW - 56}px">${a.map((x) => `<i class="dot${x === 1 ? " y" : x === 0 ? " n" : ""}"></i>`).join("")}</div><div class="tour__sum${any ? "" : " empty"}">${any ? a.reduce((s, x) => s + (x || 0), 0) : "–"}</div></div>`;
        }).join("");
        el.innerHTML = `<div class="tbl" data-fsmax="28" style="--cols:calc(var(--fs) * 3) minmax(calc(var(--fs) * 16), ${(nT * 0.7).toFixed(1)}fr) repeat(${nT}, minmax(0, 1fr)) calc(var(--fs) * 5.2) ${medW(rows, "mC")}">
          <div class="tbl__head"><span class="c-num">Место</span><span>Команда</span>${Array.from({ length: nT }, (_, t) => `<span class="tour" style="justify-content:center">${t + 1} тур</span>`).join("")}<span style="text-align:right">Сумма</span><span></span></div>
          <div class="tbl__rows">${rows.map((r) => `<div ${rowAttrs("c", r, chgkV(r))}>
            <div class="${placeCls(r)}">${r.place}</div>${teamCell(r, true)}${tours(r)}
            ${totalCell(r)}${medalCell(r.mC)}</div>`).join("")}</div></div>`;
      },
    },

    // Мультиигры: очки и место в каждом блоке
    multi: {
      title: "Мультиигры",
      status: multiStatus,
      render(el) {
        const { cols } = model.multi;
        const rows = rankMulti(pick(model.multi.rows));
        if (!rows.length) { el.innerHTML = EMPTY; return; }
        const played = (i) => model.multi.idx.includes(i);
        const cell = (p, i) => played(i)
          ? `<div class="c-num taken${p < 0 ? " neg" : ""}">${fmt(p ?? 0)}</div>`
          : `<div class="c-num empty">–</div>`;
        el.innerHTML = `<div class="tbl" data-fsmax="30" style="--cols:calc(var(--fs) * 3) minmax(calc(var(--fs) * 15), 1fr) repeat(${cols.length}, minmax(calc(var(--fs) * 3), calc(var(--fs) * 5))) calc(var(--fs) * 5.4) ${medW(rows, "mM")}">
          <div class="tbl__head"><span class="c-num">Место</span><span>Команда</span>${cols.map((c, i) => `<span class="c-num">${esc(c)}${model.multi.max[i] ? `<small class="mx">из ${fmt(model.multi.max[i])}</small>` : ""}</span>`).join("")}<span style="text-align:right">Σ %</span><span></span></div>
          <div class="tbl__rows">${rows.map((r) => `<div ${rowAttrs("m", r, r.pctSum + "|" + r.pts.join(",") + "|" + medalKey(r.mM))}>
            <div class="${placeCls(r)}">${r.place}</div>${teamCell(r, true)}
            ${r.pts.map((p, i) => cell(p, i)).join("")}
            <div class="c-total">${fmt2(r.pctSum)}</div>${medalCell(r.mM)}</div>`).join("")}</div></div>`;
      },
    },
  };

  /* ---------- Показ ---------- */
  // Страница: #chgk / #multi в адресе, иначе ?view=, иначе data-view файла
  const pickView = () => [location.hash.slice(1), qs.get("view"), document.body.dataset.view].find((v) => PAGES[v]) || "all";
  let VIEW = pickView();
  let page = PAGES[VIEW];
  const body = $("#body");
  const prevVals = new Map();

  function onData() {
    $("#event").textContent = model.cfg["турнир"] || "Осенний Кубок";
    const st = selTitle();
    $("#slideTitle").innerHTML = esc(page.title) + (st ? `<span class="sep">/</span><span class="sub">${esc(st)}</span>` : "");
    const manual = (model.cfg["статус"] || "").trim();
    $("#status").innerHTML = manual ? esc(manual) : page.status();

    let el = body.querySelector(".slide");
    const first = !el;
    if (first) { el = document.createElement("div"); el.className = "slide"; body.appendChild(el); }
    const before = new Map([...el.querySelectorAll("[data-k]")].map((r) => [r.dataset.k, r.offsetTop]));
    if (model.chgk.played) setMedals(model.chgk.rows, rankChgk, "mC");
    if (model.multi.played) setMedals(model.multi.rows, rankMulti, "mM");
    // Много команд (22+) — ужимаем шапку, чтобы строкам досталось больше высоты
    const nC = pick(model.chgk.rows).length, nM = pick(model.multi.rows).length;
    const shown = VIEW === "chgk" ? nC : VIEW === "multi" ? nM : Math.max(nC, nM);
    stage.classList.toggle("compact", shown >= 22);
    fitTitle();
    page.render(el);
    fitTables(el);

    el.querySelectorAll("[data-k]").forEach((r) => {
      // подсветка изменившихся сумм
      const old = prevVals.get(r.dataset.k);
      if (old !== undefined && old !== r.dataset.v) r.classList.add("is-new");
      prevVals.set(r.dataset.k, r.dataset.v);
      // FLIP: строки плавно переезжают на новые места
      const was = before.get(r.dataset.k);
      const d = was === undefined ? 0 : was - r.offsetTop;
      if (!d) return;
      r.style.transition = "none";
      r.style.transform = `translateY(${d}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transition = ""; r.style.transform = ""; }));
    });
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-on")));
  }

  function rerender() { body.innerHTML = ""; markNav(); if (model) onData(); }
  function switchView(v) {
    if (!PAGES[v] || v === VIEW) return;
    VIEW = v; page = PAGES[v];
    rerender();
  }
  addEventListener("hashchange", () => switchView(pickView()));

  /* ---------- Выезжающая панель (левый нижний угол): страница, зачёты, ссылка для ТВ ---------- */
  const nav = $("#viewNav");
  function markNav() {
    nav.querySelectorAll("a[data-v]").forEach((a) => a.classList.toggle("on", a.dataset.v === VIEW));
    nav.querySelectorAll("input[data-cat]").forEach((c) => { c.checked = allSel() || sel.has(c.dataset.cat); });
  }
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-v]"); if (!a) return;
    e.preventDefault();
    try { history.replaceState(null, "", location.pathname + location.search + (a.dataset.v === "all" ? "" : "#" + a.dataset.v)); } catch {}
    switchView(a.dataset.v);
  });
  nav.addEventListener("change", (e) => {
    const boxes = [...nav.querySelectorAll("input[data-cat]")];
    const on = boxes.filter((b) => b.checked).map((b) => b.dataset.cat);
    if (!on.length) { e.target.checked = true; return; } // хотя бы один зачёт
    sel = new Set(on.length === CAT_ORDER.length ? [] : on);
    try {
      const p = new URLSearchParams(location.search);
      allSel() ? p.delete("zachet") : p.set("zachet", on.join(","));
      const q = p.toString().replace(/%2C/g, ",");
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    } catch {}
    rerender();
  });

  // Ссылка для ТВ: нужная страница + ID таблицы + выбранные зачёты
  function tvLink() {
    const file = { all: "index.html", chgk: "chgk.html", multi: "multi.html" }[VIEW];
    const dir = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "");
    const p = [];
    if (DEMO) p.push("demo");
    else if (SHEET_ID !== CONFIG_ID) p.push("id=" + encodeURIComponent(SHEET_ID)); // ID из config.js в ссылку не пишем
    if (!allSel()) p.push("zachet=" + CAT_ORDER.filter((c) => sel.has(c)).map(encodeURIComponent).join(","));
    return dir + file + (p.length ? "?" + p.join("&") : "");
  }
  const toast = $("#toast");
  function say(html) { toast.innerHTML = html; toast.hidden = false; clearTimeout(say.t); say.t = setTimeout(() => (toast.hidden = true), 8000); }
  $("#copyLink").addEventListener("click", () => {
    const link = tvLink();
    const warn = DEMO ? "<b>Сейчас тестовые данные.</b> Ссылка тоже откроет тестовые данные.<br>" : "";
    const show = (ok) => say(warn + (ok ? "Скопировано: " : "Скопируйте вручную: ") + `<input readonly value="${esc(link)}" onclick="this.select()">`);
    try { navigator.clipboard.writeText(link).then(() => show(true), () => show(false)); } catch { show(false); }
  });
  markNav();

  // Курсор прячется через 3 с без движения мыши
  let idleT;
  const wake = () => { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 3000); };
  addEventListener("mousemove", wake); wake();

  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input")) return;
    if (e.key === "f") document.documentElement.requestFullscreen?.().catch(() => {});
    const v = { 1: "all", 2: "chgk", 3: "multi" }[e.key];
    if (v) switchView(v);
  });

  function showError(msg) {
    $("#slideTitle").textContent = "Табло";
    body.innerHTML = `<div class="slide is-on"><div class="empty-state">${esc(msg)}</div></div>`;
  }

  load();
})();
