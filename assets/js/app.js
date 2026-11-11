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

  function renderTicket() {
    const box = $("#welcomeMeeting");
    box.textContent = "";
    if (state.meetingsFailed) { box.append(retryBlock()); return; }
    const { next } = meetingsFor(state.region);
    if (!next) {
      box.append(el("p", { class: "ticket__none" }, `${state.region}下一場時間確認中`));
      return;
    }
    const p = dateParts(next.start);
    box.append(
      el("div", { class: "ticket__date" }, el("strong", {}, p.md), el("span", {}, p.dow)),
      el("div", { class: "ticket__info" },
        el("strong", {}, `${p.time} 開始`),
        el("span", {}, next.venue),
        el("span", { class: "ticket__links" },
          el("a", { href: mapURL(next), target: "_blank", rel: "noopener" }, icon("pin"), "看地圖"),
          el("a", { href: calendarURL(next), target: "_blank", rel: "noopener" }, icon("cal"), "加到行事曆"))));
  }

  function renderMeetings(animate) {
    /* 切換地區只開合色塊，資料載入時才重畫，動畫才接得上 */
    if (!animate) renderHero();
    renderRegionSwitches();
    renderLater();
    renderTicket();
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

  function runTape(track) {
    if (tapeStarted || calm()) return;
    tapeStarted = true;
    const tape = $("#tape");
    let copy = track.scrollWidth / 2;
    const measure = () => { copy = track.scrollWidth / 2; };
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
    track.append(el("span", {}, line), el("span", {}, line));
    $("#tape").setAttribute("aria-label", `查看 ${names.length} 所參與校園`);
    runTape(track);
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
  function prayerCard(p) {
    return el("article", { class: "prayer" },
      el("header", { class: "prayer__head" },
        el("span", { class: "prayer__who" }, el("strong", {}, p.name), p.partners ? el("span", {}, `和 ${p.partners}`) : null),
        el("time", { class: "prayer__time" }, ago(p.time))),
      p.prayer ? el("div", { class: "prayer__block" }, el("h3", {}, "代禱"), el("p", {}, p.prayer)) : null,
      p.thanks ? el("div", { class: "prayer__block" }, el("h3", {}, "感恩"), el("p", {}, p.thanks)) : null);
  }

  function renderPrayers(list) {
    const wall = $("#prayerWall");
    wall.textContent = "";
    if (!list.length) { wall.append(el("p", { class: "empty" }, "這週還沒有人寫代禱，你可以當第一個。")); return; }
    list.forEach((p) => wall.append(prayerCard(p)));
    observeReveal($$(".prayer", wall));
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

    $("#photosLink").href = C.links.photos;
    $("#demoNote").hidden = !D.usingSampleData();
    $("#skipLink").addEventListener("click", () => $(".view:not([hidden]) h1").focus());
    $("#schoolSearch").addEventListener("input", (e) => { state.schoolQuery = e.target.value; renderSchools(); });

    setupDialogs();
    setupForms();
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
    loadInto("prayers", renderPrayers, () => {
      const wall = $("#prayerWall");
      wall.textContent = "";
      wall.append(el("p", { class: "empty" }, "暫時讀不到代禱牆，請稍後再回來看看。"));
    });

    setInterval(tick, 1000);
  }

  init();
})();
