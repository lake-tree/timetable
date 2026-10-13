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

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* ---------- 工具函数 ---------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function dayName(n) {
  return WEEKDAYS[(Number(n) || 1) - 1] || '';
}

function sectionText(c) {
  return c.start_section === c.end_section
    ? `第${c.start_section}节`
    : `第${c.start_section}-${c.end_section}节`;
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
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- 同步状态指示 ---------- */
function setSyncStatus(state, text) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (state === 'connected') {
    dot.className = 'w-2 h-2 rounded-full connected';
    txt.textContent = text || '已连接 · 实时同步中';
  } else if (state === 'error') {
    dot.className = 'w-2 h-2 rounded-full error';
    txt.textContent = text || '连接中断';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-gray-300';
    txt.textContent = text || '连接中…';
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
  showToast('已锁定，回到只读模式');
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
    showToast('口令错误，已锁定编辑');
  } else {
    showToast((fallback || '操作失败') + '：' + (err && err.message ? err.message : err));
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

function renderTodos() {
  const sorted = [...todos].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return new Date(b.pinned_at || 0) - new Date(a.pinned_at || 0);
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  const unlocked = isUnlocked();

  const itemHtml = (t) => {
    const due = t.due_date ? `📅 ${escapeHtml(t.due_date)}` : '';
    const cname = t.course_id ? `📚 ${escapeHtml(courseName(t.course_id))}` : '';
    const meta = [due, cname].filter(Boolean).join(' · ');
    const checkBtn = unlocked
      ? `<button class="todo-check" data-act="toggle-done">${t.done ? '✓' : '○'}</button>`
      : `<span class="todo-check" style="cursor:default">${t.done ? '✓' : '○'}</span>`;
    const actions = unlocked
      ? `<button class="todo-pin" data-act="toggle-pin">${t.pinned ? '📌' : '📍'}</button>
         <button class="todo-del" data-act="delete">🗑</button>`
      : (t.pinned ? '<span class="todo-pin-static">📌</span>' : '');
    return `
      <div class="todo-item ${t.done ? 'done' : ''} ${t.pinned ? 'pinned' : ''}" data-id="${t.id}">
        ${checkBtn}
        <div class="todo-main">
          <div class="todo-content">${escapeHtml(t.content)}</div>
          ${meta ? `<div class="todo-meta">${meta}</div>` : ''}
        </div>
        ${actions}
      </div>`;
  };

  const empty = '<div class="text-xs text-gray-300 text-center py-2">暂无待办</div>';
  document.getElementById('todo-list').innerHTML = sorted.length ? sorted.map(itemHtml).join('') : empty;
  document.getElementById('mobile-todo-list').innerHTML = sorted.length ? sorted.map(itemHtml).join('') : empty;
}

function renderTodoCourseOptions() {
  const sel = document.getElementById('todo-f-course');
  sel.innerHTML = '<option value="">关联课程（可选）</option>' +
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
  box.innerHTML = times.map(t =>
    `<div class="flex justify-between"><span>${escapeHtml(t.label)}</span><span>${escapeHtml(t.time)}</span></div>`
  ).join('');
}

function renderDayHeader() {
  const header = document.getElementById('day-header');
  header.style.gridTemplateColumns = '56px repeat(7, minmax(0, 1fr))';
  const corner = document.createElement('div');
  corner.className = 'day-header-cell';
  corner.textContent = '节次';
  header.appendChild(corner);
  const subs = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  WEEKDAYS.forEach((n, i) => {
    const c = document.createElement('div');
    c.className = 'day-header-cell';
    const isWeekend = i >= 5;
    c.innerHTML = `<span class="${isWeekend ? 'weekend' : ''}">${n}</span><span class="sub">${subs[i]}</span>`;
    header.appendChild(c);
  });
}

function renderDesktopGrid() {
  const grid = document.getElementById('desktop-grid');
  grid.innerHTML = '';
  const count = (window.APP_CONFIG && window.APP_CONFIG.SECTION_COUNT) || 12;
  const times = (window.APP_CONFIG && window.APP_CONFIG.SECTION_TIMES) || [];
  grid.style.gridTemplateColumns = '56px repeat(7, minmax(0, 1fr))';
  grid.style.gridAutoRows = '56px';

  // 时间列 + 背景网格线
  for (let s = 1; s <= count; s++) {
    const t = times[s - 1] || { label: `第${s}节`, time: '' };
    const timeCell = document.createElement('div');
    timeCell.className = 'time-cell';
    timeCell.style.gridColumn = '1';
    timeCell.style.gridRow = String(s);
    timeCell.innerHTML = `<span class="t">${escapeHtml(t.label)}</span><span class="tm">${escapeHtml(t.time)}</span>`;
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
  for (let d = 1; d <= 7; d++) {
    const dayCourses = courses.filter(c => c.weekday === d);
    const isWeekend = d >= 6;
    const accent = isWeekend ? '#E04F5F' : '#3A7BF9';

    let itemsHtml = '';
    if (dayCourses.length === 0) {
      itemsHtml = '<div class="text-xs text-gray-300 text-center py-3">暂无课程</div>';
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
    group.className = 'mb-4';
    group.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <span class="w-1.5 h-4 rounded-full" style="background:${accent}"></span>
        <span class="font-semibold text-sm ${isWeekend ? 'text-red-400' : ''}">${WEEKDAYS[d - 1]}</span>
        <span class="text-xs text-gray-400">${dayCourses.length} 节课</span>
      </div>${itemsHtml}`;
    list.appendChild(group);
  }
}

function renderSemesterSelectors() {
  const opts = semesters.map(s =>
    `<option value="${s.id}" ${s.id === currentSemesterId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');
  document.getElementById('semester-select').innerHTML = opts || '<option value="">无学期</option>';
  document.getElementById('semester-select-mobile').innerHTML = opts || '<option value="">无学期</option>';
  const cur = semesters.find(s => s.id === currentSemesterId);
  document.getElementById('desktop-semester-title').textContent = cur ? cur.name : '课表';
}

function renderSemesterList() {
  const box = document.getElementById('semester-list');
  if (semesters.length === 0) {
    box.innerHTML = '<div class="text-xs text-gray-300 text-center py-3">暂无学期，请先创建</div>';
    return;
  }
  box.innerHTML = semesters.map(s => `
    <div class="semester-item ${s.id === currentSemesterId ? 'current' : ''}" data-id="${s.id}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${escapeHtml(s.name)}</div>
        ${s.start_date ? `<div class="text-xs text-gray-400">开学：${escapeHtml(s.start_date)}</div>` : ''}
      </div>
      ${s.id === currentSemesterId ? '<span class="text-xs text-primary flex-shrink-0">当前</span>' : ''}
      <button class="sem-delete text-xs text-red-400 hover:text-red-600 px-2 py-1 flex-shrink-0" data-id="${s.id}">删除</button>
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
  tip.innerHTML = '⚠️ 时间冲突：' + conflicts.map(c =>
    `${escapeHtml(c.name)}（${dayName(c.weekday)} ${sectionText(c)}${c.weeks ? ' ' + escapeHtml(c.weeks) : ''}）`
  ).join('、');
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
    ['教师', c.teacher || '—'],
    ['教室', c.location || '—'],
    ['时间', `${dayName(c.weekday)} ${sectionText(c)}（${sectionTimeRange(c.start_section, c.end_section)}）`],
    ['周次', c.weeks || '全学期'],
    ['备注', c.note || '—'],
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
  const start = document.getElementById('f-start');
  const end = document.getElementById('f-end');
  const opts = [];
  for (let i = 1; i <= count; i++) opts.push(`<option value="${i}">第${i}节</option>`);
  start.innerHTML = opts;
  end.innerHTML = opts;
  start.value = '1';
  end.value = count > 1 ? '2' : '1';
}

function openEdit(course) {
  editingCourseId = course ? course.id : null;
  document.getElementById('edit-title').textContent = course ? '编辑课程' : '添加课程';
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
  showToast('已实时更新');
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
    if (!pwd) { showToast('请输入口令'); return; }
    const { data, error } = await sb.rpc('verify_edit_password', { p: pwd });
    if (!error && data === true) {
      unlock(pwd);
      closeModal('modal-unlock');
      showToast('已解锁编辑');
    } else {
      showToast('口令错误');
    }
  });
  document.getElementById('unlock-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-unlock-confirm').click();
  });

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
    if (!content) { showToast('请输入待办内容'); return; }
    const due = document.getElementById('todo-f-due').value || null;
    const cid = document.getElementById('todo-f-course').value || null;
    const { error } = await sb.rpc('add_todo', {
      p_pwd: editPwd, p_semester_id: currentSemesterId,
      p_content: content, p_due_date: due, p_course_id: cid,
    });
    if (error) { handleWriteError(error, '添加失败'); return; }
    closeModal('modal-todo');
    await loadTodos();
    renderTodos();
    showToast('已添加待办');
  });

  // 待办：勾选完成 / 置顶 / 删除（事件委托）
  async function handleTodoAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = btn.closest('.todo-item');
    const id = item && item.dataset.id;
    const t = todos.find(x => x.id === id);
    if (!t) return;
    if (!isUnlocked()) { openUnlock(); return; }
    const act = btn.dataset.act;
    if (act === 'delete') {
      if (!confirm('删除这条待办？')) return;
      const { error } = await sb.rpc('delete_todo', { p_pwd: editPwd, p_id: id });
      if (error) { handleWriteError(error, '删除失败'); return; }
      showToast('已删除');
    } else {
      const done = act === 'toggle-done' ? !t.done : t.done;
      const pinned = act === 'toggle-pin' ? !t.pinned : t.pinned;
      const { error } = await sb.rpc('update_todo', {
        p_pwd: editPwd, p_id: id, p_content: t.content,
        p_done: done, p_pinned: pinned,
        p_due_date: t.due_date || null, p_course_id: t.course_id || null,
      });
      if (error) { handleWriteError(error, '更新失败'); return; }
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
    if (!name) { showToast('请输入学期名称'); return; }
    const start_date = document.getElementById('new-semester-date').value || null;
    const { error } = await sb.rpc('add_semester', { p_pwd: editPwd, p_name: name, p_start_date: start_date });
    if (error) { handleWriteError(error, '创建失败'); return; }
    document.getElementById('new-semester-name').value = '';
    document.getElementById('new-semester-date').value = '';
    await loadSemesters();
    if (!currentSemesterId) currentSemesterId = semesters[0] ? semesters[0].id : null;
    renderSemesterSelectors();
    renderSemesterList();
    if (currentSemesterId) await loadCourses();
    renderAll();
    showToast('学期已创建');
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
    if (!confirm(`确定删除课程「${c.name}」吗？`)) return;
    const { error } = await sb.rpc('delete_course', { p_pwd: editPwd, p_id: c.id });
    if (error) { handleWriteError(error, '删除失败'); return; }
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
    if (!data.name) { showToast('请填写课程名'); return; }
    if (data.end_section < data.start_section) { showToast('结束节次不能早于开始节次'); return; }

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
      showToast(editingCourseId ? '已更新' : '已添加');
    } catch (err) {
      handleWriteError(err, '保存失败');
    }
  });

  document.getElementById('btn-cancel-edit').addEventListener('click', () => closeModal('modal-edit'));
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
  if (!confirm(`确定删除学期「${s.name}」吗？该学期下的所有课程也会被删除。`)) return;
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

  populateSectionSelects();
  renderDayHeader();
  renderSectionTimes();
  bindEvents();

  // 恢复编辑口令（同一标签页会话内保持解锁）
  editPwd = sessionStorage.getItem('edit_pwd') || null;
  renderAuthUI();

  // 未配置 Supabase 时的友好提示
  const urlMissing = !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT');
  const keyMissing = !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR-ANON');
  if (urlMissing || keyMissing || typeof window.supabase === 'undefined') {
    setSyncStatus('error', '未配置 Supabase，请编辑 config.js');
    renderAll();
    showToast('请先在 config.js 填写 Supabase URL 与 anon key');
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

  if (!currentSemesterId) showToast('请先在「学期管理」中创建学期');
}

document.addEventListener('DOMContentLoaded', init);
