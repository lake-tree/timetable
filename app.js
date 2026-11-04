/* ============================================================
   app.js — 课表应用核心逻辑
   功能：数据加载 / 渲染 / 编辑 / 冲突检测 / 实时同步 / 学期管理
   ============================================================ */

/* ---------- 全局状态 ---------- */
let sb = null;               // Supabase 客户端实例（避免与 SDK 全局变量 supabase 重名）
let semesters = [];          // 全部学期
let courses = [];            // 当前学期的课程
let todos = [];              // 当前学期的待办
let links = [];              // 网站收藏（全局，不分学期）
let editingLinkId = null;    // 正在编辑的网站 id
let currentSemesterId = null;
let editingCourseId = null;  // 正在编辑的课程 id（null 表示新增）
let detailCourseId = null;   // 详情弹窗当前课程 id
let currentUser = null;      // 当前登录用户（Supabase Auth）；null 表示访客
let authMode = 'signin';     // 登录弹窗当前模式：signin / signup
let colW = null;             // 课表列宽（px；null 表示自适应铺满）
let editingTodoId = null;    // 正在编辑的待办 id（null 表示新增）
let focusModes = [];         // 专注模式列表
let editingFocusModeId = null; // 正在编辑的专注模式 id（null 表示新增）
let focusState = null;       // 当前专注计时状态（null 表示未开始）
let focusTimer = null;       // 专注倒计时 interval id
let audioCtx = null;         // 提示音 AudioContext（在用户点击时预创建，规避自动播放限制）

/* ---------- 本地缓存（秒出兜底，云端仍为数据权威） ---------- */
const CACHE_KEYS = {
  semesters: 'tt_cache_semesters',
  courses: 'tt_cache_courses',   // 结构：{ [semesterId]: [course, ...] }
  todos: 'tt_cache_todos',       // 结构：{ [semesterId]: [todo, ...] }
  links: 'tt_cache_links',
  focus: 'tt_cache_focus_modes',
};
// 缓存按「登录用户」隔离：不同账号 / 访客各用一份，避免串数据
let cacheScope = 'anon';
function scopedKey(key) { return key + '__' + cacheScope; }
function cacheGet(key) {
  try { const raw = localStorage.getItem(scopedKey(key)); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function cacheSet(key, val) {
  try { localStorage.setItem(scopedKey(key), JSON.stringify(val)); } catch (e) {}
}

const WEEKDAY_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'];
function weekdayNames() { return WEEKDAY_KEYS.map(k => t(k)); }

/* ---------- 国际化（中英切换，仅界面文字） ---------- */
const I18N = {
  zh: {
    app_title: '课表', app_subtitle: 'Timetable · 实时同步', current_semester: '当前学期',
    add_course: '＋ 添加课程', unlock_short: '🔒 解锁', unlocked_short: '🔓 已解锁', manage_semesters: '学期管理',
    todo_title: '📝 待办', add_todo_btn: '＋ 添加', section_ref: '节次参考', corner: '节次',
    nav_timetable: '课表', nav_add: '添加', nav_todos: '待办', nav_semesters: '学期', nav_links: '网站跳转',
    links_title: '🔗 网站跳转', add_link_btn: '＋ 添加', back_timetable: '← 返回课表',
    link_add_title: '添加网站', link_edit_title: '编辑网站',
    label_link_name: '名称', label_link_url: '网址',
    ph_link_name: '如：GitHub', ph_link_url: '如：https://github.com',
    no_links: '暂无网站，点右上角「添加」',
    toast_link_added: '已添加网站', toast_link_updated: '已更新网站', toast_link_deleted: '已删除网站',
    toast_enter_link_name: '请输入名称', toast_enter_link_url: '请输入网址',
    w1: '周一', w2: '周二', w3: '周三', w4: '周四', w5: '周五', w6: '周六', w7: '周日',
    section: '第{n}节', section_range: '第{a}-{b}节',
    today_hint: '今天 {date} · {weekday}', today: '今天', today_badge: '今天 · {date}',
    courses_count: '{n} 节课', no_courses: '暂无课程', no_todos: '暂无待办',
    sync_connecting: '连接中…', sync_connected: '已连接 · 实时同步中', sync_error: '连接中断',
    sync_noconfig: '未配置 Supabase，请编辑 config.js',
    detail_edit: '编辑', detail_delete: '删除', detail_unlock_hint: '🔒 解锁后即可编辑 / 删除',
    f_teacher: '教师', f_location: '教室', f_time: '时间', f_weeks: '周次', f_note: '备注', all_semester: '全学期',
    edit_title_add: '添加课程', edit_title_edit: '编辑课程',
    label_name: '课程名', label_teacher: '教师', label_location: '教室', label_weekday: '星期',
    label_start: '开始节次', label_end: '结束节次', label_weeks: '周次', label_note: '备注',
    ignore_conflict: '忽略冲突，仍要保存', save: '保存', cancel: '取消',
    ph_name: '如：高等数学', ph_teacher: '如：张老师', ph_location: '如：教学楼A-101',
    ph_weeks: '如 1-16周 / 1-16周(单) / 1,3,5周；留空为全学期', ph_note: '备注信息（可选）',
    conflict_prefix: '⚠️ 时间冲突：',
    semester_title: '学期管理', existing_semesters: '已有学期（点击可切换）', new_semester: '新建学期',
    create_semester: '创建学期', current_tag: '当前', open_day: '开学：', no_semesters: '暂无学期，请先创建',
    delete_sem: '删除', ph_semester_name: '如：2025-2026学年第一学期',
    todo_add_title: '添加待办', todo_edit_title: '编辑待办', label_content: '内容', label_due: '截止日期（可选）', label_course: '关联课程（可选）',
    recurring_label: '🔁 循环任务（每天自动刷新为未完成）', recurring_badge: '🔁 循环',
    ph_content: '如：完成高数作业第3章',
    unlock_title: '🔒 解锁编辑', unlock_desc: '当前为访客只读模式，输入编辑口令后才能添加 / 修改 / 删除课程。',
    ph_password: '请输入编辑口令', unlock: '解锁',
    toast_enter_password: '请输入口令', toast_wrong_password: '口令错误', toast_unlocked: '已解锁编辑',
    toast_locked: '已锁定，回到只读模式', toast_updated_rt: '已实时更新',
    toast_enter_name: '请输入课程名', toast_end_before_start: '结束节次不能早于开始节次',
    toast_save_fail: '保存失败', toast_delete_fail: '删除失败', toast_create_fail: '创建失败',
    toast_add_fail: '添加失败', toast_update_fail: '更新失败',
    toast_added: '已添加', toast_updated: '已更新', toast_deleted: '已删除',
    toast_semester_created: '学期已创建', toast_semester_deleted: '已删除学期',
    toast_enter_semester_name: '请输入学期名称', toast_create_semester_first: '请先在「学期管理」中创建学期',
    toast_enter_todo: '请输入待办内容', toast_todo_added: '已添加待办',
    confirm_delete_course: '确定删除课程「{name}」吗？', confirm_delete_todo: '删除这条待办？', confirm_delete_link: '删除这个网站？',
    confirm_delete_semester: '确定删除学期「{name}」吗？该学期下的所有课程也会被删除。',
    write_error_pwd: '口令错误，已锁定编辑', op_fail: '操作失败',
    drag_col: '拖动调整列宽', drag_sidebar: '拖动调整侧边栏宽度',
    auth_login: '👤 登录', auth_logged_in: '👤 已登录', auth_signin: '登录', auth_signup: '注册',
    auth_signin_desc: '登录后可编辑自己的课表；访客仅可查看主账号课表。',
    auth_signup_desc: '注册后自动成为主账号，现有课表 / 待办 / 网站将归入你的账号。',
    auth_email: '邮箱', auth_password: '密码', auth_no_account: '没有账号？', auth_has_account: '已有账号？',
    auth_logout: '退出登录', auth_confirm_logout: '确定退出登录吗？',
    ph_email: 'you@example.com', ph_password_min: '至少 6 位',
    toast_logged_out: '已退出登录', toast_signup_ok: '注册成功，已自动登录',
    toast_signup_email: '注册成功，请查收邮件验证后再登录', toast_auth_ok: '已登录',
    auth_required: '请先登录', write_error_auth: '登录已失效，请重新登录',
    nav_focus: '专注', focus_modes: '专注模式', focus_add: '＋ 添加',
    focus_start: '开始专注', focus_pause: '暂停', focus_resume: '继续', focus_stop: '停止',
    focus_phase_focus: '专注中', focus_phase_break: '休息中', focus_idle_hint: '选择下方模式开始专注',
    focus_cycle: '第 {n} 轮', focus_cycles_inf: '无限循环', focus_cycles_n: '共 {n} 轮',
    focus_mode_add_title: '添加专注模式', focus_mode_edit_title: '编辑专注模式',
    focus_alert_done: '专注完成！', focus_alert_break: '休息一下', focus_alert_break_desc: '休息 {n} 分钟吧',
    focus_alert_resume: '休息结束！', focus_alert_resume_desc: '继续第 {n} 轮专注',
    focus_alert_finish: '全部完成！', focus_alert_finish_desc: '本次专注全部结束，休息一下吧',
    toast_focus_mode_added: '已添加专注模式', toast_focus_mode_updated: '已更新专注模式', toast_focus_mode_deleted: '已删除专注模式',
    toast_enter_focus_name: '请输入名称', confirm_delete_focus_mode: '删除这个专注模式？',
    eink_label: '墨水屏模式', eink_short: '墨水', eink_toast_on: '已开启墨水屏模式', eink_toast_off: '已关闭墨水屏模式',
  },
  en: {
    app_title: 'Timetable', app_subtitle: 'Timetable · Realtime sync', current_semester: 'Semester',
    add_course: '＋ Add course', unlock_short: '🔒 Unlock', unlocked_short: '🔓 Unlocked', manage_semesters: 'Semesters',
    todo_title: '📝 Todos', add_todo_btn: '＋ Add', section_ref: 'Periods', corner: 'Period',
    nav_timetable: 'Timetable', nav_add: 'Add', nav_todos: 'Todos', nav_semesters: 'Semesters', nav_links: 'Links',
    links_title: '🔗 Links', add_link_btn: '＋ Add', back_timetable: '← Back to timetable',
    link_add_title: 'Add site', link_edit_title: 'Edit site',
    label_link_name: 'Name', label_link_url: 'URL',
    ph_link_name: 'e.g. GitHub', ph_link_url: 'e.g. https://github.com',
    no_links: 'No links yet, tap Add',
    toast_link_added: 'Site added', toast_link_updated: 'Site updated', toast_link_deleted: 'Site deleted',
    toast_enter_link_name: 'Enter name', toast_enter_link_url: 'Enter URL',
    w1: 'Mon', w2: 'Tue', w3: 'Wed', w4: 'Thu', w5: 'Fri', w6: 'Sat', w7: 'Sun',
    section: 'P{n}', section_range: 'P{a}-{b}',
    today_hint: 'Today {date} · {weekday}', today: 'Today', today_badge: 'Today · {date}',
    courses_count: '{n} courses', no_courses: 'No courses', no_todos: 'No todos',
    sync_connecting: 'Connecting…', sync_connected: 'Connected · Realtime sync', sync_error: 'Disconnected',
    sync_noconfig: 'Not configured, edit config.js',
    detail_edit: 'Edit', detail_delete: 'Delete', detail_unlock_hint: '🔒 Unlock to edit / delete',
    f_teacher: 'Teacher', f_location: 'Location', f_time: 'Time', f_weeks: 'Weeks', f_note: 'Note', all_semester: 'Whole semester',
    edit_title_add: 'Add course', edit_title_edit: 'Edit course',
    label_name: 'Course name', label_teacher: 'Teacher', label_location: 'Location', label_weekday: 'Day',
    label_start: 'Start period', label_end: 'End period', label_weeks: 'Weeks', label_note: 'Note',
    ignore_conflict: 'Ignore conflict and save', save: 'Save', cancel: 'Cancel',
    ph_name: 'e.g. Calculus', ph_teacher: 'e.g. Mr. Zhang', ph_location: 'e.g. Building A-101',
    ph_weeks: 'e.g. 1-16 / 1-16(odd) / 1,3,5; blank = all weeks', ph_note: 'Optional note',
    conflict_prefix: '⚠️ Time conflict: ',
    semester_title: 'Semesters', existing_semesters: 'Semesters (click to switch)', new_semester: 'New semester',
    create_semester: 'Create semester', current_tag: 'Current', open_day: 'Start: ', no_semesters: 'No semesters yet',
    delete_sem: 'Delete', ph_semester_name: 'e.g. 2025-2026 Fall',
    todo_add_title: 'Add todo', todo_edit_title: 'Edit todo', label_content: 'Content', label_due: 'Due date (optional)', label_course: 'Related course (optional)',
    recurring_label: '🔁 Recurring (auto-resets daily)', recurring_badge: '🔁 Recurring',
    ph_content: 'e.g. Finish chapter 3 homework',
    unlock_title: '🔒 Unlock edit', unlock_desc: 'Read-only visitor mode. Enter the edit password to add / modify / delete.',
    ph_password: 'Enter edit password', unlock: 'Unlock',
    toast_enter_password: 'Enter password', toast_wrong_password: 'Wrong password', toast_unlocked: 'Editing unlocked',
    toast_locked: 'Locked, back to read-only', toast_updated_rt: 'Updated in real time',
    toast_enter_name: 'Enter course name', toast_end_before_start: 'End period cannot be before start period',
    toast_save_fail: 'Save failed', toast_delete_fail: 'Delete failed', toast_create_fail: 'Create failed',
    toast_add_fail: 'Add failed', toast_update_fail: 'Update failed',
    toast_added: 'Added', toast_updated: 'Updated', toast_deleted: 'Deleted',
    toast_semester_created: 'Semester created', toast_semester_deleted: 'Semester deleted',
    toast_enter_semester_name: 'Enter semester name', toast_create_semester_first: 'Create a semester first',
    toast_enter_todo: 'Enter todo content', toast_todo_added: 'Todo added',
    confirm_delete_course: 'Delete course "{name}"?', confirm_delete_todo: 'Delete this todo?', confirm_delete_link: 'Delete this site?',
    confirm_delete_semester: 'Delete semester "{name}"? All its courses will also be deleted.',
    write_error_pwd: 'Wrong password, editing locked', op_fail: 'Operation failed',
    drag_col: 'Drag to resize column width', drag_sidebar: 'Drag to resize sidebar',
    auth_login: '👤 Sign in', auth_logged_in: '👤 Signed in', auth_signin: 'Sign in', auth_signup: 'Sign up',
    auth_signin_desc: 'Sign in to edit your own timetable. Visitors can only view the owner\'s timetable.',
    auth_signup_desc: 'After signing up you become the owner; existing courses / todos / links are assigned to you.',
    auth_email: 'Email', auth_password: 'Password', auth_no_account: 'No account?', auth_has_account: 'Have an account?',
    auth_logout: 'Sign out', auth_confirm_logout: 'Sign out?',
    ph_email: 'you@example.com', ph_password_min: 'At least 6 characters',
    toast_logged_out: 'Signed out', toast_signup_ok: 'Signed up and signed in',
    toast_signup_email: 'Signed up, please verify your email then sign in', toast_auth_ok: 'Signed in',
    auth_required: 'Please sign in first', write_error_auth: 'Session expired, please sign in again',
    nav_focus: 'Focus', focus_modes: 'Focus modes', focus_add: '＋ Add',
    focus_start: 'Start', focus_pause: 'Pause', focus_resume: 'Resume', focus_stop: 'Stop',
    focus_phase_focus: 'Focusing', focus_phase_break: 'Break', focus_idle_hint: 'Pick a mode below to start',
    focus_cycle: 'Round {n}', focus_cycles_inf: 'Endless loop', focus_cycles_n: '{n} rounds total',
    focus_mode_add_title: 'Add focus mode', focus_mode_edit_title: 'Edit focus mode',
    focus_alert_done: 'Focus done!', focus_alert_break: 'Take a break', focus_alert_break_desc: 'Break for {n} min',
    focus_alert_resume: 'Break over!', focus_alert_resume_desc: 'Start round {n}',
    focus_alert_finish: 'All done!', focus_alert_finish_desc: 'All focus rounds finished, take a rest',
    toast_focus_mode_added: 'Focus mode added', toast_focus_mode_updated: 'Focus mode updated', toast_focus_mode_deleted: 'Focus mode deleted',
    toast_enter_focus_name: 'Enter a name', confirm_delete_focus_mode: 'Delete this focus mode?',
    eink_label: 'E-Ink mode', eink_short: 'E-Ink', eink_toast_on: 'E-Ink mode on', eink_toast_off: 'E-Ink mode off',
  },
};

let currentLang = localStorage.getItem('timetable_lang') || 'zh';

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key]) || I18N.zh[key] || key;
  if (vars) {
    Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
  }
  return s;
}

function formatDateStr(now) {
  if (currentLang === 'en') {
    return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return (now.getMonth() + 1) + '月' + now.getDate() + '日';
}

function applyLanguage() {
  document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
  document.title = t('app_title') + ' · Timetable';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.textContent = currentLang === 'en' ? '中文' : 'EN';
  });
  // 重新渲染动态内容
  renderDayHeader();
  renderSectionTimes();
  renderSemesterSelectors();
  renderDesktopGrid();
  renderMobileList();
  renderTodos();
  renderSemesterList();
  renderLinks();
  renderFocusModes();
  renderAuthUI();
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('timetable_lang', currentLang);
  applyLanguage();
}

/* ---------- 墨水屏（黑白高对比）模式 ---------- */
const EINK_STORAGE_KEY = 'timetable_eink';   // 取值：'on' / 'off'（未设置 = 自动检测）

// 自动检测墨水屏环境：识别墨水屏设备 UA，或系统「高对比度」偏好
function detectEink() {
  try {
    const ua = navigator.userAgent || '';
    if (/boox|onyx|hisense|ireader|kindle|kobo|pocketbook|tolino|nook|meebook|yotaphone|inkpad|e-?ink/i.test(ua)) {
      return true;
    }
    if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) return true;
  } catch (e) {}
  return false;
}

function applyEink(on) {
  document.documentElement.classList.toggle('eink', on);
  document.querySelectorAll('.eink-toggle').forEach(b => b.classList.toggle('on', on));
}

function toggleEink() {
  const next = !document.documentElement.classList.contains('eink');
  localStorage.setItem(EINK_STORAGE_KEY, next ? 'on' : 'off');
  applyEink(next);
  showToast(t(next ? 'eink_toast_on' : 'eink_toast_off'));
}

// 初始化墨水屏模式：手动设置优先，否则自动检测
function initEink() {
  const saved = localStorage.getItem(EINK_STORAGE_KEY);
  if (saved === 'on') { applyEink(true); return; }
  if (saved === 'off') { applyEink(false); return; }
  applyEink(detectEink());
}

/* ---------- 工具函数 ---------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function dayName(n) {
  return weekdayNames()[(Number(n) || 1) - 1] || '';
}

// 获取今天日期与星期（weekday: 1=周一 ... 7=周日）
function todayInfo() {
  const now = new Date();
  const jsDay = now.getDay();          // 0=周日, 1=周一 ... 6=周六
  const weekday = jsDay === 0 ? 7 : jsDay;
  return { weekday, dateStr: formatDateStr(now) };
}

function sectionText(c) {
  return c.start_section === c.end_section
    ? t('section', { n: c.start_section })
    : t('section_range', { a: c.start_section, b: c.end_section });
}

// 计算课程的时间范围（开始节次的开始时间 ~ 结束节次的结束时间），如 "08:00-09:35"
function sectionTimeRange(start, end) {
  const times = (window.APP_CONFIG && window.APP_CONFIG.SECTION_TIMES) || [];
  const a = times[start - 1];
  const b = times[end - 1];
  if (!a || !a.time) return '';
  const s = a.time.split('-')[0];
  const e = b && b.time ? b.time.split('-')[1] : '';
  return e ? `${s}-${e}` : a.time;
}

// 解析某节课的结束时间（分钟数 0-1439）
function sectionEndMinutes(section) {
  const times = (window.APP_CONFIG && window.APP_CONFIG.SECTION_TIMES) || [];
  const t = times[section - 1];
  if (!t || !t.time) return null;
  const parts = t.time.split('-');
  const end = (parts[1] || parts[0]).trim();
  const [h, m] = end.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// 判断课程今天是否已经上完（当前时间已过其结束节次的结束时间）
function isPassedToday(course) {
  const today = todayInfo();
  if (course.weekday !== today.weekday) return false;  // 非今天的课不淡化
  const end = sectionEndMinutes(course.end_section);
  if (end == null) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= end;
}

// 根据课程名生成稳定的卡片颜色
function colorFor(course) {
  const colors = (window.APP_CONFIG && window.APP_CONFIG.CARD_COLORS) || ['#3A7BF9'];
  let h = 0;
  const s = course.name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

// 解析周次字符串为「周次集合」；返回 null 表示未填写（不校验周次）
// 支持："1-16周"、"1-16周(单)"、"1-16周(双)"、"1,3,5周"、"1-8,10-16周"
function parseWeeks(str) {
  if (!str) return null;
  let cleaned = String(str).replace(/周/g, '').trim();
  const isSingle = /单/.test(cleaned);   // 单周
  const isDouble = /双/.test(cleaned);   // 双周
  cleaned = cleaned.replace(/\(.*?\)|（.*?）|单|双/g, '');
  const parts = cleaned.split(/[,，、\s]+/).filter(Boolean);
  const set = new Set();
  for (const p of parts) {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) {
        for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
          if (isSingle && w % 2 === 0) continue;
          if (isDouble && w % 2 === 1) continue;
          set.add(w);
        }
      }
    } else {
      const n = Number(p);
      if (!isNaN(n)) set.add(n);
    }
  }
  return set.size ? set : null;
}

/* ---------- Toast 提示 ---------- */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

/* ---------- 同步状态指示 ---------- */
function setSyncStatus(state, text) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (state === 'connected') {
    dot.className = 'w-2 h-2 rounded-full connected';
    txt.textContent = text || t('sync_connected');
  } else if (state === 'error') {
    dot.className = 'w-2 h-2 rounded-full error';
    txt.textContent = text || t('sync_error');
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-gray-300';
    txt.textContent = text || t('sync_connecting');
  }
}

/* ---------- 弹窗 ---------- */
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

/* ---------- 账号登录（Supabase Auth：邮箱 + 密码） ---------- */
function isLoggedIn() { return !!currentUser; }

function shortEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : email;
  return name.length > 14 ? name.slice(0, 14) + '…' : name;
}

function setUser(user) {
  currentUser = user || null;
  cacheScope = user ? user.id : 'anon';
  renderAuthUI();
}

function openAuth(mode) {
  if (mode === 'signin' || mode === 'signup') authMode = mode;
  showAuthError('');
  renderAuthForm();
  openModal('modal-auth');
  setTimeout(() => document.getElementById('auth-email').focus(), 50);
}

function renderAuthForm() {
  const signup = authMode === 'signup';
  document.getElementById('auth-title').textContent = signup ? t('auth_signup') : t('auth_signin');
  document.getElementById('auth-sub').textContent = signup ? t('auth_signup_desc') : t('auth_signin_desc');
  document.getElementById('btn-auth-submit').textContent = signup ? t('auth_signup') : t('auth_signin');
  document.getElementById('auth-switch-text').textContent = signup ? t('auth_has_account') : t('auth_no_account');
  document.getElementById('btn-auth-switch').textContent = signup ? t('auth_signin') : t('auth_signup');
  document.getElementById('auth-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');

  const li = document.getElementById('auth-loggedin');
  const form = document.getElementById('auth-form');
  if (currentUser) {
    li.classList.remove('hidden');
    li.classList.add('flex');
    document.getElementById('auth-current').textContent = t('auth_logged_in') + '：' + (currentUser.email || '');
    form.classList.add('hidden');
  } else {
    li.classList.add('hidden');
    li.classList.remove('flex');
    form.classList.remove('hidden');
  }
}

function showAuthError(msg) {
  const box = document.getElementById('auth-error');
  if (msg) { box.textContent = msg; box.classList.remove('hidden'); }
  else box.classList.add('hidden');
}

function translateAuthError(err) {
  const m = (err && err.message) || '';
  if (/invalid.*credential|invalid login/i.test(m)) return t('toast_wrong_password');
  if (/already registered|already been registered/i.test(m)) return t('toast_wrong_password');
  if (/not confirmed/i.test(m)) return t('toast_signup_email');
  if (/at least 6/i.test(m)) return t('ph_password_min');
  return m || t('op_fail');
}

async function signIn() {
  const email = document.getElementById('auth-email').value.trim();
  const pwd = document.getElementById('auth-password').value;
  if (!email || !pwd) { showAuthError(t('auth_required')); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
  if (error) { showAuthError(translateAuthError(error)); return; }
  showAuthError('');
  closeModal('modal-auth');
  showToast(t('toast_auth_ok'));
  // 后续 setUser + 数据刷新由 onAuthStateChange(SIGNED_IN) 统一处理
}

async function signUp() {
  const email = document.getElementById('auth-email').value.trim();
  const pwd = document.getElementById('auth-password').value;
  if (!email || !pwd) { showAuthError(t('auth_required')); return; }
  if (pwd.length < 6) { showAuthError(t('ph_password_min')); return; }
  const { data, error } = await sb.auth.signUp({ email, password: pwd });
  if (error) { showAuthError(translateAuthError(error)); return; }
  if (data.session) {
    showAuthError('');
    closeModal('modal-auth');
    showToast(t('toast_signup_ok'));
  } else {
    showAuthError(t('toast_signup_email'));
  }
}

async function signOut(silent) {
  try { await sb.auth.signOut(); } catch (e) {}
  const wasLoggedIn = !!currentUser;
  setUser(null);
  renderTodos();
  renderLinks();
  if (wasLoggedIn && !silent) showToast(t('toast_logged_out'));
}

// 登录 / 注册成功后：认领历史无主数据 + 重新拉取自己的数据
async function onSignedIn() {
  try { await sb.rpc('claim_owner'); } catch (e) { /* 表未建或已认领：静默 */ }
  await loadSemesters();
  currentSemesterId = semesters[0] ? semesters[0].id : null;
  renderSemesterSelectors();
  if (currentSemesterId) { await loadCourses(); await loadTodos(); }
  await loadLinks();
  await loadFocusModes();
  renderAll();
  renderTodos();
  renderLinks();
  renderFocusModes();
}

// 根据登录状态切换增删改入口的显隐
function renderAuthUI() {
  const loggedIn = isLoggedIn();
  document.getElementById('btn-add').classList.toggle('hidden', !loggedIn);
  document.getElementById('detail-actions').classList.toggle('hidden', !loggedIn);
  document.getElementById('btn-add-todo').classList.toggle('hidden', !loggedIn);
  document.getElementById('btn-add-link').classList.toggle('hidden', !loggedIn);
  document.getElementById('btn-add-focus-mode').classList.toggle('hidden', !loggedIn);
  document.getElementById('mobile-add-todo').classList.toggle('hidden', !loggedIn);
  document.querySelectorAll('.sem-delete').forEach(b => b.classList.toggle('hidden', !loggedIn));
  // 全局账号状态按钮（桌面侧边栏顶部 + 移动端顶部栏）
  const label = loggedIn ? '👤 ' + shortEmail(currentUser.email) : t('auth_login');
  ['btn-auth-toggle', 'btn-auth-toggle-mobile'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = label;
    btn.classList.toggle('unlocked', loggedIn);
  });
}

// 写操作报错统一处理：登录失效则提示重新登录
function handleWriteError(err, fallback) {
  if (err && (err.code === '42501' || /口令|Authentication|Forbidden|not authenticated/i.test(err.message || ''))) {
    if (isLoggedIn()) {
      showToast(t('write_error_auth'));
      signOut(true);
    } else {
      showToast(t('auth_required'));
      openAuth('signin');
    }
  } else {
    showToast((fallback || t('op_fail')) + '：' + (err && err.message ? err.message : err));
  }
}

/* ---------- Supabase ---------- */
function initSupabase() {
  const cfg = window.APP_CONFIG || {};
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

async function loadSemesters() {
  const { data, error } = await sb.from('semesters').select('*');
  if (error) { console.error('loadSemesters error:', error); setSyncStatus('error'); return; }
  semesters = data || [];
  cacheSet(CACHE_KEYS.semesters, semesters);
}

async function loadCourses() {
  if (!currentSemesterId) { courses = []; return; }
  const { data, error } = await sb
    .from('courses')
    .select('*')
    .eq('semester_id', currentSemesterId);
  if (error) { console.error('loadCourses error:', error); setSyncStatus('error'); return; }
  courses = (data || []).sort((a, b) => a.weekday - b.weekday || a.start_section - b.start_section);
  const _all = cacheGet(CACHE_KEYS.courses) || {};
  _all[currentSemesterId] = courses;
  cacheSet(CACHE_KEYS.courses, _all);
}

async function loadTodos() {
  if (!currentSemesterId) { todos = []; return; }
  try {
    const { data, error } = await sb
      .from('todos')
      .select('*')
      .eq('semester_id', currentSemesterId);
    if (error) throw error;
    todos = data || [];
    const _all = cacheGet(CACHE_KEYS.todos) || {};
    _all[currentSemesterId] = todos;
    cacheSet(CACHE_KEYS.todos, _all);
  } catch (e) {
    // todos 表尚未创建等情况：静默降级为空列表，不影响课表
    console.warn('loadTodos:', e && e.message ? e.message : e);
    todos = [];
  }
}

function courseName(id) {
  const c = courses.find(x => x.id === id);
  return c ? c.name : '';
}

/* ---------- 网站收藏 ---------- */
async function loadLinks() {
  try {
    const { data, error } = await sb.from('links').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    links = data || [];
    cacheSet(CACHE_KEYS.links, links);
  } catch (e) {
    console.warn('loadLinks:', e && e.message ? e.message : e);
    links = [];
  }
}

/* ---------- 专注（番茄钟） ---------- */
async function loadFocusModes() {
  try {
    const { data, error } = await sb.from('focus_modes').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    focusModes = data || [];
    cacheSet(CACHE_KEYS.focus, focusModes);
  } catch (e) {
    console.warn('loadFocusModes:', e && e.message ? e.message : e);
    focusModes = [];
  }
}

function renderFocusModes() {
  const box = document.getElementById('focus-mode-list');
  if (!box) return;
  const loggedIn = isLoggedIn();
  if (focusModes.length === 0) {
    box.innerHTML = `<div class="text-xs text-gray-300 text-center py-6">${loggedIn ? '点右上角「＋ 添加」创建第一个专注模式' : '暂无专注模式'}</div>`;
    return;
  }
  box.innerHTML = focusModes.map(m => {
    const cyc = m.cycles ? t('focus_cycles_n', { n: m.cycles }) : t('focus_cycles_inf');
    const active = focusState && focusState.modeId === m.id;
    const actions = loggedIn
      ? `<div class="focus-mode-actions"><button data-act="edit">✏️</button><button data-act="delete">🗑</button></div>`
      : '';
    return `
      <div class="focus-mode-item ${active ? 'active' : ''}" data-id="${m.id}">
        <div class="focus-mode-main">
          <div class="focus-mode-name">${escapeHtml(m.name)}</div>
          <div class="focus-mode-meta">🍅 ${m.focus_minutes} 分钟 · ☕ ${m.break_minutes} 分钟 · 🔁 ${escapeHtml(cyc)}</div>
        </div>
        ${actions}
      </div>`;
  }).join('');
}

function openFocusModeModal(mode) {
  editingFocusModeId = mode ? mode.id : null;
  document.getElementById('focus-mode-title').textContent = mode ? t('focus_mode_edit_title') : t('focus_mode_add_title');
  document.getElementById('fm-name').value = mode ? mode.name : '';
  document.getElementById('fm-focus').value = mode ? mode.focus_minutes : 25;
  document.getElementById('fm-break').value = mode ? mode.break_minutes : 5;
  document.getElementById('fm-cycles').value = mode && mode.cycles != null ? mode.cycles : '';
  openModal('modal-focus-mode');
  setTimeout(() => document.getElementById('fm-name').focus(), 50);
}

async function saveFocusMode() {
  if (!isLoggedIn()) { openAuth('signin'); return; }
  const name = document.getElementById('fm-name').value.trim();
  if (!name) { showToast(t('toast_enter_focus_name')); return; }
  const focus = parseInt(document.getElementById('fm-focus').value, 10) || 25;
  const brk = parseInt(document.getElementById('fm-break').value, 10) || 0;
  const cycRaw = document.getElementById('fm-cycles').value.trim();
  const cycles = cycRaw === '' ? null : (parseInt(cycRaw, 10) || null);
  const isEdit = !!editingFocusModeId;
  let error;
  if (isEdit) {
    ({ error } = await sb.rpc('update_focus_mode', { p_id: editingFocusModeId, p_name: name, p_focus_minutes: focus, p_break_minutes: brk, p_cycles: cycles }));
  } else {
    ({ error } = await sb.rpc('add_focus_mode', { p_name: name, p_focus_minutes: focus, p_break_minutes: brk, p_cycles: cycles }));
  }
  if (error) { handleWriteError(error, t('toast_save_fail')); return; }
  closeModal('modal-focus-mode');
  editingFocusModeId = null;
  await loadFocusModes();
  renderFocusModes();
  showToast(isEdit ? t('toast_focus_mode_updated') : t('toast_focus_mode_added'));
}

async function deleteFocusMode(id) {
  if (!isLoggedIn()) { openAuth('signin'); return; }
  if (!confirm(t('confirm_delete_focus_mode'))) return;
  const { error } = await sb.rpc('delete_focus_mode', { p_id: id });
  if (error) { handleWriteError(error, t('toast_delete_fail')); return; }
  if (focusState && focusState.modeId === id) stopFocus(true);
  await loadFocusModes();
  renderFocusModes();
  showToast(t('toast_focus_mode_deleted'));
}

/* 专注计时器 */
function fmtFocusTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderFocusTimer() {
  const timeEl = document.getElementById('focus-time');
  const phaseEl = document.getElementById('focus-phase');
  const nameEl = document.getElementById('focus-mode-name');
  const cycEl = document.getElementById('focus-cycle');
  const progEl = document.getElementById('focus-progress');
  const pause = document.getElementById('btn-focus-pause');
  const stop = document.getElementById('btn-focus-stop');
  if (!timeEl) return;

  if (!focusState) {
    phaseEl.textContent = '🍅';
    timeEl.textContent = '00:00';
    nameEl.textContent = t('focus_idle_hint');
    cycEl.textContent = '';
    progEl.style.width = '0%';
    pause.classList.add('hidden');
    stop.classList.add('hidden');
    return;
  }

  const isBreak = focusState.phase === 'break';
  phaseEl.textContent = isBreak ? t('focus_phase_break') : t('focus_phase_focus');
  const mode = focusModes.find(m => m.id === focusState.modeId);
  nameEl.textContent = mode ? mode.name : '';
  cycEl.textContent = focusState.totalCycles
    ? (t('focus_cycle', { n: focusState.cycle }) + ' / ' + t('focus_cycles_n', { n: focusState.totalCycles }))
    : (t('focus_cycle', { n: focusState.cycle }) + ' · ' + t('focus_cycles_inf'));

  const remaining = focusState.paused ? focusState.remainingMs : (focusState.endTime - Date.now());
  timeEl.textContent = fmtFocusTime(remaining);
  const pct = focusState.phaseMs > 0 ? Math.max(0, Math.min(100, 100 * remaining / focusState.phaseMs)) : 0;
  progEl.style.width = pct + '%';

  pause.classList.remove('hidden');
  stop.classList.remove('hidden');
  pause.textContent = focusState.paused ? t('focus_resume') : t('focus_pause');
}

function startFocus(mode) {
  const focusMs = (mode.focus_minutes || 25) * 60 * 1000;
  if (focusState) stopFocus(true);
  focusState = {
    modeId: mode.id,
    phase: 'focus',
    cycle: 1,
    totalCycles: mode.cycles || null,
    phaseMs: focusMs,
    endTime: Date.now() + focusMs,
    paused: false,
    remainingMs: focusMs,
  };
  clearInterval(focusTimer);
  focusTimer = setInterval(tickFocus, 500);
  ensureNotifyPermission();
  ensureAudio();
  renderFocusTimer();
  renderFocusModes();
  showToast('🍅 ' + mode.name);
}

function tickFocus() {
  if (!focusState || focusState.paused) return;
  if (Date.now() >= focusState.endTime) onPhaseEnd();
  else renderFocusTimer();
}

// 返回 true 表示还有下一轮（cycle 已递增），false 表示全部结束
function nextRound(st) {
  if (!st.totalCycles) { st.cycle++; return true; } // 无限循环
  if (st.cycle >= st.totalCycles) return false;     // 已是最后一轮
  st.cycle++;
  return true;
}

function onPhaseEnd() {
  const st = focusState;
  const mode = focusModes.find(m => m.id === st.modeId);
  const focusMin = mode ? (mode.focus_minutes || 25) : 25;
  const breakMin = mode ? (mode.break_minutes || 0) : 0;

  if (st.phase === 'focus') {
    playBeep();
    if (breakMin > 0) {
      const breakMs = breakMin * 60 * 1000;
      st.phase = 'break';
      st.phaseMs = breakMs;
      st.endTime = Date.now() + breakMs;
      st.remainingMs = breakMs;
      showFocusAlert(t('focus_alert_done'), t('focus_alert_break_desc', { n: breakMin }), '🎉');
      notifyPhase(t('focus_alert_done'), t('focus_alert_break_desc', { n: breakMin }));
    } else if (nextRound(st)) {
      st.phase = 'focus';
      st.phaseMs = focusMin * 60 * 1000;
      st.endTime = Date.now() + st.phaseMs;
      st.remainingMs = st.phaseMs;
      showFocusAlert(t('focus_alert_done'), t('focus_alert_resume_desc', { n: st.cycle }), '🎉');
      notifyPhase(t('focus_alert_done'), t('focus_alert_resume_desc', { n: st.cycle }));
    } else {
      finishFocus();
      showFocusAlert(t('focus_alert_finish'), t('focus_alert_finish_desc'), '🏁');
      notifyPhase(t('focus_alert_finish'), t('focus_alert_finish_desc'));
      return;
    }
  } else {
    playBeep();
    if (nextRound(st)) {
      st.phase = 'focus';
      st.phaseMs = focusMin * 60 * 1000;
      st.endTime = Date.now() + st.phaseMs;
      st.remainingMs = st.phaseMs;
      showFocusAlert(t('focus_alert_resume'), t('focus_alert_resume_desc', { n: st.cycle }), '💪');
      notifyPhase(t('focus_alert_resume'), t('focus_alert_resume_desc', { n: st.cycle }));
    } else {
      finishFocus();
      showFocusAlert(t('focus_alert_finish'), t('focus_alert_finish_desc'), '🏁');
      notifyPhase(t('focus_alert_finish'), t('focus_alert_finish_desc'));
      return;
    }
  }
  renderFocusTimer();
  renderFocusModes();
}

function finishFocus() {
  clearInterval(focusTimer);
  focusTimer = null;
  focusState = null;
  renderFocusTimer();
  renderFocusModes();
}

function stopFocus(silent) {
  clearInterval(focusTimer);
  focusTimer = null;
  focusState = null;
  renderFocusTimer();
  renderFocusModes();
  if (!silent) showToast(t('focus_stopped'));
}

function togglePauseFocus() {
  if (!focusState) return;
  if (focusState.paused) {
    focusState.paused = false;
    focusState.endTime = Date.now() + focusState.remainingMs;
  } else {
    focusState.remainingMs = focusState.endTime - Date.now();
    focusState.paused = true;
  }
  renderFocusTimer();
}

function showFocusAlert(title, desc, emoji) {
  document.getElementById('focus-alert-emoji').textContent = emoji || '🎉';
  document.getElementById('focus-alert-title').textContent = title;
  document.getElementById('focus-alert-desc').textContent = desc || '';
  openModal('modal-focus-alert');
}

function ensureAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

function playBeep() {
  ensureAudio();
  if (!audioCtx) return;
  try {
    [0, 0.6, 1.2].forEach(delay => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t = audioCtx.currentTime + delay;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch (e) {}
}

function ensureNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission().catch(() => {}); } catch (e) {}
  }
}

function notifyPhase(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return; // 前台用弹框即可
  try { new Notification('🍅 ' + title, { body: body || '' }); } catch (e) {}
}

function normalizeUrl(u) {
  let s = (u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

function linkInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function renderLinks() {
  const grid = document.getElementById('links-grid');
  if (!grid) return;
  const unlocked = isLoggedIn();
  const sorted = [...links].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (sorted.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center text-xs text-gray-300 py-8">${t('no_links')}</div>`;
    return;
  }
  grid.innerHTML = sorted.map(l => {
    const color = colorFor({ name: l.name });
    const actions = unlocked
      ? `<div class="link-actions"><button data-act="edit">✏️</button><button data-act="delete">🗑</button></div>`
      : '';
    return `
      <div class="link-card" data-id="${l.id}" data-url="${escapeHtml(l.url)}" style="border-top-color:${color}">
        <span class="link-initial" style="background:${color}">${escapeHtml(linkInitial(l.name))}</span>
        <div class="link-name">${escapeHtml(l.name)}</div>
        <div class="link-url">${escapeHtml(l.url)}</div>
        ${actions}
      </div>`;
  }).join('');
}

function openLinkModal(link) {
  editingLinkId = link ? link.id : null;
  document.getElementById('link-modal-title').textContent = link ? t('link_edit_title') : t('link_add_title');
  document.getElementById('link-f-name').value = link ? link.name : '';
  document.getElementById('link-f-url').value = link ? link.url : '';
  openModal('modal-link');
  setTimeout(() => document.getElementById('link-f-name').focus(), 50);
}

// 页面切换（课表 / 待办 / 网站跳转）
function showPage(page) {
  const dv = document.getElementById('desktop-view');
  const mv = document.getElementById('mobile-view');
  const tv = document.getElementById('mobile-todos-view');
  const lv = document.getElementById('links-view');
  const fv = document.getElementById('focus-view');
  if (dv) dv.style.display = (page === 'timetable') ? '' : 'none';
  if (mv) mv.style.display = (page === 'timetable') ? '' : 'none';
  if (tv) tv.style.display = (page === 'todos') ? 'block' : 'none';
  if (lv) lv.style.display = (page === 'links') ? 'block' : 'none';
  if (fv) fv.style.display = (page === 'focus') ? 'block' : 'none';
  if (page === 'todos') renderTodos();
  if (page === 'links') renderLinks();
  if (page === 'focus') { renderFocusModes(); renderFocusTimer(); }
}

// 待办是否“当前有效完成”：循环任务仅在完成当天算完成，跨天自动刷新为未完成
function effectiveDone(t) {
  if (!t.recurring) return !!t.done;
  if (!t.done) return false;
  const at = t.done_at ? new Date(t.done_at) : null;
  if (!at) return true; // 旧数据无完成时间，按已完成处理
  const now = new Date();
  return at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate();
}

function renderTodos() {
  const sorted = [...todos].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return new Date(b.pinned_at || 0) - new Date(a.pinned_at || 0);
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  const unlocked = isLoggedIn();

  const itemHtml = (todo) => {
    const eff = effectiveDone(todo);
    const due = todo.due_date ? `📅 ${escapeHtml(todo.due_date)}` : '';
    const cname = todo.course_id ? `📚 ${escapeHtml(courseName(todo.course_id))}` : '';
    const rec = todo.recurring ? t('recurring_badge') : '';
    const meta = [due, cname, rec].filter(Boolean).join(' · ');
    const checkBtn = unlocked
      ? `<button class="todo-check" data-act="toggle-done">${eff ? '✓' : '○'}</button>`
      : `<span class="todo-check" style="cursor:default">${eff ? '✓' : '○'}</span>`;
    const actions = unlocked
      ? `<button class="todo-edit" data-act="edit">✏️</button>
         <button class="todo-pin" data-act="toggle-pin">${todo.pinned ? '📌' : '📍'}</button>
         <button class="todo-del" data-act="delete">🗑</button>`
      : (todo.pinned ? '<span class="todo-pin-static">📌</span>' : '');
    return `
      <div class="todo-item ${eff ? 'done' : ''} ${todo.pinned ? 'pinned' : ''}" data-id="${todo.id}">
        ${checkBtn}
        <div class="todo-main">
          <div class="todo-content">${escapeHtml(todo.content)}</div>
          ${meta ? `<div class="todo-meta">${meta}</div>` : ''}
        </div>
        ${actions}
      </div>`;
  };

  const empty = `<div class="text-xs text-gray-300 text-center py-2">${t('no_todos')}</div>`;
  document.getElementById('todo-list').innerHTML = sorted.length ? sorted.map(itemHtml).join('') : empty;
  document.getElementById('mobile-todo-list').innerHTML = sorted.length ? sorted.map(itemHtml).join('') : empty;
}

function renderTodoCourseOptions() {
  const sel = document.getElementById('todo-f-course');
  sel.innerHTML = `<option value="">${t('label_course')}</option>` +
    courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function openTodoModal(todo) {
  editingTodoId = todo ? todo.id : null;
  document.getElementById('todo-modal-title').textContent = todo ? t('todo_edit_title') : t('todo_add_title');
  document.getElementById('todo-f-content').value = todo ? todo.content : '';
  document.getElementById('todo-f-due').value = todo && todo.due_date ? todo.due_date : '';
  renderTodoCourseOptions();
  document.getElementById('todo-f-course').value = todo && todo.course_id ? todo.course_id : '';
  document.getElementById('todo-f-recurring').checked = !!(todo && todo.recurring);
  openModal('modal-todo');
  setTimeout(() => document.getElementById('todo-f-content').focus(), 50);
}

/* ---------- 渲染 ---------- */
function renderSectionTimes() {
  const box = document.getElementById('section-times');
  const times = (window.APP_CONFIG && window.APP_CONFIG.SECTION_TIMES) || [];
  box.innerHTML = times.map((it, i) =>
    `<div class="flex justify-between"><span>${escapeHtml(t('section', { n: i + 1 }))}</span><span>${escapeHtml(it.time)}</span></div>`
  ).join('');
}

// 课表列宽模板：colW 为 null 时自适应铺满，否则固定像素（可横向滚动）
function gridTemplate() {
  return `56px repeat(7, ${colW ? colW + 'px' : 'minmax(0, 1fr)'})`;
}

// 仅更新表头与网格的列模板（不重建 DOM，用于拖动过程中的实时反馈）
function setColTemplate() {
  const tpl = gridTemplate();
  const h = document.getElementById('day-header');
  const g = document.getElementById('desktop-grid');
  if (h) h.style.gridTemplateColumns = tpl;
  if (g) g.style.gridTemplateColumns = tpl;
}

function applyColWidth(w) {
  colW = w;
  setColTemplate();
  localStorage.setItem('timetable_col_w', String(w));
}

function applySidebarWidth(w) {
  document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  localStorage.setItem('timetable_sidebar_w', String(w));
}

function renderDayHeader() {
  const header = document.getElementById('day-header');
  header.innerHTML = '';
  header.style.gridTemplateColumns = gridTemplate();
  const today = todayInfo();
  const corner = document.createElement('div');
  corner.className = 'day-header-cell';
  corner.textContent = t('corner');
  header.appendChild(corner);
  const subs = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  weekdayNames().forEach((n, i) => {
    const c = document.createElement('div');
    const isWeekend = i >= 5;
    const isToday = (i + 1) === today.weekday;
    c.className = 'day-header-cell' + (isToday ? ' today' : '');
    c.innerHTML = `<span class="${isWeekend ? 'weekend' : ''}">${n}</span>` +
      (isToday
        ? `<span class="today-tag">${t('today')}</span>`
        : `<span class="sub">${subs[i]}</span>`);
    header.appendChild(c);
  });
  // 顶部显示今天日期与星期
  const hint = document.getElementById('desktop-week-hint');
  if (hint) hint.textContent = t('today_hint', { date: today.dateStr, weekday: weekdayNames()[today.weekday - 1] });
}

function renderDesktopGrid() {
  const grid = document.getElementById('desktop-grid');
  grid.innerHTML = '';
  const count = (window.APP_CONFIG && window.APP_CONFIG.SECTION_COUNT) || 12;
  const times = (window.APP_CONFIG && window.APP_CONFIG.SECTION_TIMES) || [];
  grid.style.gridTemplateColumns = gridTemplate();
  grid.style.gridAutoRows = '56px';

  // 今天所在的列：淡色高亮条（放在最底层）
  const today = todayInfo();
  const band = document.createElement('div');
  band.className = 'today-column';
  band.style.gridColumn = String(today.weekday + 1);
  band.style.gridRow = `1 / ${count + 1}`;
  grid.appendChild(band);

  // 时间列 + 背景网格线
  for (let s = 1; s <= count; s++) {
    const it = times[s - 1] || { time: '' };
    const timeCell = document.createElement('div');
    timeCell.className = 'time-cell';
    timeCell.style.gridColumn = '1';
    timeCell.style.gridRow = String(s);
    timeCell.innerHTML = `<span class="t">${escapeHtml(t('section', { n: s }))}</span><span class="tm">${escapeHtml(it.time)}</span>`;
    grid.appendChild(timeCell);

    for (let d = 1; d <= 7; d++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.style.gridColumn = String(d + 1);
      cell.style.gridRow = String(s);
      cell.dataset.section = String(s);
      grid.appendChild(cell);
    }
  }

  // 课程卡片
  courses.forEach(c => {
    const card = document.createElement('div');
    card.className = 'course-card' + (isPassedToday(c) ? ' passed' : '');
    card.style.gridColumn = String(c.weekday + 1);
    card.style.gridRow = `${c.start_section} / ${c.end_section + 1}`;
    card.style.background = colorFor(c);
    card.dataset.id = c.id;
    card.innerHTML =
      `<div class="cc-name">${escapeHtml(c.name)}</div>` +
      `<div class="cc-time">${sectionTimeRange(c.start_section, c.end_section)}</div>` +
      (c.teacher ? `<div class="cc-meta">${escapeHtml(c.teacher)}</div>` : '') +
      (c.location ? `<div class="cc-meta">@${escapeHtml(c.location)}</div>` : '');
    grid.appendChild(card);
  });
}

function renderMobileList() {
  const list = document.getElementById('mobile-list');
  list.innerHTML = '';
  const today = todayInfo();
  // 今天的组置顶，其余按周一~周日顺序
  const order = [today.weekday, ...[1, 2, 3, 4, 5, 6, 7].filter(d => d !== today.weekday)];
  const wnames = weekdayNames();
  for (const d of order) {
    const dayCourses = courses.filter(c => c.weekday === d);
    const isWeekend = d >= 6;
    const isToday = d === today.weekday;
    const accent = isToday ? '#3A7BF9' : (isWeekend ? '#E04F5F' : '#3A7BF9');

    let itemsHtml = '';
    if (dayCourses.length === 0) {
      itemsHtml = `<div class="text-xs text-gray-300 text-center py-3">${t('no_courses')}</div>`;
    } else {
      itemsHtml = dayCourses.map(c => `
        <div class="mobile-course-card bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-2 cursor-pointer ${isPassedToday(c) ? 'passed' : ''}"
             style="--card-color:${colorFor(c)}" data-id="${c.id}">
          <div class="flex items-start justify-between">
            <div class="font-semibold text-sm text-gray-800">${escapeHtml(c.name)}</div>
            <span class="text-xs text-gray-400 flex-shrink-0 ml-2">${sectionText(c)}</span>
          </div>
          <div class="mt-1 text-xs text-gray-500 space-y-0.5">
            <div>🕐 ${sectionTimeRange(c.start_section, c.end_section)}</div>
            ${c.teacher ? `<div>👨‍🏫 ${escapeHtml(c.teacher)}</div>` : ''}
            ${c.location ? `<div>📍 ${escapeHtml(c.location)}</div>` : ''}
            ${c.weeks ? `<div>📆 ${escapeHtml(c.weeks)}</div>` : ''}
          </div>
        </div>
      `).join('');
    }

    const group = document.createElement('div');
    group.className = 'mb-4' + (isToday ? ' today-group' : '');
    group.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <span class="w-1.5 h-4 rounded-full" style="background:${accent}"></span>
        <span class="font-semibold text-sm ${isWeekend ? 'text-red-400' : ''}">${wnames[d - 1]}</span>
        ${isToday ? `<span class="today-badge">${t('today_badge', { date: today.dateStr })}</span>` : ''}
        <span class="text-xs text-gray-400">${t('courses_count', { n: dayCourses.length })}</span>
      </div>${itemsHtml}`;
    list.appendChild(group);
  }
}

function renderSemesterSelectors() {
  const opts = semesters.map(s =>
    `<option value="${s.id}" ${s.id === currentSemesterId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');
  document.getElementById('semester-select').innerHTML = opts || `<option value="">${t('no_semesters')}</option>`;
  document.getElementById('semester-select-mobile').innerHTML = opts || `<option value="">${t('no_semesters')}</option>`;
  const cur = semesters.find(s => s.id === currentSemesterId);
  document.getElementById('desktop-semester-title').textContent = cur ? cur.name : t('app_title');
}

function renderSemesterList() {
  const box = document.getElementById('semester-list');
  if (semesters.length === 0) {
    box.innerHTML = `<div class="text-xs text-gray-300 text-center py-3">${t('no_semesters')}</div>`;
    return;
  }
  box.innerHTML = semesters.map(s => `
    <div class="semester-item ${s.id === currentSemesterId ? 'current' : ''}" data-id="${s.id}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${escapeHtml(s.name)}</div>
        ${s.start_date ? `<div class="text-xs text-gray-400">${t('open_day')}${escapeHtml(s.start_date)}</div>` : ''}
      </div>
      ${s.id === currentSemesterId ? `<span class="text-xs text-primary flex-shrink-0">${t('current_tag')}</span>` : ''}
      <button class="sem-delete text-xs text-red-400 hover:text-red-600 px-2 py-1 flex-shrink-0" data-id="${s.id}">${t('delete_sem')}</button>
    </div>
  `).join('');
  renderAuthUI();
}

function renderAll() {
  renderSemesterSelectors();
  renderDesktopGrid();
  renderMobileList();
}

/* ---------- 冲突检测 ---------- */
function findConflicts(course) {
  const myWeeks = parseWeeks(course.weeks);
  return courses.filter(c => {
    if (c.id === course.id) return false;
    if (c.semester_id !== course.semester_id) return false;
    if (c.weekday !== course.weekday) return false;
    if (course.start_section > c.end_section || course.end_section < c.start_section) return false;
    // 周次交集判断
    const cWeeks = parseWeeks(c.weeks);
    if (myWeeks && cWeeks) {
      for (const w of myWeeks) if (cWeeks.has(w)) return true;
      return false;
    }
    return true;
  });
}

function showConflictTip(conflicts) {
  const tip = document.getElementById('conflict-tip');
  tip.classList.remove('hidden');
  tip.innerHTML = t('conflict_prefix') + conflicts.map(c =>
    `${escapeHtml(c.name)} (${dayName(c.weekday)} ${sectionText(c)}${c.weeks ? ' ' + escapeHtml(c.weeks) : ''})`
  ).join(', ');
}

function hideConflictTip() {
  document.getElementById('conflict-tip').classList.add('hidden');
}

/* ---------- 详情弹窗 ---------- */
function openDetail(id) {
  const c = courses.find(x => x.id === id);
  if (!c) return;
  detailCourseId = id;
  document.getElementById('detail-name').textContent = c.name;
  const rows = [
    [t('f_teacher'), c.teacher || '—'],
    [t('f_location'), c.location || '—'],
    [t('f_time'), `${dayName(c.weekday)} ${sectionText(c)} (${sectionTimeRange(c.start_section, c.end_section)})`],
    [t('f_weeks'), c.weeks || t('all_semester')],
    [t('f_note'), c.note || '—'],
  ];
  document.getElementById('detail-body').innerHTML = rows.map(([k, v]) =>
    `<div class="detail-row"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`
  ).join('');
  renderAuthUI();
  openModal('modal-detail');
}

/* ---------- 编辑弹窗 ---------- */
function populateSectionSelects() {
  const count = (window.APP_CONFIG && window.APP_CONFIG.SECTION_COUNT) || 12;
  const weekdaySel = document.getElementById('f-weekday');
  const wdVal = weekdaySel.value;
  weekdaySel.innerHTML = weekdayNames().map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
  weekdaySel.value = wdVal || '1';

  const start = document.getElementById('f-start');
  const end = document.getElementById('f-end');
  const sv = start.value, ev = end.value;
  const opts = [];
  for (let i = 1; i <= count; i++) opts.push(`<option value="${i}">${t('section', { n: i })}</option>`);
  start.innerHTML = opts;
  end.innerHTML = opts;
  start.value = sv || '1';
  end.value = ev || (count > 1 ? '2' : '1');
}

function openEdit(course) {
  editingCourseId = course ? course.id : null;
  document.getElementById('edit-title').textContent = course ? t('edit_title_edit') : t('edit_title_add');
  document.getElementById('f-name').value = course ? course.name : '';
  document.getElementById('f-teacher').value = course ? course.teacher : '';
  document.getElementById('f-location').value = course ? course.location : '';
  document.getElementById('f-weekday').value = course ? course.weekday : 1;
  document.getElementById('f-start').value = course ? course.start_section : 1;
  document.getElementById('f-end').value = course ? course.end_section : 2;
  document.getElementById('f-weeks').value = course ? course.weeks : '';
  document.getElementById('f-note').value = course ? course.note : '';
  document.getElementById('f-ignore-conflict').checked = false;
  hideConflictTip();
  openModal('modal-edit');
}

function readForm() {
  return {
    name: document.getElementById('f-name').value.trim(),
    teacher: document.getElementById('f-teacher').value.trim(),
    location: document.getElementById('f-location').value.trim(),
    weekday: Number(document.getElementById('f-weekday').value),
    start_section: Number(document.getElementById('f-start').value),
    end_section: Number(document.getElementById('f-end').value),
    weeks: document.getElementById('f-weeks').value.trim(),
    note: document.getElementById('f-note').value.trim(),
  };
}

/* ---------- 实时同步 ---------- */
function handleRealtime(payload) {
  const table = payload.table;
  if (table === 'semesters') {
    loadSemesters().then(() => {
      if (!semesters.some(s => s.id === currentSemesterId)) {
        currentSemesterId = semesters[0] ? semesters[0].id : null;
      }
      renderSemesterSelectors();
      renderSemesterList();
      return Promise.all([loadCourses(), loadTodos()]);
    }).then(() => { renderAll(); renderTodos(); });
  } else {
    // courses 表变化：直接重新拉取当前学期数据并刷新
    loadCourses().then(renderAll);
  }
  showToast(t('toast_updated_rt'));
}

function subscribeRealtime() {
  sb.channel('timetable-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, handleRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'semesters' }, handleRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {
      loadTodos().then(renderTodos);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'links' }, () => {
      loadLinks().then(renderLinks);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_modes' }, () => {
      loadFocusModes().then(() => { renderFocusModes(); });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setSyncStatus('connected');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setSyncStatus('error');
    });
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  // 弹窗关闭：遮罩 / 关闭按钮 / ESC
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  // 桌面 / 移动端课程卡片点击 → 详情
  document.getElementById('desktop-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.course-card');
    if (card && card.dataset.id) openDetail(card.dataset.id);
  });
  document.getElementById('mobile-list').addEventListener('click', (e) => {
    const card = e.target.closest('.mobile-course-card');
    if (card && card.dataset.id) openDetail(card.dataset.id);
  });

  // 学期切换
  document.getElementById('semester-select').addEventListener('change', (e) => {
    currentSemesterId = e.target.value || null;
    loadCourses().then(renderAll);
    loadTodos().then(renderTodos);
  });
  document.getElementById('semester-select-mobile').addEventListener('change', (e) => {
    currentSemesterId = e.target.value || null;
    loadCourses().then(renderAll);
    loadTodos().then(renderTodos);
  });

  // 添加课程（未解锁则先弹解锁框）
  document.getElementById('btn-add').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openEdit(null);
  });
  document.getElementById('btn-mobile-add-course').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openEdit(null);
  });

  // 登录 / 账号（顶部全局状态按钮，两个入口同逻辑：点击打开账号弹窗）
  document.getElementById('btn-auth-toggle').addEventListener('click', () => openAuth('signin'));
  document.getElementById('btn-auth-toggle-mobile').addEventListener('click', () => openAuth('signin'));

  // 登录 / 注册弹窗
  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (authMode === 'signup') signUp(); else signIn();
  });
  document.getElementById('btn-auth-switch').addEventListener('click', () => {
    authMode = authMode === 'signup' ? 'signin' : 'signup';
    showAuthError('');
    renderAuthForm();
  });
  document.getElementById('btn-auth-logout').addEventListener('click', async () => {
    if (!confirm(t('auth_confirm_logout'))) return;
    closeModal('modal-auth');
    await signOut(false);
  });
  document.getElementById('auth-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('auth-form').requestSubmit();
  });

  // 语言切换
  document.getElementById('lang-toggle').addEventListener('click', toggleLang);
  document.getElementById('lang-toggle-mobile').addEventListener('click', toggleLang);

  // 墨水屏模式切换
  document.getElementById('eink-toggle').addEventListener('click', toggleEink);
  document.getElementById('eink-toggle-mobile').addEventListener('click', toggleEink);

  // 学期管理
  document.getElementById('btn-manage-semesters').addEventListener('click', () => {
    renderSemesterList();
    openModal('modal-semesters');
  });
  document.getElementById('btn-mobile-semesters').addEventListener('click', () => {
    renderSemesterList();
    openModal('modal-semesters');
  });
  document.getElementById('btn-links').addEventListener('click', () => showPage('links'));
  document.getElementById('btn-back-timetable').addEventListener('click', () => showPage('timetable'));
  document.getElementById('nav-timetable').addEventListener('click', () => { setNavActive('nav-timetable'); showPage('timetable'); });
  document.getElementById('nav-todos').addEventListener('click', () => { setNavActive('nav-todos'); showPage('todos'); });
  document.getElementById('nav-focus').addEventListener('click', () => { setNavActive('nav-focus'); showPage('focus'); });
  document.getElementById('nav-links').addEventListener('click', () => { setNavActive('nav-links'); showPage('links'); });

  // 待办：添加
  document.getElementById('btn-add-todo').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openTodoModal();
  });
  document.getElementById('mobile-add-todo').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openTodoModal();
  });
  document.getElementById('btn-save-todo').addEventListener('click', async () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const content = document.getElementById('todo-f-content').value.trim();
    if (!content) { showToast(t('toast_enter_todo')); return; }
    const due = document.getElementById('todo-f-due').value || null;
    const cid = document.getElementById('todo-f-course').value || null;
    const recurring = document.getElementById('todo-f-recurring').checked;
    const isEdit = !!editingTodoId;
    let error;
    if (isEdit) {
      ({ error } = await sb.rpc('edit_todo', {
        p_id: editingTodoId,
        p_content: content, p_due_date: due, p_course_id: cid, p_recurring: recurring,
      }));
    } else {
      ({ error } = await sb.rpc('add_todo', {
        p_semester_id: currentSemesterId,
        p_content: content, p_due_date: due, p_course_id: cid, p_recurring: recurring,
      }));
    }
    if (error) { handleWriteError(error, isEdit ? t('toast_save_fail') : t('toast_add_fail')); return; }
    closeModal('modal-todo');
    editingTodoId = null;
    await loadTodos();
    renderTodos();
    showToast(isEdit ? t('toast_updated') : t('toast_todo_added'));
  });

  // 待办：勾选完成 / 置顶 / 删除（事件委托）
  async function handleTodoAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      // 点击待办内容区域（非按钮）也可进入编辑（仅解锁后）
      const row = e.target.closest('.todo-item');
      if (row && row.dataset.id && isLoggedIn()) {
        const td = todos.find(x => x.id === row.dataset.id);
        if (td) openTodoModal(td);
      }
      return;
    }
    const item = btn.closest('.todo-item');
    const id = item && item.dataset.id;
    const todo = todos.find(x => x.id === id);
    if (!todo) return;
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const act = btn.dataset.act;
    if (act === 'edit') { openTodoModal(todo); return; }
    if (act === 'delete') {
      if (!confirm(t('confirm_delete_todo'))) return;
      const { error } = await sb.rpc('delete_todo', { p_id: id });
      if (error) { handleWriteError(error, t('toast_delete_fail')); return; }
      showToast(t('toast_deleted'));
    } else if (act === 'toggle-done') {
      // 循环任务：按“有效完成态”切换，勾选即记录今天完成时间
      const eff = effectiveDone(todo);
      const { error } = await sb.rpc('set_todo_done', { p_id: id, p_done: !eff });
      if (error) { handleWriteError(error, t('toast_update_fail')); return; }
    } else if (act === 'toggle-pin') {
      const { error } = await sb.rpc('set_todo_pinned', { p_id: id, p_pinned: !todo.pinned });
      if (error) { handleWriteError(error, t('toast_update_fail')); return; }
    }
    await loadTodos();
    renderTodos();
  }
  document.getElementById('todo-list').addEventListener('click', handleTodoAction);
  document.getElementById('mobile-todo-list').addEventListener('click', handleTodoAction);

  // 网站跳转：添加 / 保存 / 卡片点击
  document.getElementById('btn-add-link').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openLinkModal(null);
  });
  document.getElementById('btn-save-link').addEventListener('click', async () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const name = document.getElementById('link-f-name').value.trim();
    const url = normalizeUrl(document.getElementById('link-f-url').value);
    if (!name) { showToast(t('toast_enter_link_name')); return; }
    if (!url) { showToast(t('toast_enter_link_url')); return; }
    const isEdit = !!editingLinkId;
    let error;
    if (isEdit) {
      ({ error } = await sb.rpc('update_link', { p_id: editingLinkId, p_name: name, p_url: url }));
    } else {
      ({ error } = await sb.rpc('add_link', { p_name: name, p_url: url }));
    }
    if (error) { handleWriteError(error, isEdit ? t('toast_save_fail') : t('toast_add_fail')); return; }
    closeModal('modal-link');
    editingLinkId = null;
    await loadLinks();
    renderLinks();
    showToast(isEdit ? t('toast_link_updated') : t('toast_link_added'));
  });
  document.getElementById('links-grid').addEventListener('click', async (e) => {
    const card = e.target.closest('.link-card');
    if (!card) return;
    const id = card.dataset.id;
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const link = links.find(x => x.id === id);
      if (!link) return;
      if (!isLoggedIn()) { openAuth('signin'); return; }
      if (actBtn.dataset.act === 'delete') {
        if (!confirm(t('confirm_delete_link'))) return;
        const { error } = await sb.rpc('delete_link', { p_id: id });
        if (error) { handleWriteError(error, t('toast_delete_fail')); return; }
        await loadLinks();
        renderLinks();
        showToast(t('toast_link_deleted'));
      } else {
        openLinkModal(link);
      }
      return;
    }
    // 点击卡片空白处 → 新标签打开网址
    const url = card.dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
  });

  // 学期列表：点击切换 / 删除
  document.getElementById('semester-list').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.sem-delete');
    if (delBtn) {
      e.stopPropagation();
      await deleteSemester(delBtn.dataset.id);
      return;
    }
    const item = e.target.closest('.semester-item');
    if (item && item.dataset.id && item.dataset.id !== currentSemesterId) {
      currentSemesterId = item.dataset.id;
      renderSemesterSelectors();
      renderSemesterList();
      await loadCourses();
      renderAll();
      await loadTodos();
      renderTodos();
    }
  });

  // 新建学期（需解锁，走口令校验 RPC）
  document.getElementById('btn-create-semester').addEventListener('click', async () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const name = document.getElementById('new-semester-name').value.trim();
    if (!name) { showToast(t('toast_enter_semester_name')); return; }
    const start_date = document.getElementById('new-semester-date').value || null;
    const { error } = await sb.rpc('add_semester', { p_name: name, p_start_date: start_date });
    if (error) { handleWriteError(error, t('toast_create_fail')); return; }
    document.getElementById('new-semester-name').value = '';
    document.getElementById('new-semester-date').value = '';
    await loadSemesters();
    if (!currentSemesterId) currentSemesterId = semesters[0] ? semesters[0].id : null;
    renderSemesterSelectors();
    renderSemesterList();
    if (currentSemesterId) await loadCourses();
    renderAll();
    showToast(t('toast_semester_created'));
  });

  // 详情弹窗：编辑 / 删除（需解锁，删除走口令校验 RPC）
  document.getElementById('btn-edit-course').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const c = courses.find(x => x.id === detailCourseId);
    closeModal('modal-detail');
    if (c) openEdit(c);
  });
  document.getElementById('btn-delete-course').addEventListener('click', async () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    const c = courses.find(x => x.id === detailCourseId);
    if (!c) return;
    if (!confirm(t('confirm_delete_course', { name: c.name }))) return;
    const { error } = await sb.rpc('delete_course', { p_id: c.id });
    if (error) { handleWriteError(error, t('toast_delete_fail')); return; }
    closeModal('modal-detail');
    await loadCourses();
    renderAll();
    showToast('已删除');
  });

  // 编辑表单：节次联动 + 提交
  document.getElementById('f-start').addEventListener('change', () => {
    const s = Number(document.getElementById('f-start').value);
    const e = Number(document.getElementById('f-end').value);
    if (e < s) document.getElementById('f-end').value = String(s);
  });

  document.getElementById('course-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    if (!data.name) { showToast(t('toast_enter_name')); return; }
    if (data.end_section < data.start_section) { showToast(t('toast_end_before_start')); return; }

    const conflicts = findConflicts({
      id: editingCourseId,
      semester_id: currentSemesterId,
      weekday: data.weekday,
      start_section: data.start_section,
      end_section: data.end_section,
      weeks: data.weeks,
    });
    const ignore = document.getElementById('f-ignore-conflict').checked;
    if (conflicts.length && !ignore) {
      showConflictTip(conflicts);
      return;
    }
    hideConflictTip();

    try {
      let error;
      const params = {
        p_name: data.name,
        p_weekday: data.weekday,
        p_start: data.start_section,
        p_end: data.end_section,
        p_teacher: data.teacher || null,
        p_location: data.location || null,
        p_weeks: data.weeks || null,
        p_note: data.note || null,
      };
      if (editingCourseId) {
        ({ error } = await sb.rpc('update_course', { ...params, p_id: editingCourseId }));
      } else {
        ({ error } = await sb.rpc('add_course', { ...params, p_semester_id: currentSemesterId }));
      }
      if (error) throw error;
      closeModal('modal-edit');
      await loadCourses();
      renderAll();
      showToast(editingCourseId ? t('toast_updated') : t('toast_added'));
    } catch (err) {
      handleWriteError(err, t('toast_save_fail'));
    }
  });

  bindSidebarResize();
  bindGridResize();

  document.getElementById('btn-cancel-edit').addEventListener('click', () => closeModal('modal-edit'));

  // 专注：模式管理 + 计时控制
  document.getElementById('btn-add-focus-mode').addEventListener('click', () => {
    if (!isLoggedIn()) { openAuth('signin'); return; }
    openFocusModeModal(null);
  });
  document.getElementById('btn-save-focus-mode').addEventListener('click', saveFocusMode);
  document.getElementById('btn-focus-pause').addEventListener('click', togglePauseFocus);
  document.getElementById('btn-focus-stop').addEventListener('click', () => stopFocus(false));
  document.getElementById('focus-mode-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.focus-mode-item');
    if (!item) return;
    const id = item.dataset.id;
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      e.stopPropagation();
      const mode = focusModes.find(x => x.id === id);
      if (!mode) return;
      if (!isLoggedIn()) { openAuth('signin'); return; }
      if (actBtn.dataset.act === 'edit') openFocusModeModal(mode);
      else if (actBtn.dataset.act === 'delete') await deleteFocusMode(id);
      return;
    }
    // 点击卡片 → 开始该模式
    const mode = focusModes.find(x => x.id === id);
    if (mode) startFocus(mode);
  });
}

// 侧边栏宽度拖拽
function bindSidebarResize() {
  const resizer = document.getElementById('sidebar-resizer');
  if (!resizer) return;
  let startX = 0, startW = 0;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = parseInt(getComputedStyle(document.getElementById('sidebar')).width, 10) || 256;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => applySidebarWidth(Math.min(420, Math.max(180, startW + (ev.clientX - startX))));
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// 课表列宽拖拽缩放（只调列宽）
function bindGridResize() {
  const handle = document.getElementById('grid-resize-handle');
  if (!handle) return;
  let startX = 0, startCol = 0;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const cell = document.querySelector('#day-header .day-header-cell:nth-child(2)');
    startCol = colW || (cell ? cell.getBoundingClientRect().width : 100);
    startX = e.clientX;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => applyColWidth(Math.min(320, Math.max(60, Math.round(startCol + (ev.clientX - startX)))));
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function setNavActive(id) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    const active = b.id === id;
    b.classList.toggle('active', active);
    b.classList.toggle('text-primary', active);
    b.classList.toggle('text-gray-400', !active);
  });
}

async function deleteSemester(id) {
  const s = semesters.find(x => x.id === id);
  if (!s) return;
  if (!isLoggedIn()) { openAuth('signin'); return; }
  if (!confirm(t('confirm_delete_semester', { name: s.name }))) return;
  const { error } = await sb.rpc('delete_semester', { p_id: id });
  if (error) { handleWriteError(error, '删除失败'); return; }
  await loadSemesters();
  if (currentSemesterId === id) currentSemesterId = semesters[0] ? semesters[0].id : null;
  renderSemesterSelectors();
  renderSemesterList();
  if (currentSemesterId) await loadCourses();
  renderAll();
  showToast('已删除学期');
}

/* ---------- 初始化 ---------- */
async function init() {
  const cfg = window.APP_CONFIG || {};

  // 恢复 UI 偏好：课表列宽 + 侧边栏宽度（存浏览器本地，非课表数据）
  const savedColW = parseInt(localStorage.getItem('timetable_col_w'), 10);
  if (!isNaN(savedColW)) colW = savedColW;
  const savedSw = parseInt(localStorage.getItem('timetable_sidebar_w'), 10);
  if (!isNaN(savedSw)) document.documentElement.style.setProperty('--sidebar-w', savedSw + 'px');

  populateSectionSelects();
  renderDayHeader();
  renderSectionTimes();
  bindEvents();
  initEink();

  // 初始渲染（登录态此时尚未恢复，先按访客显示，稍后 getSession 后自动刷新）
  renderAuthUI();
  applyLanguage();

  // 未配置 Supabase 时的友好提示
  const urlMissing = !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT');
  const keyMissing = !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR-ANON');
  if (urlMissing || keyMissing || typeof window.supabase === 'undefined') {
    setSyncStatus('error', t('sync_noconfig'));
    renderAll();
    showToast(t('sync_noconfig'));
    return;
  }

  initSupabase();

  // 恢复登录态（Supabase Auth session 本地持久化）
  try {
    const { data } = await sb.auth.getSession();
    setUser(data && data.session ? data.session.user : null);
  } catch (e) {
    setUser(null);
  }

  // 监听登录状态变化（登录 / 登出 / 多标签页同步）
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      const was = !!currentUser;
      setUser(null);
      if (was) { renderTodos(); renderLinks(); renderFocusModes(); }
    } else if (event === 'SIGNED_IN') {
      const isNew = !currentUser || (session && session.user && currentUser.id !== session.user.id);
      setUser(session && session.user ? session.user : null);
      if (isNew && currentUser) onSignedIn();
    }
  });

  subscribeRealtime();

  // 1) 先用本地缓存立即渲染，秒出，避免冷启动/断网时长时间空白
  const cachedSemesters = cacheGet(CACHE_KEYS.semesters);
  if (cachedSemesters && cachedSemesters.length) {
    semesters = cachedSemesters;
    currentSemesterId = semesters[0].id;
    const _cCourses = cacheGet(CACHE_KEYS.courses);
    if (_cCourses && _cCourses[currentSemesterId]) courses = _cCourses[currentSemesterId];
    const _cTodos = cacheGet(CACHE_KEYS.todos);
    if (_cTodos && _cTodos[currentSemesterId]) todos = _cTodos[currentSemesterId];
    const _cLinks = cacheGet(CACHE_KEYS.links);
    if (_cLinks) links = _cLinks;
    const _cFocus = cacheGet(CACHE_KEYS.focus);
    if (_cFocus) focusModes = _cFocus;
    renderSemesterSelectors();
    renderAll();
    renderTodos();
    renderLinks();
    renderFocusModes();
  }
  showPage('timetable');

  // 2) 后台加载云端最新数据，成功后覆盖缓存与界面
  await loadSemesters();
  currentSemesterId = semesters[0] ? semesters[0].id : null;
  renderSemesterSelectors();
  if (currentSemesterId) { await loadCourses(); await loadTodos(); }
  renderAll();
  renderTodos();
  await loadLinks();
  renderLinks();
  await loadFocusModes();
  renderFocusModes();

  if (!currentSemesterId) showToast(t('toast_create_semester_first'));

  // 每 15 秒检查一次分钟变化，跨过下课时间自动刷新「已过」淡化（隔天打开自动恢复）
  let lastMinute = new Date().getMinutes();
  setInterval(() => {
    const m = new Date().getMinutes();
    if (m !== lastMinute) { lastMinute = m; renderAll(); }
  }, 15000);
}

document.addEventListener('DOMContentLoaded', init);

/* ---------- PWA：注册 Service Worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service Worker 注册失败:', err && err.message ? err.message : err);
    });
  });
}
