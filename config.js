// ============================================================
// config.js — 全局配置
// 请把下面两项替换为你自己的 Supabase 项目信息。
// 获取位置：Supabase Dashboard → Project Settings → API
//   - Project URL   → SUPABASE_URL
//   - anon / public → SUPABASE_ANON_KEY
// 注意：只能填 anon（public）key，绝不能填 service_role key。
// ============================================================
window.APP_CONFIG = {
  // TODO: 替换为你的 Supabase 项目地址，例如 "https://abcd1234.supabase.co"
  SUPABASE_URL: "https://dshmavfbjfoiagjtvfwq.supabase.co",

  // TODO: 替换为你的 anon / public key
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzaG1hdmZiamZvaWFnanR2ZndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDAwMDAsImV4cCI6MjEwNzQxNjAwMH0.nRvAsPVhkbZdlTYKxR4OuEvhxlE2foO3s7kZo659Lmk",

  // 每天的节次数（与 Supabase 里的课程节次范围对应）
  SECTION_COUNT: 13,

  // 每节课的名称与时间（用于侧边栏「节次参考」展示，可按需修改）
  SECTION_TIMES: [
    { label: "第1节",  time: "08:00-08:45" },
    { label: "第2节",  time: "08:50-09:35" },
    { label: "第3节",  time: "09:50-10:35" },
    { label: "第4节",  time: "10:40-11:25" },
    { label: "第5节",  time: "11:30-12:15" },
    { label: "第6节",  time: "13:00-13:45" },
    { label: "第7节",  time: "13:50-14:35" },
    { label: "第8节",  time: "14:45-15:35" },
    { label: "第9节",  time: "15:45-16:25" },
    { label: "第10节", time: "17:50-18:25" },
    { label: "第11节", time: "18:30-19:15" },
    { label: "第12节", time: "19:20-20:05" },
    { label: "第13节", time: "20:15-20:55" },
  ],

  // 主色
  PRIMARY_COLOR: "#3A7BF9",

  // 课程卡片配色（循环使用，用于区分不同课程）
  CARD_COLORS: [
    "#3A7BF9", "#7C5CFC", "#12B76A", "#F79009",
    "#EE46BC", "#0BA5EC", "#E04F5F", "#12A5B0",
  ],
};
