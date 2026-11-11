/* ============================================================
   校園教會網站設定檔：接資料只需要改這一個檔案
   詳細步驟請看 README.md
   ============================================================ */
window.SITE_CONFIG = {

  /* ----------------------------------------------------------
     一、網站讀取的資料（五張表）
     現在指向 data/ 資料夾裡的範例 CSV。
     接上 Google 試算表時，把右邊換成「發布到網路」的 CSV 網址。
     ⚠️ 被發布的工作表任何人都看得到，私密代禱和新朋友名單絕對不要發布。
     ---------------------------------------------------------- */
  dataSources: {
    meetings: "data/meetings.csv", // 聚會場次：地區、日期、時間、地點、地圖連結
    stats:    "data/stats.csv",    // 異象數據：項目、數字、單位
    schools:  "data/schools.csv",  // 參與校園：學校、類別
    stories:  "data/stories.csv",  // 48 小時感動牆：學校、照片、時間、公開
    prayers:  "data/prayers.csv",  // 代禱牆：時間、姓名、夥伴、代禱、感恩、公開
  },

  /* ----------------------------------------------------------
     二、網站送出的表單（四份 Google 表單）
     enabled 改成 true 才會真的送出；false 時是示範模式，什麼都不會寄出。
     fields 右邊填 Google 表單的 entry 編號。
     ---------------------------------------------------------- */
  forms: {
    newcomer: { // 新朋友留名（這份是目前網站正在使用的表單）
      enabled: false,
      action: "https://docs.google.com/forms/d/e/1FAIpQLSd6Ebb61oyBE_INcv-SCbJLah2apwGi1xucBToYnuUqyWsK_w/formResponse",
      fields: {
        name:      "entry.1740683344",
        contact:   "entry.1691238499",
        school:    "entry.560641113",
        invitedBy: "entry.444747201",
        faith:     "entry.1118671752",
        prayer:    "entry.1802371490",
      },
    },
    sharing: { // 聚會回填（內容會出現在代禱牆）
      enabled: false,
      action: "",
      fields: { name: "", partners: "", prayer: "", thanks: "" },
    },
    privatePrayer: { // 私密代禱（只有關懷同工看得到，回覆表不可發布）
      enabled: false,
      action: "",
      fields: { name: "", prayer: "" },
    },
    invite: { // 新朋友邀約集氣（同工用）
      enabled: false,
      action: "",
      fields: { reporter: "", target: "" },
    },
  },

  /* ----------------------------------------------------------
     三、外部連結
     ---------------------------------------------------------- */
  links: {
    photos: "https://drive.google.com/drive/u/0/folders/1Sd_tZqhAkr0gruMfN6abI9nFFq6Lbb_y",
    // 上傳限時感動的 Google 表單網址（含檔案上傳題）。留空時是示範模式，照片只留在自己的手機上。
    storyUpload: "",
  },

  /* ----------------------------------------------------------
     四、地區與其他設定
     地區名稱要和 meetings 表的「地區」欄一字不差。
     顏色上面會壓深藍色文字，請選明亮的顏色。
     ---------------------------------------------------------- */
  regions: [
    { name: "北區", color: "#4FC3B0" },
    { name: "中區", color: "#F0628A" },
    { name: "南區", color: "#F2B632" },
  ],
  meetingHours: 2,      // 每場聚會大約幾小時（用於行事曆結束時間）
  storyHours: 48,       // 感動牆照片顯示幾小時
  prayerWallLimit: 30,  // 代禱牆最多顯示幾則
};
