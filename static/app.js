/* Planner Application Logic (MVP)
 * Features implemented:
 * - Load tasks from /tasks (aliases underlying Firestore 'todos')
 * - Create unscheduled tasks (Inbox)
 * - Drag tasks into calendar to schedule (30m grid)
 * - Drag scheduled tasks back to inbox to unschedule
 * - Event dialog for editing title, duration, recurrence, delete, unschedule
 * - Week navigation (prev/next, today) & view modes (7d / 4d)
 * - Density selection (compact/cozy/relaxed) modifies slot height
 * - Search filter (tasks + scheduled events)
 * - Recurrence rendering (daily/weekly/custom with weekday list) up to 30 days ahead
 * - Simple overlap detection adds .conflict class (visual warning only for now)
 * - "Now" indicator line in current day column
 * Correctness strategy: Always reflect Firestore as source-of-truth;
 * writes use fetch, then local state updates minimally or a refetch on structural changes.
 */

// ------------------ State ------------------
const state = {
  tasks: [], // canonical tasks loaded from backend
  startOfWeek: startOfWeek(new Date()),
  viewMode: '7d',
  density: 'cozy',
  filter: '',
};

// API base (relative; FastAPI mounted at root)
const API = {
  async listTasks() {
    const res = await fetch('/tasks/');
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Failed to load tasks: ${res.status} ${txt}`);
    }
    return res.json();
  },
  async createTask(payload) {
    const res = await fetch('/tasks/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Failed to create task: ${res.status} ${txt}`);
    }
    return res.json();
  },
  async updateTask(id, payload) {
    const res = await fetch(`/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Failed to update task: ${res.status} ${txt}`);
    }
    return res.json();
  },
  async deleteTask(id) {
    const res = await fetch(`/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Failed to delete task: ${res.status} ${txt}`);
    }
  },
};

// ------------------ Date Utilities ------------------
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun .. 6 Sat
  // Choose Monday as start? We'll align to Monday for calendar readability.
  const diffToMonday = (day + 6) % 7; // Sun => 6, Mon => 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diffToMonday);
  return date;
}
function isoStringUTC(date) {
  // Convert a Date to an ISO string in UTC with 'Z' and without milliseconds.
  // Example: 2025-11-07T09:30Z
  const s = date.toISOString();
  return s.replace(/\.\d{3}Z$/, 'Z');
}
function parseISO(s) {
  if (!s) return null;
  // Accept both with/without seconds
  return new Date(s);
}

// ------------------ DOM References ------------------
const inboxListEl = document.getElementById('inboxList');
const addTaskForm = document.getElementById('addTaskForm');
const taskTitleInput = document.getElementById('taskTitle');
const taskDurationSelect = document.getElementById('taskDuration');
const inboxDropZone = document.getElementById('inboxDropZone');
const weekLabelEl = document.getElementById('weekLabel');
const prevWeekBtn = document.getElementById('prevWeek');
const nextWeekBtn = document.getElementById('nextWeek');
const todayBtn = document.getElementById('todayBtn');
const viewModeSelect = document.getElementById('viewMode');
const densitySelect = document.getElementById('density');
const searchInput = document.getElementById('searchInput');
const calendarHeaderEl = document.getElementById('calendarHeader');
const daysContainerEl = document.getElementById('daysContainer');
const timeGutterEl = document.getElementById('timeGutter');
const calendarBodyEl = document.getElementById('calendarBody');

// Dialog elements
const eventDialog = document.getElementById('eventDialog');
const eventTitleInput = document.getElementById('eventTitleInput');
const eventDurationInput = document.getElementById('eventDurationInput');
const eventRepeatSelect = document.getElementById('eventRepeatSelect');
const repeatDaysFieldset = document.getElementById('repeatDays');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const unscheduleBtn = document.getElementById('unscheduleBtn');

let dialogTask = null; // currently edited task
let nowIndicatorTimer = null;
let _resizeState = null; // {eventEl, taskId, startY, startHeight, slotHeight}

// ------------------ Rendering ------------------
function render() {
  renderWeekLabel();
  syncDensityVariable();
  renderInbox();
  renderCalendarSkeleton();
  renderScheduledEvents();
  ensureNowIndicator();
}

function renderWeekLabel() {
  const start = state.startOfWeek;
  const daysToShow = state.viewMode === '7d' ? 7 : 4;
  const end = new Date(start);
  end.setDate(end.getDate() + (daysToShow - 1));
  
  // Smart date formatting: show month only when needed
  const startMonth = start.getMonth();
  const endMonth = end.getMonth();
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  if (startMonth === endMonth && startYear === endYear) {
    // Same month: "Nov 3 – 9, 2024"
    weekLabelEl.textContent = `${monthNames[startMonth]} ${start.getDate()} – ${end.getDate()}, ${endYear}`;
  } else if (startYear === endYear) {
    // Different months, same year: "Oct 30 – Nov 5, 2024"
    weekLabelEl.textContent = `${monthNames[startMonth]} ${start.getDate()} – ${monthNames[endMonth]} ${end.getDate()}, ${endYear}`;
  } else {
    // Different years: "Dec 30, 2024 – Jan 5, 2025"
    weekLabelEl.textContent = `${monthNames[startMonth]} ${start.getDate()}, ${startYear} – ${monthNames[endMonth]} ${end.getDate()}, ${endYear}`;
  }
}

function filteredTasks() {
  if (!state.filter) return state.tasks;
  const q = state.filter.toLowerCase();
  return state.tasks.filter(t => (t.title || '').toLowerCase().includes(q));
}

function renderInbox() {
  inboxListEl.innerHTML = '';
  const unscheduled = filteredTasks().filter(t => !t.scheduledStart);
  if (!unscheduled.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No unscheduled tasks';
    inboxListEl.appendChild(li);
    return;
  }
  for (const t of unscheduled) {
    inboxListEl.appendChild(taskListItem(t));
  }
}

function taskListItem(task) {
  const li = document.createElement('li');
  li.className = 'task';
  // Left container (title + meta)
  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.gap = '4px';
  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = task.title;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = `${formatDuration(task.duration)}`;
  // Recurrence badge (if any)
  if (task.recurrence && task.recurrence.type && task.recurrence.type !== 'none') {
    const badge = document.createElement('span');
    badge.className = 'recurring-badge';
    badge.textContent = '↻ Recurring';
    badge.title = 'This task repeats';
    metaEl.appendChild(document.createTextNode(' • '));
    metaEl.appendChild(badge);
  }
  left.appendChild(titleEl);
  left.appendChild(metaEl);

  // Actions container (delete button)
  const actions = document.createElement('div');
  actions.className = 'actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn danger';
  deleteBtn.type = 'button';
  deleteBtn.innerHTML = `<span class="sr-only">Delete task</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14"/></svg>`;
  deleteBtn.addEventListener('click', () => {
    API.deleteTask(task.id)
      .then(() => refreshTasks())
      .catch(err => console.error(err));
  });
  actions.appendChild(deleteBtn);

  li.appendChild(left);
  li.appendChild(actions);
  li.draggable = true;
  li.dataset.id = task.id;
  li.title = `${task.title} • ${formatDuration(task.duration)}`;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    // Use a constrained drag image so the ghost matches calendar column width
    setConstrainedDragImage(e, li);
  });
  return li;
}

// Create a drag image constrained to approximate a calendar column width.
function setConstrainedDragImage(e, sourceEl) {
  try {
    // Determine target column width if available
    const dayCol = daysContainerEl && daysContainerEl.querySelector('.day-column');
    const targetWidth = dayCol ? Math.max(120, dayCol.clientWidth - 8) : Math.min(sourceEl.offsetWidth, 320);

    const clone = sourceEl.cloneNode(true);
    clone.style.width = `${targetWidth}px`;
    clone.style.boxSizing = 'border-box';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0';
    clone.style.transform = 'none';
    clone.style.opacity = '0.98';
    // Position offscreen but attached so setDragImage can capture it
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    document.body.appendChild(clone);
    // Use a small offset so cursor is near top-left of card
    e.dataTransfer.setDragImage(clone, 16, 16);
    // Remove clone after browser has had time to rasterize the drag image
    setTimeout(() => { try { clone.remove(); } catch (err) {} }, 0);
  } catch (err) {
    // ignore failures; fallback to default ghost
    console.warn('setConstrainedDragImage failed', err);
  }
}

function renderCalendarSkeleton() {
  // Build full 24-hour time gutter (we render the full day but scroll the
  // calendar to a default visible window). CSS expects .hour rows each equal
  // to 60m = 2 slots.
  timeGutterEl.innerHTML = '';
  for (let h = 0; h < 24; h++) {
    const div = document.createElement('div');
    div.className = 'hour';
    div.textContent = `${String(h).padStart(2, '0')}:00`;
    timeGutterEl.appendChild(div);
  }

  // Day headers
  calendarHeaderEl.innerHTML = '';
  daysContainerEl.innerHTML = '';
  const daysToShow = state.viewMode === '7d' ? 7 : 4;
  
  // Set CSS variable for dynamic column count
  document.documentElement.style.setProperty('--days-count', daysToShow);
  for (let d = 0; d < daysToShow; d++) {
    const date = new Date(state.startOfWeek);
    date.setDate(date.getDate() + d);
    const header = document.createElement('div');
    header.className = 'cell';
    const dow = document.createElement('div');
    dow.className = 'dow';
    dow.textContent = date.toLocaleDateString(undefined, { weekday: 'short' });
    const day = document.createElement('div');
    day.className = 'date';
    day.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    header.appendChild(dow);
    header.appendChild(day);
    calendarHeaderEl.appendChild(header);

    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.dayIndex = d;
    col.dataset.date = date.toISOString().split('T')[0];

    // Make column a drop target
    col.addEventListener('dragover', (e) => e.preventDefault());
    col.addEventListener('drop', (e) => onDropOnDayColumn(e, date));

    // Build slots for precise drop targeting for the full day (00:00 - 23:30)
    for (let h = 0; h < 24; h++) {
      for (let m of [0, 30]) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.time = `${String(h).padStart(2, '0')}:${m === 0 ? '00' : '30'}`;
        slot.addEventListener('dragover', (e) => {
          e.preventDefault();
          slot.classList.add('drop-target');
        });
        slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
        slot.addEventListener('drop', (e) => {
          slot.classList.remove('drop-target');
          onDropOnSlot(e, date, h, m);
        });
        col.appendChild(slot);
      }
    }
    daysContainerEl.appendChild(col);
  }
  
  // After building the full-day grid, set the default scroll position so the
  // visible viewport shows ~6:30am on cozy density. Users can still scroll to
  // see the rest of the day.
  const slotHeight = getSlotHeight();
  const cozyStartTop = ((6 * 60 + 30) / 30) * slotHeight; // pixels from top
  if (state.density === 'cozy' && calendarBodyEl) {
    // Slightly offset so 6:30 is near the top, but allow some header space.
    calendarBodyEl.scrollTop = cozyStartTop;
  }
}

function renderScheduledEvents() {
  // Remove old events
  daysContainerEl.querySelectorAll('.event').forEach(el => el.remove());
  daysContainerEl.querySelectorAll('.now-line').forEach(el => el.remove());

  const scheduled = filteredTasks().filter(t => t.scheduledStart);
  const instances = expandRecurrences(scheduled);

  // Build a map per day of events to check overlaps
  const eventsByDay = new Map();
  for (const inst of instances) {
    const start = parseISO(inst.scheduledStart);
    if (!start) continue;
    const key = start.toISOString().split('T')[0];
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(inst);
  }

  for (const [day, list] of eventsByDay.entries()) {
    // Sort by start time
    list.sort((a, b) => parseISO(a.scheduledStart) - parseISO(b.scheduledStart));
    // Overlap detection naive
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const aStart = parseISO(A.scheduledStart);
        const bStart = parseISO(B.scheduledStart);
        const aEnd = new Date(aStart.getTime() + A.duration * 60000);
        const bEnd = new Date(bStart.getTime() + B.duration * 60000);
        if (aStart < bEnd && bStart < aEnd) {
          A._conflict = true;
          B._conflict = true;
        }
      }
    }
  }

  // Render events
  for (const inst of instances) {
    const start = parseISO(inst.scheduledStart);
    if (!start) continue;
    const dayCol = daysContainerEl.querySelector(`.day-column[data-date="${start.toISOString().split('T')[0]}"]`);
    if (!dayCol) continue; // not in current view range
    dayCol.appendChild(renderEventBlock(inst));
  }
}

function renderEventBlock(task) {
  const start = parseISO(task.scheduledStart);
  const minutesFromMidnight = start.getHours() * 60 + start.getMinutes();
  const slotHeight = getSlotHeight(); // px per 30m
  
  // Position relative to midnight; the grid renders full 24 hours so this is absolute
  const top = (minutesFromMidnight / 30) * slotHeight;
  const height = (task.duration / 30) * slotHeight;

  const div = document.createElement('div');
  div.className = 'event';
  div.style.top = `${top}px`;
  div.style.height = `${height}px`;
  div.dataset.id = task.id;
  div.title = `${task.title} • ${formatDuration(task.duration)}`;
  // Assign dynamic color gradient similar to reference (hash + ordering spread)
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const baseHue = extractHue(accent);
  // Derive hue from id for stability, then blend with baseHue
  const idHue = hashHue(task.id);
  const hue = (baseHue + idHue) % 360;
  const color = `hsl(${hue} 85% 65%)`;
  div.style.background = `linear-gradient(180deg, ${color}cc, ${color})`;
  div.style.borderColor = color;

  // Compact class for short events
  if ((task.duration || 60) <= 45 || height < 44) div.classList.add('compact');
  if (task.recurrence && task.recurrence.type && task._isRecurrenceInstance) div.classList.add('recurring');
  if (task._conflict) div.classList.add('conflict');

  // Event content
  const titleEl = document.createElement('div');
  titleEl.className = 'event-title';
  titleEl.textContent = task.title;
  div.appendChild(titleEl);
  const timeEl = document.createElement('div');
  timeEl.className = 'event-time';
  const endTime = new Date(start.getTime() + (task.duration || 60) * 60000);
  timeEl.innerHTML = `${formatHM(start)} · ${formatDuration(task.duration || 60)}` + (task.recurrence && !task._isRecurrenceInstance ? ' <span class="recurring-badge-inline">↻</span>' : '');
  if (!div.classList.contains('compact')) div.appendChild(timeEl);

  // Resize handle (only primary occurrences, not generated recurrences)
  if (!task._isRecurrenceInstance) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    div.appendChild(handle);
    // Pointer-based resizing (drag bottom edge to change duration)
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Initialize resize state
      const eventEl = ev.currentTarget.closest('.event');
      if (!eventEl) return;
      // Capture pointer to continue receiving events even if pointer moves out
      eventEl.setPointerCapture(ev.pointerId);
      const slotH = getSlotHeight();
      _resizeState = {
        eventEl,
        taskId: task.id,
        startY: ev.clientY,
        startHeight: eventEl.offsetHeight,
        slotHeight: slotH,
        pointerId: ev.pointerId,
      };
      // mark as actively resizing to prevent click/openDialog
      eventEl.dataset.resizing = '1';
      // Temporarily disable native dragging while resizing
      eventEl.draggable = false;
      document.addEventListener('pointermove', _onPointerMove);
      document.addEventListener('pointerup', _onPointerUp);
    });
  }

  div.draggable = true;
  div.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    // Constrain the drag ghost for events as well so it matches column width
    setConstrainedDragImage(e, div);
  });
  div.addEventListener('click', (e) => {
    // If the event was just resized, ignore the click that may follow the pointerup
    if (div.dataset.recentlyResized === '1') {
      // consume and clear the flag
      div.dataset.recentlyResized = '0';
      return;
    }
    openDialog(task);
  });
  return div;
}

// Helper: hash id to hue
function hashHue(id) {
  let h = 0;
  for (const ch of id) {
    h = (h * 31 + ch.charCodeAt(0)) % 360;
  }
  return h;
}

function _onPointerMove(e) {
  if (!_resizeState) return;
  if (e.pointerId !== _resizeState.pointerId) return;
  e.preventDefault();
  const dy = e.clientY - _resizeState.startY;
  const newHeight = Math.max(30, _resizeState.startHeight + dy);
  const halfHourPx = _resizeState.slotHeight;
  // Snap to nearest half-hour
  let halfSlots = Math.max(1, Math.round(newHeight / halfHourPx));
  const snapped = halfSlots * halfHourPx;
  _resizeState.eventEl.style.height = `${snapped}px`;
  // store current halfSlots for up handler
  _resizeState.currentHalfSlots = halfSlots;
}

function _onPointerUp(e) {
  if (!_resizeState) return;
  if (e.pointerId !== _resizeState.pointerId) return;
  // finalize
  const rs = _resizeState; // rename to avoid shadowing global `state`
  document.removeEventListener('pointermove', _onPointerMove);
  document.removeEventListener('pointerup', _onPointerUp);
  try { rs.eventEl.releasePointerCapture(rs.pointerId); } catch (err) {}
  // compute new duration in minutes
  const halfSlots = rs.currentHalfSlots || Math.round(rs.startHeight / rs.slotHeight);
  const newDuration = halfSlots * 30;
  // re-enable dragging
  rs.eventEl.draggable = true;
  // clear resizing marker and set a short-lived recentlyResized flag so click handlers
  // can ignore the click that follows the pointerup
  if (rs.eventEl) {
    delete rs.eventEl.dataset.resizing;
    rs.eventEl.dataset.recentlyResized = '1';
    setTimeout(() => { if (rs.eventEl) rs.eventEl.dataset.recentlyResized = '0'; }, 300);
  }
  _resizeState = null;
  // Persist update if changed
  const taskId = rs.taskId;
  if (newDuration && typeof taskId !== 'undefined') {
    // API requires a title in the payload; include existing task fields to
    // avoid 422 Unprocessable Entity errors. Also include scheduledStart and
    // recurrence if present so the update is non-destructive.
    const existing = state.tasks.find(t => t.id === taskId) || {};
    const payload = { title: existing.title || 'Untitled', duration: newDuration };
    if (existing.scheduledStart) payload.scheduledStart = existing.scheduledStart;
    if (existing.recurrence) payload.recurrence = existing.recurrence;

    // Consistency policy: do NOT apply the final change locally until the
    // server confirms success. We'll revert the visual preview back to the
    // original size, show a transient "updating" state, then refresh the
    // authoritative state on success. If the update fails, nothing changes
    // (or the UI is refreshed from server state) — ensuring all-or-nothing.
    const eventEl = rs.eventEl;
    const originalHeight = rs.startHeight;

    // Re-enable dragging and clear resizing marker/click-guard already done
    // above. Mark as updating so styles can indicate pending network activity.
    try { eventEl.releasePointerCapture(rs.pointerId); } catch (err) {}
    eventEl.draggable = true;
    eventEl.dataset.updating = '1';
    eventEl.classList.add('updating');

    // Revert visual preview to original height until server confirms
    eventEl.style.height = `${originalHeight}px`;

    // Before calling the API, ensure the new duration won't cause conflicts
    const existingTask = state.tasks.find(t => t.id === taskId) || {};
    const candidate = { ...existingTask, duration: newDuration };
    // Enforce duration cap
    if (newDuration > 180) {
      if (eventEl) {
        delete eventEl.dataset.updating;
        eventEl.classList.remove('updating');
      }
      window.alert('Maximum allowed duration is 3 hours (180 minutes). Resize cancelled.');
      return refreshTasks();
    }
    const conflict = detectConflictForCandidate(candidate, taskId);
    if (conflict.conflict) {
      // Do not persist; refresh to authoritative state and inform user
      if (eventEl) {
        delete eventEl.dataset.updating;
        eventEl.classList.remove('updating');
      }
      window.alert(`Cannot resize "${existingTask.title || 'event'}" — the new duration conflicts with "${conflict.existing.title}" at ${formatHM(parseISO(conflict.existing.scheduledStart))}.`);
      return refreshTasks();
    }

    API.updateTask(taskId, payload)
      .then(updated => {
        // Server succeeded: merge and refresh authoritative data (will
        // re-render recurrence instances with the new duration)
        mergeTask(updated);
        return refreshTasks();
      })
      .catch(err => {
        // Update failed: log and refresh to ensure UI shows server state
        console.error('Failed to update task:', err);
        return refreshTasks();
      })
      .finally(() => {
        // Clear updating indicator
        if (eventEl) {
          delete eventEl.dataset.updating;
          eventEl.classList.remove('updating');
        }
      });
  }
}

// Helper: extract hue from CSS accent (attempt HSL, fallback to 210)
function extractHue(color) {
  const hsl = color.match(/hsl\((\d+)/);
  if (hsl) return parseInt(hsl[1], 10);
  if (color.startsWith('#')) {
    // Simple hex to hue approximation
    const hex = color.replace('#', '');
    const bigint = parseInt(hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    // Convert to HSL hue
    const nr = r/255, ng = g/255, nb = b/255;
    const max = Math.max(nr,ng,nb), min = Math.min(nr,ng,nb);
    if (max === min) return 0;
    let h;
    const d = max - min;
    switch(max){
      case nr: h = (ng-nb)/d + (ng<nb?6:0); break;
      case ng: h = (nb-nr)/d + 2; break;
      default: h = (nr-ng)/d + 4; break;
    }
    return Math.round(h*60);
  }
  return 210;
}

function formatHM(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Human-friendly duration formatter. Examples:
//   45 -> "45m"
//   90 -> "1h 30m"
//   120 -> "2h"
//   1500 -> "1d 1h"
function formatDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '';
  const mins = Math.max(0, Math.floor(Number(minutes)));
  const days = Math.floor(mins / 1440);
  let rem = mins % 1440;
  const hours = Math.floor(rem / 60);
  const leftover = rem % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (leftover) parts.push(`${leftover}m`);
  if (parts.length === 0) return '0m';
  return parts.join(' ');
}

function getSlotHeight() {
  // Adaptive slot height. For compact density, compute a slot height that
  // allows the full 24-hour day (48 half-hour slots) to fit within the
  // calendar body's visible height when possible. Clamp to sensible limits
  // to avoid unreadably small or large slots.
  if (state.density === 'compact') {
    if (typeof calendarBodyEl !== 'undefined' && calendarBodyEl && calendarBodyEl.clientHeight) {
      const available = calendarBodyEl.clientHeight;
      // 48 half-hour slots
      const computed = Math.floor(available / 48);
      // Clamp between 10 and 18 px per 30m slot (compact but usable)
      return Math.max(10, Math.min(18, computed));
    }
    // Fallback if element not available yet
    return 14;
  }
  if (state.density === 'relaxed') return 28;
  // cozy
  return 24;
}

function syncDensityVariable() {
  // Keep CSS driven layout in sync with JS calculations
  const root = document.documentElement;
  root.style.setProperty('--slot-30', `${getSlotHeight()}px`);
}

// Expand recurrence instances (front-end only virtual occurrences)
function expandRecurrences(tasks) {
  const out = [];
  const horizonDays = 30; // generate up to 30 days into future
  const today = new Date(state.startOfWeek); // anchor horizon starting from current visible week start
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  for (const t of tasks) {
    if (!t.recurrence || t.recurrence.type === 'none') {
      out.push({ ...t });
      continue;
    }
    const anchor = parseISO(t.scheduledStart);
    if (!anchor) continue;
    const type = t.recurrence.type;
    const daysList = Array.isArray(t.recurrence.days) ? t.recurrence.days : [];
    for (let d = 0; d <= horizonDays; d++) {
      const instDate = new Date(anchor);
      instDate.setDate(instDate.getDate() + d);
      if (instDate < today || instDate > horizonEnd) continue;
      const weekday = instDate.getDay();
      let include = false;
    if (type === 'daily') include = true;
    else if (type === 'weekly') include = d % 7 === 0; // every 7 days
    else if (type === 'weekdays') include = weekday >= 1 && weekday <= 5; // Mon-Fri
    else if (type === 'weekends') include = weekday === 0 || weekday === 6; // Sun/Sat
    else if (type === 'custom') include = daysList.includes(weekday);
      if (!include) continue;
        const scheduledStart = isoStringUTC(instDate);
      out.push({ ...t, scheduledStart, _isRecurrenceInstance: d !== 0 });
    }
  }
  return out;
}

// ------------------ Conflict Detection ------------------
// Check whether scheduling/updating a task (including recurrence instances)
// would introduce any overlap with existing scheduled instances.
function detectConflictForCandidate(candidateTask, excludeTaskId) {
  // Build existing scheduled instances excluding the task being updated
  const existingTasks = state.tasks.filter(t => t.scheduledStart && t.id !== excludeTaskId);
  const existingInstances = expandRecurrences(existingTasks);

  // Build candidate instances (handles both single and recurring tasks)
  const candidateInstances = expandRecurrences([candidateTask]);

  for (const cand of candidateInstances) {
    const cStart = parseISO(cand.scheduledStart);
    if (!cStart) continue;
    const cEnd = new Date(cStart.getTime() + (cand.duration || 0) * 60000);
    for (const ex of existingInstances) {
      const eStart = parseISO(ex.scheduledStart);
      if (!eStart) continue;
      const eEnd = new Date(eStart.getTime() + (ex.duration || 0) * 60000);
      if (cStart < eEnd && eStart < cEnd) {
        return { conflict: true, candidate: cand, existing: ex };
      }
    }
  }
  return { conflict: false };
}

// ------------------ Drag & Drop Handlers ------------------
function onDropOnDayColumn(e, date) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  // Drop without slot => snap to nearest half-hour of current time
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top; // px from top
  const slotHeight = getSlotHeight();
  const halfHours = Math.max(0, Math.round(y / slotHeight));
  const minutes = halfHours * 30;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const startDate = new Date(date);
  startDate.setHours(hours, mins, 0, 0);
  scheduleTask(task, startDate);
}

function onDropOnSlot(e, date, hour, minute) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const startDate = new Date(date);
  startDate.setHours(hour, minute, 0, 0);
  scheduleTask(task, startDate);
}

function scheduleTask(task, startDate) {
  if ((task.duration || 0) > 180) {
    window.alert('Cannot schedule events longer than 3 hours. Please shorten the task duration first.');
    return;
  }
  const payload = { title: task.title, duration: task.duration, scheduledStart: isoStringUTC(startDate) };
  const candidate = { ...task, ...payload };
  const conflict = detectConflictForCandidate(candidate, task.id);
  if (conflict.conflict) {
    // Show user-visible error and do not schedule
    window.alert(`Cannot schedule "${task.title}" — it conflicts with "${conflict.existing.title}" at ${formatHM(parseISO(conflict.existing.scheduledStart))}.`);
    return;
  }

  API.updateTask(task.id, payload)
    .then(updated => {
      // Update local state without full refetch for responsiveness; then refetch for authoritative merge.
      mergeTask(updated);
      return refreshTasks();
    })
    .catch(err => {
      console.error(err);
      // surface minimal UI feedback
      window.alert('Failed to schedule event. Please try again.');
    });
}

function unscheduleTask(task) {
  API.updateTask(task.id, { 
    title: task.title, 
    duration: task.duration, 
    scheduledStart: null 
  })
    .then(updated => {
      mergeTask(updated);
      return refreshTasks();
    })
    .catch(err => console.error(err));
}

// Inbox drop zone unscheduling
inboxDropZone.addEventListener('dragover', (e) => e.preventDefault());
inboxDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  const task = state.tasks.find(t => t.id === id);
  if (!task || !task.scheduledStart) return;
  unscheduleTask(task);
});

// ------------------ Dialog ------------------
function openDialog(task) {
  dialogTask = task;
  eventTitleInput.value = task.title || '';
  eventDurationInput.value = String(task.duration || 60);
  const recurrenceType = task.recurrence?.type || 'none';
  eventRepeatSelect.value = recurrenceType;
  updateRepeatDaysVisibility();
  // Populate custom days
  repeatDaysFieldset.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = (task.recurrence?.days || []).includes(Number(cb.value));
  });
  // Show/hide unschedule button based on scheduling status
  if (task.scheduledStart) {
    unscheduleBtn.style.display = '';
  } else {
    unscheduleBtn.style.display = 'none';
  }
  // Always show delete button
  deleteBtn.style.display = '';
  if (!eventDialog.open) eventDialog.showModal();
}

function closeDialog() {
  dialogTask = null;
  if (eventDialog.open) eventDialog.close();
}

eventRepeatSelect.addEventListener('change', updateRepeatDaysVisibility);
function updateRepeatDaysVisibility() {
  const type = eventRepeatSelect.value;
  const show = type === 'custom';
  repeatDaysFieldset.style.display = show ? '' : 'none';
  repeatDaysFieldset.setAttribute('aria-hidden', show ? 'false' : 'true');
}

saveBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!dialogTask) return closeDialog();
  const title = eventTitleInput.value.trim();
  const duration = Number(eventDurationInput.value);
  const type = eventRepeatSelect.value;
  let recurrence = { type };
  if (type === 'custom') {
    const days = Array.from(repeatDaysFieldset.querySelectorAll('input[type=checkbox]'))
      .filter(cb => cb.checked)
      .map(cb => Number(cb.value));
    recurrence.days = days;
  }
  if (type === 'none') recurrence = null;
  // Enforce duration cap
  if (duration > 180) {
    window.alert('Maximum allowed duration is 3 hours (180 minutes). Please choose a shorter duration.');
    return; // keep dialog open
  }

  // Before persisting recurrence/duration changes, ensure we won't
  // introduce scheduling conflicts for any resulting instances.
  const candidate = { ...dialogTask, title, duration, recurrence };
  const conflict = detectConflictForCandidate(candidate, dialogTask.id);
  if (conflict.conflict) {
    window.alert(`Cannot apply changes — the recurrence or duration would conflict with "${conflict.existing.title}" at ${formatHM(parseISO(conflict.existing.scheduledStart))}.`);
    return; // keep dialog open so user can adjust
  }

  API.updateTask(dialogTask.id, { title, duration, recurrence })
    .then(updated => {
      mergeTask(updated);
      return refreshTasks();
    })
    .finally(closeDialog)
    .catch(err => {
      console.error(err);
      window.alert('Failed to save event changes. Please try again.');
    });
});

unscheduleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!dialogTask) return closeDialog();
  unscheduleTask(dialogTask);
  closeDialog();
});

deleteBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!dialogTask) return closeDialog();
  API.deleteTask(dialogTask.id)
    .then(() => refreshTasks())
    .finally(closeDialog)
    .catch(err => console.error(err));
});

// Close dialog if backdrop clicked
eventDialog.addEventListener('click', (e) => {
  const rect = eventDialog.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
    closeDialog();
  }
});

// ------------------ Event Listeners (Global UI) ------------------
addTaskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = taskTitleInput.value.trim();
  if (!title) return;
  let duration = Number(taskDurationSelect.value);
  if (isNaN(duration) || duration < 1) duration = 60;
  if (duration > 180) {
    window.alert('Maximum allowed duration is 3 hours (180 minutes). The duration will be set to 180 minutes.');
    duration = 180;
  }
  API.createTask({ title, duration })
    .then(() => refreshTasks())
    .catch(err => console.error(err));
  addTaskForm.reset();
});

prevWeekBtn.addEventListener('click', () => {
  state.startOfWeek.setDate(state.startOfWeek.getDate() - 7);
  render();
});
nextWeekBtn.addEventListener('click', () => {
  state.startOfWeek.setDate(state.startOfWeek.getDate() + 7);
  render();
});
todayBtn.addEventListener('click', () => {
  state.startOfWeek = startOfWeek(new Date());
  render();
});
viewModeSelect.addEventListener('change', () => {
  state.viewMode = viewModeSelect.value;
  render();
});
densitySelect.addEventListener('change', () => {
  state.density = densitySelect.value;
  // Rerender events for new sizing
  render();
});
searchInput.addEventListener('input', () => {
  state.filter = searchInput.value.trim();
  render();
});

// ------------------ Now Indicator ------------------
function ensureNowIndicator() {
  if (nowIndicatorTimer) clearTimeout(nowIndicatorTimer);
  drawNowIndicator();
  // Update every minute
  nowIndicatorTimer = setTimeout(ensureNowIndicator, 60000);
}

function drawNowIndicator() {
  // Remove existing
  daysContainerEl.querySelectorAll('.now-line').forEach(el => el.remove());
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];
  const dayCol = daysContainerEl.querySelector(`.day-column[data-date="${dateKey}"]`);
  if (!dayCol) return; // not visible in current view
  const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
  const slotHeight = getSlotHeight();
  // Absolute position in the full-day grid
  const top = (minutesFromMidnight / 30) * slotHeight;
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = `${top}px`;
  dayCol.appendChild(line);
}

// ------------------ State Helpers ------------------
function mergeTask(updated) {
  const idx = state.tasks.findIndex(t => t.id === updated.id);
  if (idx >= 0) {
    state.tasks[idx] = { ...state.tasks[idx], ...updated };
  } else {
    state.tasks.push(updated);
  }
  render();
}

function refreshTasks() {
  return API.listTasks().then(tasks => {
    state.tasks = tasks;
    render();
  }).catch(err => {
    console.error(err);
    // Minimal UI signal
    weekLabelEl.textContent = 'Error loading tasks';
  });
}

// ------------------ Init ------------------
refreshTasks();

// ============================================
// KEYBOARD SHORTCUTS (Google Calendar-style)
// ============================================
let shortcutsModalOpen = false;

function createShortcutsModal() {
  const modal = document.createElement('div');
  modal.className = 'shortcuts-modal';
  modal.id = 'shortcutsModal';
  modal.innerHTML = `
    <div class="shortcuts-help">
      <h3>Keyboard Shortcuts</h3>
      
      <div class="shortcut-category">
        <h4>Navigation</h4>
        <dl>
          <dt><kbd>J</kbd> or <kbd>←</kbd></dt>
          <dd>Previous week</dd>
          <dt><kbd>K</kbd> or <kbd>→</kbd></dt>
          <dd>Next week</dd>
          <dt><kbd>T</kbd></dt>
          <dd>Go to today</dd>
        </dl>
      </div>
      
      <div class="shortcut-category">
        <h4>View & Layout</h4>
        <dl>
          <dt><kbd>1</kbd></dt>
          <dd>4-day view</dd>
          <dt><kbd>2</kbd></dt>
          <dd>Week view</dd>
          <dt><kbd>D</kbd></dt>
          <dd>Cycle density</dd>
        </dl>
      </div>
      
      <div class="shortcut-category">
        <h4>Actions</h4>
        <dl>
          <dt><kbd>C</kbd> or <kbd>N</kbd></dt>
          <dd>New task (focus input)</dd>
          <dt><kbd>/</kbd></dt>
          <dd>Search/filter</dd>
          <dt><kbd>R</kbd></dt>
          <dd>Refresh</dd>
          <dt><kbd>Esc</kbd></dt>
          <dd>Close dialogs</dd>
        </dl>
      </div>
      
      <p class="muted small">Press <kbd>?</kbd> to toggle this help</p>
    </div>
  `;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeShortcutsModal();
    }
  });
  
  return modal;
}

function showShortcutsModal() {
  if (shortcutsModalOpen) return;
  const modal = createShortcutsModal();
  document.body.appendChild(modal);
  shortcutsModalOpen = true;
}

function closeShortcutsModal() {
  const modal = document.getElementById('shortcutsModal');
  if (modal) {
    modal.remove();
    shortcutsModalOpen = false;
  }
}

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  // Close dialog with ESC
  if (e.key === 'Escape') {
    if (eventDialog.open) {
      closeDialog();
      return;
    }
    if (shortcutsModalOpen) {
      closeShortcutsModal();
      return;
    }
    // Blur search input
    if (document.activeElement === searchInput) {
      searchInput.blur();
      return;
    }
    // Blur task title input
    if (document.activeElement === taskTitleInput) {
      taskTitleInput.blur();
      return;
    }
  }
  
  // Don't handle shortcuts when typing in input fields (except for specific ones)
  const inInput = document.activeElement && (
    document.activeElement.tagName === 'INPUT' ||
    document.activeElement.tagName === 'TEXTAREA' ||
    document.activeElement.tagName === 'SELECT'
  );
  
  // Allow '/' and '?' even when not in input
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    searchInput.focus();
    return;
  }
  
  if (e.key === '?' && !inInput) {
    e.preventDefault();
    if (shortcutsModalOpen) {
      closeShortcutsModal();
    } else {
      showShortcutsModal();
    }
    return;
  }
  
  // Skip other shortcuts when in input fields
  if (inInput && !((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
    return;
  }
  
  // Submit form with Cmd/Ctrl+Enter
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (document.activeElement === taskTitleInput && taskTitleInput.value.trim()) {
      addTaskForm.requestSubmit();
      e.preventDefault();
    }
    return;
  }
  
  // Navigation shortcuts
  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
    e.preventDefault();
    prevWeekBtn.click();
    return;
  }
  
  if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowRight') {
    e.preventDefault();
    nextWeekBtn.click();
    return;
  }
  
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    todayBtn.click();
    return;
  }
  
  // View shortcuts
  if (e.key === '1') {
    e.preventDefault();
    viewModeSelect.value = '4d';
    viewModeSelect.dispatchEvent(new Event('change'));
    return;
  }
  
  if (e.key === '2') {
    e.preventDefault();
    viewModeSelect.value = '7d';
    viewModeSelect.dispatchEvent(new Event('change'));
    return;
  }
  
  // Density cycle
  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    const densities = ['compact', 'cozy', 'relaxed'];
    const currentIndex = densities.indexOf(state.density);
    const nextIndex = (currentIndex + 1) % densities.length;
    densitySelect.value = densities[nextIndex];
    densitySelect.dispatchEvent(new Event('change'));
    return;
  }
  
  // Create new task
  if (e.key === 'c' || e.key === 'C' || e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    taskTitleInput.focus();
    return;
  }
  
  // Refresh
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    refreshTasks();
    return;
  }
});

// Expose for debugging
window.__plannerState = state;
