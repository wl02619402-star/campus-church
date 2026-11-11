/* 畫面程式：把 CampusData 拿到的資料畫到頁面上。接資料時不需要改這個檔案。 */
(function () {
  "use strict";

  const C = window.SITE_CONFIG;
  const D = window.CampusData;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const REGION_KEY = "campus-church-region";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    region: C.regions[0].name,
    meetings: [],
    meetingsFailed: false,
    stories: [],
    schools: [],
    schoolCategory: "全部",
    schoolQuery: "",
    storyIndex: 0,
    mySchool: "",
    prayedCounts: new Map(),
    justPrayed: new Set(),
  };

  /* ---------- DOM 小工具（全部用 textContent，試算表內容不會被當成程式執行） ---------- */
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid);
    });
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 私密模式可略過 */ } },
  };

  /* ---------- 日期格式（台灣時間） ---------- */
  const fmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  function dateParts(date) {
    const p = {};
    fmt.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    return { md: `${p.month}/${p.day}`, dow: p.weekday, time: `${p.hour}:${p.minute}` };
  }

  function ago(date) {
    if (!date) return "";
    const hours = Math.floor((Date.now() - date.getTime()) / 36e5);
    if (hours < 1) return "剛剛";
    if (hours < 24) return `${hours} 小時前`;
    return `${Math.floor(hours / 24)} 天前`;
  }

  function hoursLeft(date) {
    const left = (C.storyHours || 48) - (Date.now() - date.getTime()) / 36e5;
    return left < 1 ? "剩不到 1 小時" : `剩 ${Math.floor(left)} 小時`;
  }

  /* ---------- 聚會 ---------- */
  function meetingsFor(region) {
    const now = Date.now();
    const list = state.meetings.filter((m) => m.region === region && m.end.getTime() > now);
    return { next: list[0] || null, later: list.slice(1) };
  }

  const mapURL = (m) => m.map || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.venue)}`;

  function calendarURL(m) {
    const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const q = new URLSearchParams({
      action: "TEMPLATE",
      text: `校園教會｜${m.region}聚會`,
      dates: `${stamp(m.start)}/${stamp(m.end)}`,
      location: m.venue,
      ctz: "Asia/Taipei",
    });
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
  }

  function countdownSticker(region) {
    const unit = (k) => el("span", { "data-unit": k }, "--");
    return el("div", { class: "sticker", "data-countdown": true, "data-region": region, role: "timer" },
      el("span", { class: "sticker__top" }, "還有"),
      el("span", { class: "sticker__big" }, unit("d"), el("small", {}, "天")),
      el("span", { class: "sticker__clock" }, unit("h"), ":", unit("m"), ":", unit("s")));
  }

  function renderRegionSwitches() {
    const index = C.regions.findIndex((r) => r.name === state.region);
    document.documentElement.style.setProperty("--region", C.regions[index].color);
    $$("[data-region-switch]").forEach((box) => {
      if (!box.childElementCount) {
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "選擇地區");
        box.style.setProperty("--n", C.regions.length);
        box.append(el("span", { class: "region-switch__thumb", "aria-hidden": "true" }));
        C.regions.forEach((r) => box.append(
          el("button", { type: "button", class: "region-switch__btn", "data-region": r.name, onclick: () => setRegion(r.name) }, r.name)));
      }
      box.style.setProperty("--i", index);
      $$("button", box).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === state.region)));
    });
    syncPanels();
  }

  function retryBlock() {
    return el("div", { class: "load-error" },
      el("p", {}, "暫時讀不到聚會資料"),
      el("button", { class: "btn btn--quiet", type: "button", onclick: () => location.reload() }, "重新整理"));
  }

  /* 首頁主視覺：北中南三塊色塊，點哪一區就展開哪一區 */
  function dateDigits(md) {
    return el("p", { class: "panel__date" },
      el("span", { class: "sr-only" }, md),
      Array.from(md).map((ch, i) => el("span", { "aria-hidden": "true", style: `--i:${i}` }, ch)));
  }

  function panelContent(region, next) {
    if (!next) {
      return [
        el("p", { class: "panel__note" }, "下一場聚會"),
        el("p", { class: "panel__none" }, "時間確認中"),
        el("div", { class: "panel__actions" },
          el("a", { class: "btn btn--ink", href: "#/welcome" }, "第一次來？", icon("arrow"))),
      ];
    }
    const p = dateParts(next.start);
    return [
      el("p", { class: "panel__note" }, "下一場聚會"),
      dateDigits(p.md),
      el("div", { class: "panel__foot" },
        el("div", { class: "panel__info" },
          el("p", { class: "panel__when" }, p.dow, el("b", {}, p.time)),
          el("a", { class: "panel__venue", href: mapURL(next), target: "_blank", rel: "noopener" },
            next.venue, el("span", { class: "sr-only" }, "（開啟地圖）"))),
        countdownSticker(region),
        el("div", { class: "panel__actions" },
          el("a", { class: "btn btn--ink", href: "#/welcome" }, "第一次來？", icon("arrow")),
          el("a", { class: "text-link", href: calendarURL(next), target: "_blank", rel: "noopener" }, "加到行事曆"))),
    ];
  }

  const isWide = () => window.matchMedia("(min-width: 960px)").matches;

  /* 電腦版展開區：日期佔左邊約三分之二，右邊留給倒數貼紙；三區用同一個字級，切換時才不會忽大忽小 */
  const DATE_SHARE = 0.66;
  const DATE_MAX = 400;

  function fitDates() {
    const dates = $$(".panel__date");
    dates.forEach((date) => date.style.removeProperty("--date"));
    if (!isWide()) return;
    const fits = dates.map((date) => {
      const inner = date.closest(".panel__inner");
      const box = getComputedStyle(inner);
      const fontSize = parseFloat(getComputedStyle(date).fontSize);
      const textWidth = $$("span[style]", date).reduce((sum, d) => sum + d.getBoundingClientRect().width, 0);
      if (!textWidth || !fontSize) return Infinity;
      const others = Array.from(inner.children)
        .filter((child) => child !== date)
        .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const roomW = inner.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
      const roomH = inner.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom) - others;
      return Math.min(roomW * DATE_SHARE / (textWidth / fontSize), roomH / 1.04);
    });
    const size = Math.floor(Math.min(DATE_MAX, ...fits));
    dates.forEach((date) => date.style.setProperty("--date", `${size}px`));
  }

  function regionPanel(r) {
    const { next } = meetingsFor(r.name);
    const p = next ? dateParts(next.start) : null;
    return el("section", { class: "panel", style: `--c:${r.color}`, "data-panel": r.name, "aria-label": `${r.name}聚會` },
      el("button", { class: "panel__tab", type: "button", onclick: () => setRegion(r.name) },
        el("span", { class: "panel__name" }, r.name),
        el("span", { class: "panel__peek" }, p ? [p.md, el("small", {}, p.dow)] : el("small", {}, "確認中")),
        el("span", { class: "panel__mark", "aria-hidden": "true" })),
      el("div", { class: "panel__fold" },
        el("div", { class: "panel__body" },
          el("div", { class: "panel__inner" }, panelContent(r.name, next)))));
  }

  function renderHero() {
    const box = $("#heroMeeting");
    box.textContent = "";
    if (state.meetingsFailed) { box.append(retryBlock()); return; }
    box.style.setProperty("--n", C.regions.length);
    C.regions.forEach((r) => box.append(regionPanel(r)));
    syncPanels();
    fitDates();
  }

  function syncPanels() {
    $$(".panel").forEach((panel) => {
      const open = panel.dataset.panel === state.region;
      panel.classList.toggle("is-open", open);
      $(".panel__tab", panel).setAttribute("aria-expanded", String(open));
      $(".panel__fold", panel).inert = !open;
    });
  }

  function renderLater() {
    /* 全部地區都畫出來：電腦版一起列，手機版用樣式只顯示目前地區 */
    const later = C.regions.flatMap((r) => meetingsFor(r.name).later).sort((a, b) => a.start - b.start);
    const section = $("#laterSection");
    const list = $("#laterList");
    section.hidden = later.length === 0;
    section.classList.toggle("later--none-here", !later.some((m) => m.region === state.region));
    list.textContent = "";
    later.forEach((m) => {
      const p = dateParts(m.start);
      const color = C.regions.find((r) => r.name === m.region).color;
      list.append(el("li", { class: m.region === state.region ? null : "is-other" },
        el("a", { class: "later__item", href: mapURL(m), target: "_blank", rel: "noopener" },
          el("span", { class: "later__region", style: `--c:${color}` }, m.region),
          el("span", { class: "later__date" }, el("strong", {}, p.md), el("span", {}, p.dow)),
          el("span", { class: "later__info" }, el("strong", {}, m.venue), el("span", {}, p.time)),
          icon("pin"))));
    });
  }

  /* 新朋友頁：還沒到現場的人看下一場資訊 */
  function renderEntryNext() {
    const { next } = meetingsFor(state.region);
    const p = next ? dateParts(next.start) : null;
    $("#nextDate").textContent = p ? p.md : "確認中";
    $("#nextDow").textContent = p ? p.dow : "";
    $("#nextTime").textContent = p ? p.time : "";
    $("#nextVenue").textContent = next ? next.venue
      : state.meetingsFailed ? "暫時讀不到聚會資料" : "";
    $("#entryCal").hidden = !next;
    $("#entryMap").hidden = !next;
    if (next) {
      $("#entryCal").href = calendarURL(next);
      $("#entryMap").href = mapURL(next);
    }
  }

  function renderMeetings(animate) {
    /* 切換地區只開合色塊，資料載入時才重畫，動畫才接得上 */
    if (!animate) renderHero();
    renderRegionSwitches();
    renderLater();
    renderEntryNext();
    tick();
  }

  function setRegion(name) {
    state.region = name;
    storage.set(REGION_KEY, name);
    renderMeetings(true);
  }

  function tick() {
    $$("[data-countdown]").forEach((box) => {
      const { next } = meetingsFor(box.dataset.region);
      if (!next) return;
      const diff = next.start.getTime() - Date.now();
      if (diff <= 0) {
        box.replaceWith(el("p", { class: "sticker sticker--live" }, "聚會進行中"));
        return;
      }
      const d = Math.floor(diff / 864e5);
      const h = Math.floor((diff % 864e5) / 36e5);
      const m = Math.floor((diff % 36e5) / 6e4);
      const s = Math.floor((diff % 6e4) / 1000);
      const set = (u, txt) => {
        const t = $(`[data-unit="${u}"]`, box);
        if (t.textContent === txt) return;
        const changed = t.textContent !== "--";
        t.textContent = txt;
        if (changed) flipDigit(t);
      };
      const two = (v) => String(v).padStart(2, "0");
      set("d", String(d)); set("h", two(h)); set("m", two(m)); set("s", two(s));
      box.setAttribute("aria-label", `距離聚會還有 ${d} 天 ${h} 小時 ${m} 分`);
    });
  }

  /* ---------- 數據 ---------- */
  function renderStats(stats) {
    ["#homeStats", "#campusStats"].forEach((sel) => {
      const box = $(sel);
      box.textContent = "";
      stats.forEach((s) => {
        const isNumber = /^\d+$/.test(s.value);
        box.append(
          el("span", { class: "stat" },
            el("span", { class: "stat__num" },
              el("span", { "data-count": isNumber ? s.value : null }, s.value),
              el("small", {}, s.unit)),
            el("span", { class: "stat__label" }, s.label)));
      });
      observeReveal($$(".stat", box));
    });
  }

  /* ---------- 動態 ---------- */
  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function countUp(node) {
    const target = Number(node.dataset.count);
    const started = performance.now();
    const step = (now) => {
      const t = Math.min((now - started) / 1300, 1);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    node.textContent = "0";
    requestAnimationFrame(step);
  }

  /* 校名膠帶：平常慢慢跑，往下捲時跟著加速 */
  let tapeStarted = false;
  let tapeMeasure = () => {};

  function runTape(track) {
    if (tapeStarted || calm()) return;
    tapeStarted = true;
    const tape = $("#tape");
    let copy = track.scrollWidth / 2;
    const measure = () => { copy = track.scrollWidth / 2; };
    tapeMeasure = measure;
    window.addEventListener("resize", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    let hovering = false;
    tape.addEventListener("pointerenter", () => { hovering = true; });
    tape.addEventListener("pointerleave", () => { hovering = false; });
    let x = 0;
    let last = performance.now();
    let lastY = window.scrollY;
    let boost = 0;
    const frame = (now) => {
      const dt = Math.min(now - last, 50);
      last = now;
      boost = Math.min(boost * 0.92 + Math.abs(window.scrollY - lastY) * 0.3, 16);
      lastY = window.scrollY;
      if (!copy) measure();
      if (document.body.dataset.route === "home" && !hovering && copy) {
        x -= 0.05 * dt + boost;
        if (-x >= copy) x += copy;
        track.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function renderTape() {
    const names = state.schools.map((s) => s.name);
    $("#tapeWrap").hidden = !names.length;
    if (!names.length) return;
    const line = `${names.join("　/　")}　/　`;
    const track = $("#tapeTrack");
    track.textContent = "";
    const copy = () => el("span", {},
      state.mySchool ? [el("b", { class: "tape__mine" }, state.mySchool), "　/　"] : null, line);
    track.append(copy(), copy());
    $("#tape").setAttribute("aria-label", `查看 ${names.length} 所參與校園`);
    runTape(track);
    tapeMeasure();
  }

  /* 手畫底線 */
  const SCRIBBLES = ["M2 8C30 3 58 11 88 6s62-4 110 2", "M2 5c40 7 66-3 102 3s60 3 94-2", "M3 9C44 2 70 9 110 5s58 1 87 3"];

  function addScribbles() {
    $$(".section-title").forEach((title, i) => {
      const svg = svgNode("svg", { class: "scribble", viewBox: "0 0 200 12", "aria-hidden": "true" });
      svg.append(svgNode("path", { d: SCRIBBLES[i % SCRIBBLES.length], pathLength: "1" }));
      title.append(svg);
    });
  }

  /* 捲動到才浮現。瀏覽器不支援或使用者關閉動態時，內容一開始就全部顯示 */
  let revealer = null;

  function observeReveal(nodes) {
    if (!revealer) return;
    nodes.forEach((node) => { node.classList.add("reveal"); revealer.observe(node); });
  }

  function setupReveal() {
    if (calm() || !("IntersectionObserver" in window)) return;
    revealer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        $$("[data-count]", e.target).forEach(countUp);
        revealer.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -6% 0px" });
    observeReveal($$(".stack > *"));
  }

  function flipDigit(node) {
    if (calm() || !node.animate || !node.closest(".panel.is-open")) return;
    node.animate(
      [{ transform: "translateY(35%)", opacity: 0.25 }, { transform: "none", opacity: 1 }],
      { duration: 320, easing: "cubic-bezier(.22,.8,.3,1)" });
  }

  /* ---------- 學校 ---------- */
  function renderSchoolFilter() {
    const counts = { 全部: state.schools.length };
    state.schools.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
    const box = $("#schoolFilter");
    box.textContent = "";
    box.style.setProperty("--n", Object.keys(counts).length);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => box.append(
      el("button", {
        type: "button", class: "filter__btn", "aria-pressed": String(cat === state.schoolCategory),
        onclick: () => { state.schoolCategory = cat; renderSchoolFilter(); renderSchools(true); },
      }, el("span", {}, cat), el("small", {}, String(n)))));
  }

  function renderSchools(animate) {
    const q = state.schoolQuery.trim().toLowerCase();
    const list = state.schools.filter((s) =>
      (state.schoolCategory === "全部" || s.category === state.schoolCategory) &&
      (!q || s.name.toLowerCase().includes(q)));
    const box = $("#schoolList");
    box.textContent = "";
    box.classList.toggle("schools--in", animate === true);
    list.forEach((s, i) => box.append(el("li", { class: "school", style: `--i:${i}` }, s.name)));
    $("#schoolEmpty").hidden = list.length > 0;
    $("#schoolCount").textContent = `共 ${list.length} 所學校`;
  }

  /* ---------- 感動牆 ---------- */
  function renderStories() {
    const row = $("#storyRow");
    row.textContent = "";
    row.append(el("button", { class: "story story--add", type: "button", "data-story-add": true },
      el("span", { class: "story__add-icon" }, icon("camera")),
      el("span", { class: "story__add-text" }, "拍下感動")));
    state.stories.forEach((s, i) => row.append(
      el("button", { class: "story", type: "button", "aria-label": `${s.school}的照片，${hoursLeft(s.time)}`, onclick: () => openViewer(i) },
        el("img", { src: s.photo, alt: "", loading: "lazy", width: "112", height: "168" }),
        el("span", { class: "story__school" }, s.school),
        el("span", { class: "story__left" }, hoursLeft(s.time)))));
  }

  function showStory(i) {
    state.storyIndex = i;
    const s = state.stories[i];
    $("#viewerImg").src = s.photo;
    $("#viewerImg").alt = `${s.school}的校園感動照片`;
    $("#viewerSchool").textContent = s.school;
    $("#viewerLeft").textContent = hoursLeft(s.time);
    $("#viewerPrev").hidden = i === 0;
    $$("#viewerBars span").forEach((bar, idx) => bar.classList.toggle("on", idx <= i));
  }

  function openViewer(i) {
    const bars = $("#viewerBars");
    bars.textContent = "";
    state.stories.forEach(() => bars.append(el("span")));
    showStory(i);
    openDialog($("#storyViewer"));
  }

  function moveStory(step) {
    const next = state.storyIndex + step;
    if (next < 0) return;
    if (next >= state.stories.length) { closeDialog($("#storyViewer")); return; }
    showStory(next);
  }

  let pendingPhoto = "";

  function startStoryAdd() {
    if (C.links.storyUpload) { window.open(C.links.storyUpload, "_blank", "noopener"); return; }
    $("#storyFile").click();
  }

  /* ---------- 代禱牆 ---------- */
  /* 「我為這件事禱告」只記在這台裝置，不會上傳，也不顯示人數 */
  const PRAYED_KEY = "campus-church-prayed";
  const prayerId = (p) => `${p.name}|${(p.prayer || p.thanks || "").slice(0, 40)}`;

  function prayedIds() {
    try { return JSON.parse(storage.get(PRAYED_KEY)) || []; } catch (e) { return []; }
  }

  function markPrayed(id, card) {
    storage.set(PRAYED_KEY, JSON.stringify(prayedIds().concat(id).slice(-200)));
    state.justPrayed.add(id);
    $(".pray", card).disabled = true;
    /* 送到「代禱回應」表單，統計後大家都看得到人數；示範模式不會送出 */
    D.submit("prayed", { id }).catch((err) => console.error("[校園教會] 代禱回應送出失敗", err));
    if (calm() || !card.animate) { paintPrayed(card); paintCount(card, true); return; }
    stampCard(card);
  }

  /* 只要有人按過（試算表裡有紀錄，或自己剛剛按的），就告訴寫的人「有人為這件事禱告了」，不顯示人數 */
  function paintCount(card, bump) {
    const id = card.dataset.id;
    const n = (state.prayedCounts.get(id) || 0) + (state.justPrayed.has(id) ? 1 : 0);
    const line = $(".prayer__count", card);
    line.hidden = n === 0;
    if (bump) {
      line.classList.remove("is-up");
      void line.offsetWidth;
      line.classList.add("is-up");
    }
  }

  function applyPrayedCounts(list) {
    state.prayedCounts = new Map(list.map((x) => [x.id, x.count]));
    $$(".prayer").forEach((card) => paintCount(card, false));
  }

  /* 拿起印章、對準、舉高、重重蓋下、左右壓一壓，抬走後才露出還沒乾的墨跡 */
  const STAMP_MS = 1600;
  const STAMP_HIT = 0.46;
  const STAMP_LIFT = 0.72;

  function stampBurst() {
    const burst = svgNode("svg", { class: "stamp-rig__burst", viewBox: "-84 -84 168 168" });
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      burst.append(svgNode("line", {
        x1: (Math.cos(a) * 58).toFixed(1), y1: (Math.sin(a) * 52).toFixed(1),
        x2: (Math.cos(a) * 78).toFixed(1), y2: (Math.sin(a) * 72).toFixed(1),
      }));
    }
    return burst;
  }

  function stampCard(card) {
    const stamper = svgNode("svg", { class: "stamper", viewBox: "0 0 120 170" });
    stamper.append(svgNode("use", { href: "#i-stamper" }));
    const shadow = el("i", { class: "stamp-rig__shadow" });
    const burst = stampBurst();
    const rig = el("div", { class: "stamp-rig", "aria-hidden": "true" }, shadow, burst, stamper);
    card.append(rig);
    card.classList.add("is-stamping");
    const timing = { duration: STAMP_MS };
    stamper.animate([
      { offset: 0, opacity: 0, transform: "translate(96px, -200px) rotate(28deg) scale(1.1)", easing: "cubic-bezier(.2,.8,.3,1)" },
      { offset: 0.14, opacity: 1, transform: "translate(30px, -132px) rotate(12deg) scale(1.04)", easing: "ease-in-out" },
      { offset: 0.26, opacity: 1, transform: "translate(0, -104px) rotate(-6deg)", easing: "cubic-bezier(.3,0,.3,1)" },
      { offset: 0.38, opacity: 1, transform: "translate(0, -146px) rotate(-12deg) scale(1.05)", easing: "cubic-bezier(.75,0,1,.7)" },
      { offset: STAMP_HIT, opacity: 1, transform: "none", easing: "ease-out" },
      { offset: 0.49, opacity: 1, transform: "scale(1.07, .92)", easing: "ease-in-out" },
      { offset: 0.56, opacity: 1, transform: "rotate(4deg) scale(1.01, .96)", easing: "ease-in-out" },
      { offset: 0.63, opacity: 1, transform: "rotate(-4deg) scale(1.01, .96)", easing: "ease-in-out" },
      { offset: 0.7, opacity: 1, transform: "scale(1, .97)", easing: "cubic-bezier(.5,0,.2,1)" },
      { offset: 0.82, opacity: 1, transform: "translate(8px, -64px) rotate(-8deg)", easing: "cubic-bezier(.6,0,.9,.5)" },
      { offset: 1, opacity: 0, transform: "translate(90px, -230px) rotate(26deg) scale(1.1)" },
    ], timing).onfinish = () => {
      rig.remove();
      card.classList.remove("is-stamping");
    };
    shadow.animate([
      { offset: 0, opacity: 0, transform: "scale(1.6)" },
      { offset: 0.26, opacity: 0.32, transform: "scale(1.3)" },
      { offset: 0.38, opacity: 0.16, transform: "scale(1.6)", easing: "cubic-bezier(.75,0,1,.7)" },
      { offset: STAMP_HIT, opacity: 0.85, transform: "scale(1)" },
      { offset: 0.7, opacity: 0.85, transform: "scale(1)" },
      { offset: 0.82, opacity: 0.32, transform: "scale(1.25)" },
      { offset: 1, opacity: 0, transform: "scale(1.6)" },
    ], timing);
    burst.animate(
      [{ transform: "scale(.72)", opacity: 0 }, { transform: "scale(.9)", opacity: 1, offset: 0.18 }, { transform: "scale(1.4)", opacity: 0 }],
      { duration: 420, delay: STAMP_MS * STAMP_HIT, easing: "cubic-bezier(.2,.8,.3,1)", fill: "both" });
    setTimeout(() => {
      const base = getComputedStyle(card).transform;
      card.animate([
        { transform: base },
        { transform: `${base} translateY(10px) rotate(-1.3deg) scale(.975)` },
        { transform: `${base} translateY(-3px) rotate(.6deg)` },
        { transform: base },
      ], { duration: 420, easing: "cubic-bezier(.2,.9,.3,1)" });
      if (navigator.vibrate) navigator.vibrate(25);
    }, STAMP_MS * STAMP_HIT);
    setTimeout(() => {
      paintPrayed(card);
      paintCount(card, true);
      $(".prayer__stamp", card).classList.add("is-wet");
    }, STAMP_MS * STAMP_LIFT);
  }

  /* 蓋了章就不能取消 */
  function paintPrayed(card) {
    card.classList.add("is-prayed");
    const button = $(".pray", card);
    button.disabled = true;
    $(".pray__text", button).textContent = "已經禱告了";
  }

  function prayerCard(p) {
    const id = prayerId(p);
    const card = el("article", { class: "prayer", "data-id": id },
      el("header", { class: "prayer__head" },
        el("span", { class: "prayer__who" }, el("strong", {}, p.name), p.partners ? el("span", {}, `和 ${p.partners}`) : null),
        el("time", { class: "prayer__time" }, ago(p.time))),
      p.prayer ? el("div", { class: "prayer__block" }, el("h3", {}, "代禱"), el("p", {}, p.prayer)) : null,
      p.thanks ? el("div", { class: "prayer__block" }, el("h3", {}, "感恩"), el("p", {}, p.thanks)) : null,
      el("p", { class: "prayer__count", hidden: true }, icon("heart"), "有人為這件事禱告了"),
      el("button", { class: "pray", type: "button", onclick: () => markPrayed(id, card) },
        icon("heart"), el("span", { class: "pray__text" }, "我為這件事禱告")),
      el("span", { class: "prayer__stamp", "aria-hidden": "true" }, "禱告了"));
    if (prayedIds().includes(id)) paintPrayed(card);
    paintCount(card, false);
    return card;
  }

  function renderPrayers(list) {
    const wall = $("#prayerWall");
    wall.textContent = "";
    if (!list.length) { wall.append(el("p", { class: "empty" }, "這週還沒有人寫代禱，你可以當第一個。")); return; }
    list.forEach((p) => wall.append(prayerCard(p)));
    observeReveal($$(".prayer", wall));
  }

  /* ---------- 新朋友：一題一題填，名字即時寫到名牌上 ---------- */
  const ENTRY_LAST = 6;
  let entryStep = 0;

  function showEntryStep(n, focus) {
    entryStep = n;
    const entry = $("#entry");
    entry.dataset.step = String(n);
    $$(".q", entry).forEach((q) => { q.hidden = Number(q.dataset.q) !== n; });
    const progress = $("#entryProgress");
    progress.hidden = n === 0;
    progress.textContent = n ? `第 ${n} 題，共 ${ENTRY_LAST} 題` : "";
    $("#entryBack").hidden = n === 0;
    $("#entryNext").hidden = n === ENTRY_LAST;
    $("#entrySubmit").hidden = n !== ENTRY_LAST;
    $("#entryNextText").textContent = n === 0 ? "寫下我的名牌" : "下一題";
    /* 第一頁時名牌本身就是按鈕 */
    const tag = $("#tag");
    const isButton = n === 0 && !entry.classList.contains("is-done");
    if (isButton) {
      tag.setAttribute("role", "button");
      tag.setAttribute("tabindex", "0");
      tag.setAttribute("aria-label", "寫下我的名牌");
    } else {
      tag.removeAttribute("role");
      tag.removeAttribute("tabindex");
      tag.setAttribute("aria-label", "你的名牌預覽");
    }
    if (!$("#nf-name").value.trim()) printName("");
    if (!focus) return;
    window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    /* 要在點擊當下 focus，手機鍵盤才會跳出來 */
    const input = $('.q:not([hidden]) input[size], .q:not([hidden]) textarea', entry);
    if (input) input.focus({ preventScroll: true });
  }

  function entryNext() {
    const current = $(`.q[data-q="${entryStep}"]`);
    if (!validate(current)) return;
    showEntryStep(Math.min(entryStep + 1, ENTRY_LAST), true);
  }

  function printName(value) {
    const name = $("#tagName");
    const text = value.trim();
    name.textContent = text || (entryStep === 0 ? "點我寫名字" : "你的名字");
    name.classList.toggle("is-empty", !text);
    /* 名字越長字越小，才寫得進名牌 */
    name.style.setProperty("--fit", text ? String(Math.max(0.4, Math.min(1, 5 / Array.from(text).length))) : "0.72");
    if (text && !calm() && name.animate) {
      name.animate([{ transform: "translateY(6px) rotate(-3deg)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 200 });
    }
  }

  function printMeta(form) {
    const school = form.school.value.trim();
    const by = form.invitedBy.value.trim();
    $("#tagMeta").textContent = [school, by ? `${by} 邀請我來` : ""].filter(Boolean).join("　");
  }

  /* 送出後：名牌折成紙飛機寄給同工 → 另一架紙飛機飛回來、打開變回名牌 → 蓋上「收到了」 → 學校跳進跑馬燈 */
  const MY_SCHOOL_KEY = "campus-church-my-school";
  const PLANE_OUT_AT = 280;
  const PLANE_OUT_MS = 1050;
  const PLANE_BACK_AT = 1550;
  const PLANE_BACK_MS = 1150;
  const UNFOLD_AT = PLANE_BACK_AT + PLANE_BACK_MS;
  const INK_AT = UNFOLD_AT + 420;
  const TAPE_AT = INK_AT + 280;

  function paperPlane() {
    const plane = svgNode("svg", { class: "plane", viewBox: "0 0 120 80", "aria-hidden": "true" });
    plane.append(svgNode("use", { href: "#i-plane" }));
    return plane;
  }

  const at = (x, y, rest) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) ${rest}`;

  function flyPlanes(entry) {
    const tag = $("#tag");
    const badge = $("#entryBadge");
    const dx = window.innerWidth;
    const dy = window.innerHeight;
    const fold = tag.animate(
      [{ transform: "rotate(-2deg)", opacity: 1 }, { transform: "rotate(-8deg) rotateX(75deg) scale(.6)", opacity: 0 }],
      { duration: 450, easing: "cubic-bezier(.5,0,.9,.6)", fill: "forwards" });

    const out = paperPlane();
    badge.append(out);
    out.animate([
      { offset: 0, opacity: 0, transform: at(0, 0, "rotate(-6deg) scale(.3)") },
      { offset: 0.18, opacity: 1, transform: at(0, 0, "rotate(-10deg) scale(1)"), easing: "ease-out" },
      { offset: 0.38, opacity: 1, transform: at(-44, 20, "rotate(-2deg)"), easing: "cubic-bezier(.55,0,.9,.6)" },
      { offset: 1, opacity: 1, transform: at(dx, -dy * 0.8, "rotate(-26deg) scale(.6)") },
    ], { duration: PLANE_OUT_MS, delay: PLANE_OUT_AT, fill: "both" }).onfinish = () => out.remove();

    const back = paperPlane();
    badge.append(back);
    const landing = back.animate([
      { offset: 0, opacity: 1, transform: at(-dx, -dy * 0.5, "rotate(20deg) scale(.7)"), easing: "cubic-bezier(.3,.6,.4,1)" },
      { offset: 0.6, opacity: 1, transform: at(40, 34, "rotate(12deg) scale(1)"), easing: "ease-in-out" },
      { offset: 0.84, opacity: 1, transform: at(-12, -8, "rotate(-8deg) scale(1)"), easing: "ease-out" },
      { offset: 1, opacity: 1, transform: at(0, 0, "rotate(0) scale(1)") },
    ], { duration: PLANE_BACK_MS, delay: PLANE_BACK_AT, fill: "both" });

    landing.onfinish = () => {
      back.animate([{ transform: at(0, 0, "scale(1)"), opacity: 1 }, { transform: at(0, 0, "scale(1.4) rotate(-10deg)"), opacity: 0 }],
        { duration: 260, fill: "forwards" }).onfinish = () => back.remove();
      fold.cancel();
      tag.animate(
        [{ transform: "rotate(8deg) rotateX(70deg) scale(.6)", opacity: 0 }, { transform: "rotate(-2deg)", opacity: 1 }],
        { duration: 480, easing: "cubic-bezier(.2,1.3,.4,1)" });
    };
    setTimeout(() => {
      entry.classList.add("is-received");
      const base = getComputedStyle(tag).transform;
      tag.animate([{ transform: base }, { transform: `${base} translateY(8px) scale(.97)` }, { transform: base }],
        { duration: 360, easing: "cubic-bezier(.2,.9,.3,1)" });
    }, INK_AT);
    setTimeout(showEntryTape, TAPE_AT);
  }

  /* 你的學校加入校名跑馬燈：送出那一刻在這頁出現，首頁的膠帶也會多一個你的學校（只存在這支手機） */
  function rememberSchool(form) {
    const school = form.school.value.trim().split(/\s+/)[0] || "";
    state.mySchool = school;
    storage.set(MY_SCHOOL_KEY, school);
    if (state.schools.length) renderTape();
  }

  function showEntryTape() {
    const names = state.schools.map((s) => s.name);
    if (!state.mySchool || !names.length) return;
    const track = $("#entryTapeTrack");
    track.textContent = "";
    /* 每隔幾所學校就插一次你的學校，跑馬燈任何時候都看得到 */
    const half = () => el("span", {}, names.flatMap((name, i) => (i % 6 === 0
      ? [el("b", { class: "tape__mine" }, state.mySchool), `　/　${name}　/　`]
      : [`${name}　/　`])));
    track.append(half(), half());
    $("#entryTape").hidden = false;
  }

  function celebrateEntry() {
    const entry = $("#entry");
    rememberSchool($('[data-form="newcomer"]'));
    entry.classList.add("is-done");
    window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    if (calm() || !entry.animate) {
      entry.classList.add("is-received");
      showEntryTape();
      return;
    }
    flyPlanes(entry);
    const colors = [...C.regions.map((r) => r.color), "#FF5500", "#FBF7EE", "#14110D"];
    for (let i = 0; i < 34; i += 1) {
      const paper = el("i", { class: "paper", "aria-hidden": "true", style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]}` });
      entry.append(paper);
      const drift = (Math.random() - 0.5) * 160;
      paper.animate(
        [{ transform: "translateY(-40px) rotate(0)" }, { transform: `translate(${drift}px, ${entry.offsetHeight + 80}px) rotate(${(Math.random() - 0.5) * 900}deg)` }],
        { duration: 1500 + Math.random() * 1100, delay: INK_AT + Math.random() * 350, easing: "cubic-bezier(.3,.2,.6,1)", fill: "both" }).onfinish = () => paper.remove();
    }
  }

  function resetEntry() {
    $("#entry").classList.remove("is-done", "is-received");
    $$("#entryBadge .plane").forEach((plane) => plane.remove());
    $("#tag").getAnimations().forEach((a) => a.cancel());
    $("#entryTape").hidden = true;
    printName("");
    $("#tagMeta").textContent = "";
    showEntryStep(0, false);
  }

  function setupEntry() {
    const form = $('[data-form="newcomer"]');
    const entry = $("#entry");
    $("#entryNext").addEventListener("click", entryNext);
    $("#entryBack").addEventListener("click", () => showEntryStep(Math.max(entryStep - 1, 0), true));
    /* 按 Enter 到下一題；中文輸入法選字時按的 Enter 不算，選完字再按一次才前進 */
    form.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); entryNext(); }
    });
    form.name.addEventListener("input", (e) => printName(e.target.value));
    form.school.addEventListener("input", () => printMeta(form));
    form.invitedBy.addEventListener("input", () => printMeta(form));
    /* 滑鼠或手指選了就自動下一題；用鍵盤方向鍵切換時不跳走 */
    $$('input[name="faith"]', form).forEach((radio) => radio.addEventListener("click", (e) => {
      if (e.detail > 0) setTimeout(() => { if (entryStep === 5) showEntryStep(6, true); }, 260);
    }));

    /* 點名牌也能開始填 */
    const tag = $("#tag");
    const startFromTag = () => { if (tag.getAttribute("role") === "button") entryNext(); };
    tag.addEventListener("click", startFromTag);
    tag.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startFromTag(); }
    });

    /* 電腦版：名牌跟著滑鼠微微傾斜 */
    if (!calm() && window.matchMedia("(hover: hover) and (min-width: 960px)").matches) {
      entry.addEventListener("pointermove", (e) => {
        const r = entry.getBoundingClientRect();
        tag.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 16}deg`);
        tag.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - 0.5) * -12}deg`);
      });
      entry.addEventListener("pointerleave", () => { tag.style.setProperty("--ry", "0deg"); tag.style.setProperty("--rx", "0deg"); });
    }
    showEntryStep(0, false);
  }

  /* ---------- 對話框 ---------- */
  function openDialog(d) {
    if (d.open) return;
    d.showModal();
    document.documentElement.classList.add("locked");
  }

  function closeDialog(d) {
    d.close();
  }

  function setupDialogs() {
    $$("dialog").forEach((d) => {
      d.addEventListener("close", () => {
        if (!$("dialog[open]")) document.documentElement.classList.remove("locked");
        const form = $("[data-form]", d);
        const success = form && $(`[data-success="${form.dataset.form}"]`, d);
        if (success && !success.hidden) resetForm(form.dataset.form);
      });
      d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
    });
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-open],[data-close],[data-swap],[data-story-add],[data-reset]");
      if (!trigger) return;
      if (trigger.dataset.open) openDialog($(`#${trigger.dataset.open}`));
      if ("close" in trigger.dataset) closeDialog(trigger.closest("dialog"));
      if (trigger.dataset.swap) { closeDialog(trigger.closest("dialog")); openDialog($(`#${trigger.dataset.swap}`)); }
      if ("storyAdd" in trigger.dataset) { const d = trigger.closest("dialog"); if (d) closeDialog(d); startStoryAdd(); }
      if (trigger.dataset.reset) resetForm(trigger.dataset.reset);
    });

    $("#viewerPrev").addEventListener("click", () => moveStory(-1));
    $("#viewerNext").addEventListener("click", () => moveStory(1));
    $("#storyViewer").addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") moveStory(1);
      if (e.key === "ArrowLeft") moveStory(-1);
    });

    $("#storyFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto);
      pendingPhoto = URL.createObjectURL(file);
      $("#storyPreview").src = pendingPhoto;
      e.target.value = "";
      openDialog($("#dlgStory"));
    });

    $("#storyForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      if (!validate(form)) return;
      state.stories.unshift({ school: form.school.value.trim(), photo: pendingPhoto, time: new Date() });
      pendingPhoto = "";
      form.reset();
      renderStories();
      closeDialog($("#dlgStory"));
    });
  }

  /* ---------- 表單 ---------- */
  function fieldError(input, message) {
    const err = $(".field__err", input.closest(".field"));
    if (!err) return;
    err.textContent = message || "";
    err.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function validate(form) {
    let first = null;
    $$("[required]", form).forEach((input) => {
      const empty = !input.value.trim();
      fieldError(input, empty ? "這一格還沒填喔" : "");
      if (empty && !first) first = input;
    });
    if (form.dataset.requireOne) {
      const names = form.dataset.requireOne.split(",");
      const inputs = names.map((n) => form.elements[n]);
      const none = inputs.every((i) => !i.value.trim());
      fieldError(inputs[inputs.length - 1], none ? "代禱或感恩至少寫一項" : "");
      if (none && !first) first = inputs[0];
    }
    if (first) first.focus();
    return !first;
  }

  function resetForm(key) {
    const form = $(`[data-form="${key}"]`);
    const success = $(`[data-success="${key}"]`);
    form.reset();
    form.hidden = false;
    success.hidden = true;
    if (key === "newcomer") resetEntry();
  }

  function setupForms() {
    $$("[data-form]").forEach((form) => {
      const key = form.dataset.form;
      const button = $('button[type="submit"]', form);
      const failure = $(".form__err", form);
      form.addEventListener("input", (e) => {
        if (e.target.getAttribute("aria-invalid")) fieldError(e.target, "");
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        failure.hidden = true;
        if (!validate(form)) return;
        const values = Object.fromEntries(new FormData(form).entries());
        button.disabled = true;
        button.classList.add("is-loading");
        try {
          const result = await D.submit(key, values);
          const success = $(`[data-success="${key}"]`);
          $(".success__demo", success).hidden = !result.demo;
          form.hidden = true;
          success.hidden = false;
          success.focus();
          if (key === "sharing") prependPrayer(values);
          if (key === "newcomer") celebrateEntry();
        } catch (err) {
          console.error("[校園教會] 表單送出失敗", err);
          failure.textContent = "送出失敗了，請檢查網路後再試一次，你填的內容都還在。";
          failure.hidden = false;
        } finally {
          button.disabled = false;
          button.classList.remove("is-loading");
        }
      });
    });
  }

  function prependPrayer(values) {
    const wall = $("#prayerWall");
    const empty = $(".empty", wall);
    if (empty) empty.remove();
    wall.prepend(prayerCard({ time: new Date(), name: values.name, partners: values.partners, prayer: values.prayer, thanks: values.thanks }));
  }

  /* ---------- 分頁 ---------- */
  const TITLES = { home: "校園教會｜Friday Night × Sunday Reset", welcome: "新朋友專區｜校園教會", prayer: "本週代禱牆｜校園教會", campus: "校園 1000｜校園教會" };
  let firstRoute = true;

  function route() {
    const hash = location.hash;
    if (hash && !hash.startsWith("#/")) return;
    const name = hash.replace(/^#\/?/, "") || "home";
    const target = TITLES[name] ? name : "home";
    document.body.dataset.route = target;
    $$(".view").forEach((v) => { v.hidden = v.dataset.view !== target; });
    $$(".tab").forEach((t, i) => {
      if (t.dataset.route === target) {
        t.setAttribute("aria-current", "page");
        $("#tabbar").style.setProperty("--t", i);
      } else {
        t.removeAttribute("aria-current");
      }
    });
    document.title = TITLES[target];
    window.scrollTo(0, 0);
    const wipe = $("#wipe");
    if (!firstRoute && !calm() && wipe.animate) {
      wipe.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { duration: 560, easing: "cubic-bezier(.5,0,.1,1)" });
    }
    if (!firstRoute) $(`[data-view="${target}"] h1`).focus({ preventScroll: true });
    firstRoute = false;
  }

  /* ---------- 啟動 ---------- */
  async function loadInto(key, onData, onFail) {
    try {
      onData(await D.load(key));
    } catch (err) {
      console.error(`[校園教會] 讀取「${key}」失敗：`, err);
      if (onFail) onFail(err);
    }
  }

  function init() {
    const saved = storage.get(REGION_KEY);
    if (saved && C.regions.some((r) => r.name === saved)) state.region = saved;
    state.mySchool = storage.get(MY_SCHOOL_KEY) || "";

    $("#photosLink").href = C.links.photos;
    $("#demoNote").hidden = !D.usingSampleData();
    $("#skipLink").addEventListener("click", () => $(".view:not([hidden]) h1").focus());
    $("#schoolSearch").addEventListener("input", (e) => { state.schoolQuery = e.target.value; renderSchools(); });

    setupDialogs();
    setupForms();
    setupEntry();
    window.addEventListener("hashchange", () => { route(); fitDates(); });
    window.addEventListener("resize", fitDates);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitDates);
    route();
    renderRegionSwitches();
    renderStories();
    addScribbles();
    setupReveal();

    loadInto("meetings", (list) => { state.meetings = list; renderMeetings(); }, () => { state.meetingsFailed = true; renderMeetings(); });
    loadInto("stats", renderStats);
    loadInto("schools", (list) => { state.schools = list; renderSchoolFilter(); renderSchools(); renderTape(); });
    loadInto("stories", (list) => { state.stories = list; renderStories(); });
    /* 讀不到人數統計時不影響代禱牆，只是不顯示人數 */
    loadInto("prayed", applyPrayedCounts, () => {});
    loadInto("prayers", renderPrayers, () => {
      const wall = $("#prayerWall");
      wall.textContent = "";
      wall.append(el("p", { class: "empty" }, "暫時讀不到代禱牆，請稍後再回來看看。"));
    });

    setInterval(tick, 1000);
  }

  init();
})();
