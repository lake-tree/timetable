/* ============================================================
   app.js — 课表应用核心逻辑
   功能：数据加载 / 渲染 / 编辑 / 冲突检测 / 实时同步 / 学期管理
   ============================================================ */

/* ---------- 全局状态 ---------- */
let sb = null;               // Supabase 客户端实例（避免与 SDK 全局变量 supabase 重名）
let semesters = [];          // 全部学期
let courses = [];            // 当前学期的课程
let currentSemesterId = null;
let editingCourseId = null;  // 正在编辑的课程 id（null 表示新增）
let detailCourseId = null;   // 详情弹窗当前课程 id

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
      return loadCourses();
    }).then(renderAll);
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
  });
  document.getElementById('semester-select-mobile').addEventListener('change', (e) => {
    currentSemesterId = e.target.value || null;
    loadCourses().then(renderAll);
  });

  // 添加课程
  document.getElementById('btn-add').addEventListener('click', () => openEdit(null));
  document.getElementById('nav-add').addEventListener('click', () => {
    setNavActive('nav-add');
    openEdit(null);
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
  document.getElementById('nav-timetable').addEventListener('click', () => setNavActive('nav-timetable'));

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
    }
  });

  // 新建学期
  document.getElementById('btn-create-semester').addEventListener('click', async () => {
    const name = document.getElementById('new-semester-name').value.trim();
    if (!name) { showToast('请输入学期名称'); return; }
    const start_date = document.getElementById('new-semester-date').value || null;
    const { error } = await sb.from('semesters').insert([{ name, start_date }]);
    if (error) { showToast('创建失败：' + error.message); return; }
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

  // 详情弹窗：编辑 / 删除
  document.getElementById('btn-edit-course').addEventListener('click', () => {
    const c = courses.find(x => x.id === detailCourseId);
    closeModal('modal-detail');
    if (c) openEdit(c);
  });
  document.getElementById('btn-delete-course').addEventListener('click', async () => {
    const c = courses.find(x => x.id === detailCourseId);
    if (!c) return;
    if (!confirm(`确定删除课程「${c.name}」吗？`)) return;
    const { error } = await sb.from('courses').delete().eq('id', c.id);
    if (error) { showToast('删除失败：' + error.message); return; }
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
      if (editingCourseId) {
        ({ error } = await sb.from('courses').update(data).eq('id', editingCourseId));
      } else {
        ({ error } = await sb.from('courses').insert([{ ...data, semester_id: currentSemesterId }]));
      }
      if (error) throw error;
      closeModal('modal-edit');
      await loadCourses();
      renderAll();
      showToast(editingCourseId ? '已更新' : '已添加');
    } catch (err) {
      showToast('保存失败：' + err.message);
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
  if (!confirm(`确定删除学期「${s.name}」吗？该学期下的所有课程也会被删除。`)) return;
  const { error } = await sb.from('semesters').delete().eq('id', id);
  if (error) { showToast('删除失败：' + error.message); return; }
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
  if (currentSemesterId) await loadCourses();
  renderAll();

  if (!currentSemesterId) showToast('请先在「学期管理」中创建学期');
}

document.addEventListener('DOMContentLoaded', init);
