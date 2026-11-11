/* 資料層：讀取 CSV、整理欄位、送出表單。畫面程式只透過 window.CampusData 拿資料。 */
(function () {
  "use strict";

  const C = window.SITE_CONFIG;

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const src = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

    const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
    if (!clean.length) return [];
    const headers = clean[0].map((h) => h.trim());
    return clean.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
      return obj;
    });
  }

  async function loadCSV(key) {
    const url = C.dataSources[key];
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error(`${key}: 網址回傳的是網頁而不是 CSV，請確認試算表已「發布到網路」並選擇 CSV 格式`);
    }
    return parseCSV(text);
  }

  const pick = (row, names) => {
    for (const n of names) if (row[n]) return row[n];
    return "";
  };

  /* ---------- 時間（一律以台灣時間解讀） ---------- */
  const pad = (n) => String(n).padStart(2, "0");

  function parseClock(str) {
    const m = String(str).match(/(上午|下午|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(上午|下午|AM|PM|am|pm)?/);
    if (!m) return null;
    let h = +m[2];
    const mark = (m[1] || m[5] || "").toUpperCase();
    if ((mark === "下午" || mark === "PM") && h < 12) h += 12;
    if ((mark === "上午" || mark === "AM") && h === 12) h = 0;
    return { h, min: +m[3], s: +(m[4] || 0) };
  }

  function parseDay(str) {
    let m = String(str).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
    m = String(str).match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const now = new Date();
      let y = now.getFullYear();
      if (Date.UTC(y, +m[1] - 1, +m[2]) < now.getTime() - 180 * 864e5) y += 1;
      return { y, mo: +m[1], d: +m[2] };
    }
    return null;
  }

  function toDate(day, clock) {
    const c = clock || { h: 0, min: 0, s: 0 };
    return new Date(`${day.y}-${pad(day.mo)}-${pad(day.d)}T${pad(c.h)}:${pad(c.min)}:${pad(c.s)}+08:00`);
  }

  function parseStamp(str) {
    const rel = String(str).match(/(\d+)\s*(小時|天)前/);
    if (rel) return new Date(Date.now() - +rel[1] * (rel[2] === "天" ? 864e5 : 36e5));
    const day = parseDay(str);
    if (!day) return null;
    const rest = String(str).replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, "");
    return toDate(day, parseClock(rest));
  }

  /* ---------- 安全的圖片網址 ---------- */
  function photoURL(raw) {
    const url = String(raw || "").trim();
    if (!url) return "";
    const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=|thumbnail\?id=)([\w-]+)/);
    if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1200`;
    if (/^https:\/\//i.test(url)) return url;
    if (/^[\w./-]+\.(svg|png|jpe?g|webp|gif)$/i.test(url) && !url.includes("..")) return url;
    return "";
  }

  function safeLink(raw) {
    const url = String(raw || "").trim();
    return /^https:\/\//i.test(url) ? url : "";
  }

  const isHidden = (row) => /^(否|no|false)$/i.test(row["公開"] || "");

  /* ---------- 各張表整理成畫面要的格式 ---------- */
  const normalize = {
    meetings(rows) {
      const hours = C.meetingHours || 2;
      return rows.map((r) => {
        const day = parseDay(pick(r, ["日期"]));
        const clock = parseClock(pick(r, ["時間"]));
        const venue = pick(r, ["地點"]);
        const region = pick(r, ["地區"]);
        if (!day || !clock || !venue || !region) {
          console.warn("[校園教會] 這列聚會資料不完整，已略過：", r);
          return null;
        }
        const start = toDate(day, clock);
        return { region, venue, start, end: new Date(start.getTime() + hours * 36e5), map: safeLink(pick(r, ["地圖連結"])) };
      }).filter(Boolean).sort((a, b) => a.start - b.start);
    },
    stats(rows) {
      return rows.map((r) => ({ label: pick(r, ["項目"]), value: pick(r, ["數字"]), unit: pick(r, ["單位"]) })).filter((s) => s.label);
    },
    schools(rows) {
      return rows.map((r) => ({ name: pick(r, ["學校"]), category: pick(r, ["類別"]) || "其他" })).filter((s) => s.name);
    },
    stories(rows) {
      const limit = (C.storyHours || 48) * 36e5;
      const now = Date.now();
      return rows.filter((r) => !isHidden(r)).map((r) => ({
        school: pick(r, ["學校", "學校名稱"]) || "校園教會",
        photo: photoURL(pick(r, ["照片", "照片網址"])),
        time: parseStamp(pick(r, ["時間", "時間戳記", "Timestamp"])),
      })).filter((s) => s.photo && s.time && now - s.time.getTime() < limit && now >= s.time.getTime())
        .sort((a, b) => b.time - a.time);
    },
    prayers(rows) {
      return rows.filter((r) => !isHidden(r)).map((r) => ({
        time: parseStamp(pick(r, ["時間", "時間戳記", "Timestamp"])),
        name: pick(r, ["姓名", "暱稱", "填寫人"]) || "同學",
        partners: pick(r, ["夥伴", "今天的夥伴"]),
        prayer: pick(r, ["代禱", "本週代禱事項"]),
        thanks: pick(r, ["感恩", "本週感恩事項"]),
      })).filter((p) => p.prayer || p.thanks)
        .sort((a, b) => (b.time || 0) - (a.time || 0))
        .slice(0, C.prayerWallLimit || 30);
    },
    /* 代禱人數：可以直接用「代禱回應」表單的回覆表（一列一次），也可以是已經統計好的表（有「人數」欄） */
    prayed(rows) {
      const counts = new Map();
      rows.forEach((r) => {
        const id = pick(r, ["代禱編號", "編號"]);
        if (!id) return;
        const n = Number(pick(r, ["人數", "次數"])) || 1;
        counts.set(id, (counts.get(id) || 0) + n);
      });
      return Array.from(counts, ([id, count]) => ({ id, count }));
    },
  };

  async function load(key) {
    return normalize[key](await loadCSV(key));
  }

  /* ---------- 送出表單 ---------- */
  async function submit(key, values) {
    const form = C.forms[key];
    if (!form || !form.enabled || !form.action) {
      await new Promise((r) => setTimeout(r, 500));
      return { demo: true };
    }
    const body = new URLSearchParams();
    Object.entries(form.fields).forEach(([field, entry]) => {
      if (entry && values[field]) body.append(entry, values[field]);
    });
    await fetch(form.action, { method: "POST", mode: "no-cors", body });
    return { demo: false };
  }

  const usingSampleData = () => Object.values(C.dataSources).some((u) => u.startsWith("data/"));

  window.CampusData = { load, submit, usingSampleData, parseCSV };
})();
