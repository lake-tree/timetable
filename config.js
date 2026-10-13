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
  SECTION_COUNT: 12,

  // 每节课的名称与时间（用于侧边栏「节次参考」展示，可按需修改）
  SECTION_TIMES: [
    { label: "第1节",  time: "08:00-08:45" },
    { label: "第2节",  time: "08:55-09:40" },
    { label: "第3节",  time: "10:00-10:45" },
    { label: "第4节",  time: "10:55-11:40" },
    { label: "第5节",  time: "14:00-14:45" },
    { label: "第6节",  time: "14:55-15:40" },
    { label: "第7节",  time: "16:00-16:45" },
    { label: "第8节",  time: "16:55-17:40" },
    { label: "第9节",  time: "19:00-19:45" },
    { label: "第10节", time: "19:55-20:40" },
    { label: "第11节", time: "20:50-21:35" },
    { label: "第12节", time: "21:45-22:30" },
  ],

  // 主色
  PRIMARY_COLOR: "#3A7BF9",

  // 课程卡片配色（循环使用，用于区分不同课程）
  CARD_COLORS: [
    "#3A7BF9", "#7C5CFC", "#12B76A", "#F79009",
    "#EE46BC", "#0BA5EC", "#E04F5F", "#12A5B0",
  ],
};
