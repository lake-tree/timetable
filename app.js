/* ============================================================
   app.js — 课表应用核心逻辑
   功能：数据加载 / 渲染 / 编辑 / 冲突检测 / 实时同步 / 学期管理
   ============================================================ */

/* ---------- 全局状态 ---------- */
let sb = null;               // Supabase 客户端实例（避免与 SDK 全局变量 supabase 重名）
let semesters = [];          // 全部学期
let courses = [];            // 当前学期的课程
let todos = [];              // 当前学期的待办
let currentSemesterId = null;
let editingCourseId = null;  // 正在编辑的课程 id（null 表示新增）
let detailCourseId = null;   // 详情弹窗当前课程 id
let editPwd = null;          // 已解锁的编辑口令（仅存内存/sessionStorage，用于 RPC 校验）
let colW = null;             // 课表列宽（px；null 表示自适应铺满）

const WEEKDAY_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'];
function weekdayNames() { return WEEKDAY_KEYS.map(k => t(k)); }

/* ---------- 国际化（中英切换，仅界面文字） ---------- */
const I18N = {
  zh: {
    app_title: '课表', app_subtitle: 'Timetable · 实时同步', current_semester: '当前学期',
    add_course: '＋ 添加课程', unlock_edit: '🔒 解锁编辑', lock_edit: '锁定编辑', manage_semesters: '学期管理',
    todo_title: '📝 待办', add_todo_btn: '＋ 添加', section_ref: '节次参考', corner: '节次',
    nav_timetable: '课表', nav_add: '添加', nav_todos: '待办', nav_semesters: '学期',
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
    todo_add_title: '添加待办', label_content: '内容', label_due: '截止日期（可选）', label_course: '关联课程（可选）',
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
    confirm_delete_course: '确定删除课程「{name}」吗？', confirm_delete_todo: '删除这条待办？',
    confirm_delete_semester: '确定删除学期「{name}」吗？该学期下的所有课程也会被删除。',
    write_error_pwd: '口令错误，已锁定编辑', op_fail: '操作失败',
    drag_col: '拖动调整列宽', drag_sidebar: '拖动调整侧边栏宽度',
  },
  en: {
    app_title: 'Timetable', app_subtitle: 'Timetable · Realtime sync', current_semester: 'Semester',
    add_course: '＋ Add course', unlock_edit: '🔒 Unlock edit', lock_edit: 'Lock editing', manage_semesters: 'Semesters',
    todo_title: '📝 Todos', add_todo_btn: '＋ Add', section_ref: 'Periods', corner: 'Period',
    nav_timetable: 'Timetable', nav_add: 'Add', nav_todos: 'Todos', nav_semesters: 'Semesters',
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
    todo_add_title: 'Add todo', label_content: 'Content', label_due: 'Due date (optional)', label_course: 'Related course (optional)',
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
    confirm_delete_course: 'Delete course "{name}"?', confirm_delete_todo: 'Delete this todo?',
    confirm_delete_semester: 'Delete semester "{name}"? All its courses will also be deleted.',
    write_error_pwd: 'Wrong password, editing locked', op_fail: 'Operation failed',
    drag_col: 'Drag to resize column width', drag_sidebar: 'Drag to resize sidebar',
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
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('timetable_lang', currentLang);
  applyLanguage();
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

/* ---------- 口令解锁（访客只读 + 口令编辑） ---------- */
function isUnlocked() { return !!editPwd; }

function lock() {
  editPwd = null;
  sessionStorage.removeItem('edit_pwd');
  renderAuthUI();
  renderTodos();
  showToast(t('toast_locked'));
}

function unlock(pwd) {
  editPwd = pwd;
  sessionStorage.setItem('edit_pwd', pwd);
  renderAuthUI();
  renderTodos();
}

function openUnlock() {
  const input = document.getElementById('unlock-password');
  input.value = '';
  openModal('modal-unlock');
  setTimeout(() => input.focus(), 50);
}

// 根据解锁状态切换增删改入口的显隐
function renderAuthUI() {
  const unlocked = isUnlocked();
  document.getElementById('btn-add').classList.toggle('hidden', !unlocked);
  document.getElementById('btn-unlock').classList.toggle('hidden', unlocked);
  document.getElementById('btn-lock').classList.toggle('hidden', !unlocked);
  document.getElementById('detail-actions').classList.toggle('hidden', !unlocked);
  document.getElementById('detail-lock-hint').classList.toggle('hidden', unlocked);
  document.getElementById('btn-add-todo').classList.toggle('hidden', !unlocked);
  document.getElementById('mobile-add-todo').classList.toggle('hidden', !unlocked);
  document.querySelectorAll('.sem-delete').forEach(b => b.classList.toggle('hidden', !unlocked));
}

// 写操作报错统一处理：口令错误则强制锁定并提示
function handleWriteError(err, fallback) {
  if (err && (err.code === '42501' || /口令/.test(err.message || ''))) {
    lock();
    showToast(t('write_error_pwd'));
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
}

async function loadCourses() {
  if (!currentSemesterId) { courses = []; return; }
  const { data, error } = await sb
    .from('courses')
    .select('*')
    .eq('semester_id', currentSemesterId);
  if (error) { console.error('loadCourses error:', error); setSyncStatus('error'); return; }
  courses = (data || []).sort((a, b) => a.weekday - b.weekday || a.start_section - b.start_section);
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
  const unlocked = isUnlocked();

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
      ? `<button class="todo-pin" data-act="toggle-pin">${todo.pinned ? '📌' : '📍'}</button>
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

function openTodoModal() {
  document.getElementById('todo-f-content').value = '';
  document.getElementById('todo-f-due').value = '';
  renderTodoCourseOptions();
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
    card.className = 'course-card';
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
        <div class="mobile-course-card bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-2 cursor-pointer"
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
    if (!isUnlocked()) { openUnlock(); return; }
    openEdit(null);
  });
  document.getElementById('nav-add').addEventListener('click', () => {
    setNavActive('nav-add');
    if (!isUnlocked()) { openUnlock(); return; }
    openEdit(null);
  });

  // 解锁 / 锁定
  document.getElementById('btn-unlock').addEventListener('click', () => openUnlock());
  document.getElementById('btn-unlock-from-detail').addEventListener('click', () => openUnlock());
  document.getElementById('btn-lock').addEventListener('click', () => lock());
  document.getElementById('btn-unlock-confirm').addEventListener('click', async () => {
    const pwd = document.getElementById('unlock-password').value;
    if (!pwd) { showToast(t('toast_enter_password')); return; }
    const { data, error } = await sb.rpc('verify_edit_password', { p: pwd });
    if (!error && data === true) {
      unlock(pwd);
      closeModal('modal-unlock');
      showToast(t('toast_unlocked'));
    } else {
      showToast(t('toast_wrong_password'));
    }
  });
  document.getElementById('unlock-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-unlock-confirm').click();
  });

  // 语言切换
  document.getElementById('lang-toggle').addEventListener('click', toggleLang);
  document.getElementById('lang-toggle-mobile').addEventListener('click', toggleLang);

  // 学期管理
  document.getElementById('btn-manage-semesters').addEventListener('click', () => {
    renderSemesterList();
    openModal('modal-semesters');
  });
  document.getElementById('nav-semesters').addEventListener('click', () => {
    setNavActive('nav-semesters');
    renderSemesterList();
    openModal('modal-semesters');
  });
  document.getElementById('nav-timetable').addEventListener('click', () => {
    setNavActive('nav-timetable');
    document.getElementById('mobile-view').classList.remove('hidden');
    document.getElementById('mobile-todos-view').classList.add('hidden');
  });
  document.getElementById('nav-todos').addEventListener('click', () => {
    setNavActive('nav-todos');
    document.getElementById('mobile-view').classList.add('hidden');
    document.getElementById('mobile-todos-view').classList.remove('hidden');
    renderTodos();
  });

  // 待办：添加
  document.getElementById('btn-add-todo').addEventListener('click', () => {
    if (!isUnlocked()) { openUnlock(); return; }
    openTodoModal();
  });
  document.getElementById('mobile-add-todo').addEventListener('click', () => {
    if (!isUnlocked()) { openUnlock(); return; }
    openTodoModal();
  });
  document.getElementById('btn-save-todo').addEventListener('click', async () => {
    if (!isUnlocked()) { openUnlock(); return; }
    const content = document.getElementById('todo-f-content').value.trim();
    if (!content) { showToast(t('toast_enter_todo')); return; }
    const due = document.getElementById('todo-f-due').value || null;
    const cid = document.getElementById('todo-f-course').value || null;
    const recurring = document.getElementById('todo-f-recurring').checked;
    const { error } = await sb.rpc('add_todo', {
      p_pwd: editPwd, p_semester_id: currentSemesterId,
      p_content: content, p_due_date: due, p_course_id: cid, p_recurring: recurring,
    });
    if (error) { handleWriteError(error, t('toast_add_fail')); return; }
    closeModal('modal-todo');
    await loadTodos();
    renderTodos();
    showToast(t('toast_todo_added'));
  });

  // 待办：勾选完成 / 置顶 / 删除（事件委托）
  async function handleTodoAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = btn.closest('.todo-item');
    const id = item && item.dataset.id;
    const todo = todos.find(x => x.id === id);
    if (!todo) return;
    if (!isUnlocked()) { openUnlock(); return; }
    const act = btn.dataset.act;
    if (act === 'delete') {
      if (!confirm(t('confirm_delete_todo'))) return;
      const { error } = await sb.rpc('delete_todo', { p_pwd: editPwd, p_id: id });
      if (error) { handleWriteError(error, t('toast_delete_fail')); return; }
      showToast(t('toast_deleted'));
    } else if (act === 'toggle-done') {
      // 循环任务：按“有效完成态”切换，勾选即记录今天完成时间
      const eff = effectiveDone(todo);
      const { error } = await sb.rpc('set_todo_done', { p_pwd: editPwd, p_id: id, p_done: !eff });
      if (error) { handleWriteError(error, t('toast_update_fail')); return; }
    } else if (act === 'toggle-pin') {
      const { error } = await sb.rpc('set_todo_pinned', { p_pwd: editPwd, p_id: id, p_pinned: !todo.pinned });
      if (error) { handleWriteError(error, t('toast_update_fail')); return; }
    }
    await loadTodos();
    renderTodos();
  }
  document.getElementById('todo-list').addEventListener('click', handleTodoAction);
  document.getElementById('mobile-todo-list').addEventListener('click', handleTodoAction);

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
    if (!isUnlocked()) { openUnlock(); return; }
    const name = document.getElementById('new-semester-name').value.trim();
    if (!name) { showToast(t('toast_enter_semester_name')); return; }
    const start_date = document.getElementById('new-semester-date').value || null;
    const { error } = await sb.rpc('add_semester', { p_pwd: editPwd, p_name: name, p_start_date: start_date });
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
    if (!isUnlocked()) { openUnlock(); return; }
    const c = courses.find(x => x.id === detailCourseId);
    closeModal('modal-detail');
    if (c) openEdit(c);
  });
  document.getElementById('btn-delete-course').addEventListener('click', async () => {
    if (!isUnlocked()) { openUnlock(); return; }
    const c = courses.find(x => x.id === detailCourseId);
    if (!c) return;
    if (!confirm(t('confirm_delete_course', { name: c.name }))) return;
    const { error } = await sb.rpc('delete_course', { p_pwd: editPwd, p_id: c.id });
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
        p_pwd: editPwd,
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
  if (!isUnlocked()) { openUnlock(); return; }
  if (!confirm(t('confirm_delete_semester', { name: s.name }))) return;
  const { error } = await sb.rpc('delete_semester', { p_pwd: editPwd, p_id: id });
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

  // 恢复编辑口令（同一标签页会话内保持解锁）
  editPwd = sessionStorage.getItem('edit_pwd') || null;
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
  subscribeRealtime();

  await loadSemesters();
  currentSemesterId = semesters[0] ? semesters[0].id : null;
  renderSemesterSelectors();
  if (currentSemesterId) { await loadCourses(); await loadTodos(); }
  renderAll();
  renderTodos();

  if (!currentSemesterId) showToast(t('toast_create_semester_first'));
}

document.addEventListener('DOMContentLoaded', init);
