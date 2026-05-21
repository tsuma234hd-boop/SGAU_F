
    const API_BASE = window.location.origin;

    function normalizeRole(roleValue) {
      const role = (roleValue || '').toString().trim().toLowerCase();
      const aliases = {
        administrador: 'admin',
        administrator: 'admin',
        teacher: 'docente',
        student: 'estudiante',
      };
      return aliases[role] || role || null;
    }

    function decodeJwtPayload(token) {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length < 2) return null;
      try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        return JSON.parse(atob(padded));
      } catch (e) {
        return null;
      }
    }

    let TOKEN = localStorage.getItem('token') || null;
    let USER_ROLE = normalizeRole(localStorage.getItem('user_role'));
    let USER_EMAIL = localStorage.getItem('user_email') || null;
    let MY_STUDENT = null;
    let MY_TEACHER = null;
    let PROFILE_TARGET_STUDENT_ID = null;
    let ADMIN_PROFILE_MODE = 'self';
    let ASSIGNMENT_EDITING_ID = null;
    let TEACHERS = [];
    let COURSES = [];
    let ASSIGNMENTS = [];
    let ACADEMIC_CAREERS = [];
    let ALL_ACADEMIC_COURSES = [];
    const COURSE_CACHE = new Map();
    const COURSE_TEACHERS_CACHE = new Map();

    const WEEKDAYS_ES = ["Domingo", "Lunes", "Martes", "MiÃ©rcoles", "Jueves", "Viernes", "SÃ¡bado"];

    function syncSessionState() {
      TOKEN = localStorage.getItem('token') || null;
      const storedRole = normalizeRole(localStorage.getItem('user_role'));
      const tokenPayload = decodeJwtPayload(TOKEN);
      USER_ROLE = normalizeRole(tokenPayload?.role) || storedRole;
      USER_EMAIL = localStorage.getItem('user_email') || tokenPayload?.sub || null;
      if (USER_ROLE) {
        localStorage.setItem('user_role', USER_ROLE);
      }
      if (USER_EMAIL) {
        localStorage.setItem('user_email', USER_EMAIL);
      }
    }

    function toMinutes(timeValue) {
      if (!timeValue || !timeValue.includes(':')) return null;
      const [h, m] = timeValue.split(':');
      return Number(h) * 60 + Number(m);
    }

    function fromMinutes(totalMinutes) {
      const normalized = ((totalMinutes % 1440) + 1440) % 1440;
      const h = String(Math.floor(normalized / 60)).padStart(2, '0');
      const m = String(normalized % 60).padStart(2, '0');
      return `${h}:${m}`;
    }

    function buildClassrooms() {
      const ranges = [[200, 220], [300, 320], [400, 420], [500, 520]];
      const rooms = [];
      ranges.forEach(([start, end]) => {
        for (let room = start; room <= end; room += 1) {
          rooms.push(String(room));
        }
      });
      return rooms;
    }

    function toRomanSemester(value) {
      const numerals = {
        1: 'I',
        2: 'II',
        3: 'III',
        4: 'IV',
        5: 'V',
        6: 'VI',
        7: 'VII',
        8: 'VIII',
        9: 'IX',
        10: 'X',
      };
      return numerals[value] || String(value || 'Sin semestre');
    }

    function renderCourseRowsBySemester(courses) {
      let currentSemester = null;
      const rows = [];

      courses.forEach(c => {
        const semester = c.semester || 'Sin semestre';
        if (semester !== currentSemester) {
          currentSemester = semester;
          rows.push(`
            <tr class="semester-divider">
              <td colspan="9">Semestre ${toRomanSemester(c.semester)}${c.semester ? ` Â· Nivel ${c.semester}` : ''}</td>
            </tr>
          `);
        }

        const prerequisiteCodes = Array.isArray(c.prerequisite_codes) && c.prerequisite_codes.length
          ? c.prerequisite_codes.join(', ')
          : 'â€”';

        const cupoLabel = c.max_students
          ? `<span style="font-size:.75rem;background:var(--accent2);color:#fff;border-radius:4px;padding:1px 6px;">${c.max_students}</span>`
          : '<span style="opacity:.45;font-size:.75rem;">Sin lÃ­mite</span>';

        rows.push(`
          <tr>
            <td><code style="font-size: .7rem;">${c.id}</code></td>
            <td>${c.code || 'â€”'}</td>
            <td>${c.name}</td>
            <td>${c.semester || 'â€”'}</td>
            <td>${c.credits || 'â€”'}</td>
            <td><div class="prereq-list">${prerequisiteCodes}</div></td>
            <td>${ACADEMIC_CAREERS.find(x => x.id === c.career_id)?.name || c.career_id || 'â€”'}</td>
            <td>${c.schedule || 'â€”'}</td>
            <td>${cupoLabel}</td>
          </tr>
        `);
      });

      return rows.join('');
    }

    function populateClassroomSelect() {
      const select = document.getElementById('course-location');
      if (!select) return;
      const options = buildClassrooms().map(room => `<option value="${room}">${room}</option>`).join('');
      select.innerHTML = options;
    }

    function getAuthHeaders() {
      syncSessionState();
      return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
    }

    // Interceptor global: cerrar sesiÃ³n solo cuando el backend indique token invÃ¡lido/expirado.
    const _originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await _originalFetch(...args);
      if (response.status === 401) {
        // Clonar para no consumir el body
        const clone = response.clone();
        const body = await clone.json().catch(() => ({}));
        const detail = String(body?.detail || '').toLowerCase();
        // Solo redirigir si el 401 viene de un endpoint protegido (no del login)
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
        const isTokenIssue =
          detail.includes('token') ||
          detail.includes('jwt') ||
          detail.includes('expirado') ||
          detail.includes('expired') ||
          detail.includes('firma') ||
          detail.includes('signature');

        if (!isAuthEndpoint && isTokenIssue) {
          localStorage.removeItem('token');
          localStorage.removeItem('user_role');
          showToast('âš  SesiÃ³n expirada. Por favor inicia sesiÃ³n de nuevo.', 'err');
          setTimeout(() => { window.location.href = '/'; }, 2000);
        }
      }
      return response;
    };

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // COMUNICACIONES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    async function initAnnTeacherCourses() {
      const sel = document.getElementById('ann-teacher-course');
      if (!sel) return;
      if (sel.options.length > 1) { loadTeacherAnnouncements(); return; }
      try {
        const r = await fetch(`${API_BASE}/academic/api/courses/`, { headers: getAuthHeaders() });
        const courses = await r.json();
        sel.innerHTML = '<option value="">â€” Selecciona un curso â€”</option>';
        courses.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.code || ''} ${c.name}`.trim();
          sel.appendChild(opt);
        });
        if (courses.length > 0) { sel.value = courses[0].id; loadTeacherAnnouncements(); }
      } catch(e) { console.error('Error cargando cursos docente (comunicaciones):', e); }
    }

    async function loadTeacherAnnouncements() {
      const courseId = document.getElementById('ann-teacher-course')?.value;
      const container = document.getElementById('ann-teacher-list');
      if (!container) return;
      if (!courseId) { container.innerHTML = '<p style="color:var(--muted)">Selecciona un curso.</p>'; return; }
      container.innerHTML = '<p style="color:var(--muted)">Cargandoâ€¦</p>';
      try {
        const r = await fetch(`${API_BASE}/grades/announcements?course_id=${courseId}`, { headers: getAuthHeaders() });
        const anns = await r.json();
        if (!anns.length) { container.innerHTML = '<p style="color:var(--muted)">No hay anuncios para este curso.</p>'; return; }
        container.innerHTML = anns.map(a => `
          <div style="background:linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,102,241,0.05) 100%);border:2px solid rgba(59,130,246,0.25);border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 2px 8px rgba(29,78,216,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
              <div style="flex:1;">
                ${a.pinned ? '<span style="background:rgba(29,78,216,0.15);color:var(--accent);font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:4px;display:inline-block;margin-bottom:.5rem;">ðŸ“Œ FIJADO</span><br>' : ''}
                <strong style="font-size:1.05rem;color:var(--text);">${escapeHtml(a.title)}</strong>
                <div style="font-size:.75rem;color:var(--muted);margin-top:.35rem;">ðŸ“… ${new Date(a.created_at).toLocaleString('es-CO')}</div>
              </div>
              <button class="btn btn-secondary btn-sm" style="color:var(--danger);border-color:var(--danger);white-space:nowrap;" onclick="deleteAnnouncement(${a.id})">Eliminar</button>
            </div>
            <p style="margin:.75rem 0 0;white-space:pre-wrap;color:var(--text);line-height:1.6;">${escapeHtml(a.body)}</p>
          </div>`).join('');
      } catch(e) { container.innerHTML = '<p style="color:var(--danger)">Error al cargar anuncios.</p>'; }
    }

    function openAnnouncementModal() {
      const courseId = document.getElementById('ann-teacher-course')?.value;
      if (!courseId) { alert('Selecciona un curso primero.'); return; }
      document.getElementById('ann-title').value = '';
      document.getElementById('ann-body').value = '';
      document.getElementById('ann-pinned').checked = false;
      document.getElementById('modal-create-ann').style.display = 'flex';
    }

    async function createAnnouncement() {
      const courseId = parseInt(document.getElementById('ann-teacher-course')?.value);
      const title = document.getElementById('ann-title').value.trim();
      const body = document.getElementById('ann-body').value.trim();
      const pinned = document.getElementById('ann-pinned').checked;
      if (!title || !body) { alert('El tÃ­tulo y el mensaje son obligatorios.'); return; }
      try {
        const r = await fetch(`${API_BASE}/grades/announcements`, {
          method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ course_id: courseId, title, body, pinned }),
        });
        if (!r.ok) { const e = await r.json(); alert(e.detail || 'Error al publicar el anuncio'); return; }
        document.getElementById('modal-create-ann').style.display = 'none';
        loadTeacherAnnouncements();
      } catch(e) { alert('Error de conexiÃ³n al publicar el anuncio.'); }
    }

    async function deleteAnnouncement(annId) {
      if (!confirm('Â¿Eliminar este anuncio?')) return;
      try {
        const r = await fetch(`${API_BASE}/grades/announcements/${annId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) { const e = await r.json(); alert(e.detail || 'Error al eliminar'); return; }
        loadTeacherAnnouncements();
      } catch(e) { alert('Error de conexiÃ³n al eliminar.'); }
    }

    function isCurrentEnrollmentStatus(status) {
      const normalized = String(status || '').trim().toLowerCase();
      return normalized === 'activa' || normalized === 'active' || normalized === 'pendiente';
    }

    function normalizeStudentCourses(payload) {
      const rawCourses = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.courses)
          ? payload.courses
          : [];

      return rawCourses
        .filter(c => !c.enrollment_status || isCurrentEnrollmentStatus(c.enrollment_status))
        .map(c => ({
          id: c.course_id ?? c.id,
          code: c.course_code || c.code || '',
          name: c.course_name || c.name || '',
          day_of_week: c.day_of_week,
          start_time: c.start_time,
          end_time: c.end_time,
          location: c.location,
          schedule: c.schedule,
          enrollment_status: c.enrollment_status || 'activa',
        }))
        .filter(c => c.id != null);
    }

    async function getMyCurrentCourses(period = null) {
      const qs = period ? `?period=${encodeURIComponent(period)}` : '';
      const r = await fetch(`${API_BASE}/enrollments/me/courses${qs}`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      const payload = await r.json();
      return normalizeStudentCourses(payload);
    }

    async function initAnnStudentCourses() {
      const sel = document.getElementById('ann-student-course');
      if (!sel) return;
      try {
        const courses = await getMyCurrentCourses();
        sel.innerHTML = '<option value="">â€” Todos tus cursos â€”</option>';
        courses.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.code} ${c.name}`.trim();
          sel.appendChild(opt);
        });
        if (courses.length > 0) {
          sel.value = '';
          loadStudentAnnouncements();
        } else {
          const container = document.getElementById('ann-student-list');
          if (container) {
            container.innerHTML = '<p style="color:var(--muted)">No tienes materias activas para mostrar anuncios.</p>';
          }
        }
      } catch(e) { console.error('Error cargando cursos estudiante (comunicaciones):', e); }
    }

    async function loadStudentAnnouncements() {
      const courseId = document.getElementById('ann-student-course')?.value;
      const container = document.getElementById('ann-student-list');
      if (!container) return;
      container.innerHTML = '<p style="color:var(--muted)">Cargandoâ€¦</p>';
      try {
        const endpoint = courseId
          ? `${API_BASE}/grades/announcements?course_id=${courseId}`
          : `${API_BASE}/grades/announcements`;
        const r = await fetch(endpoint, { headers: getAuthHeaders() });
        const anns = await r.json();
        if (!anns.length) {
          container.innerHTML = `<p style="color:var(--muted)">${courseId ? 'No hay anuncios para este curso.' : 'No hay anuncios en tus cursos.'}</p>`;
          return;
        }
        container.innerHTML = anns.map(a => `
          <div style="background:linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,102,241,0.05) 100%);border:2px solid rgba(59,130,246,0.25);border-radius:12px;padding:1.25rem;margin-bottom:1rem;box-shadow:0 2px 8px rgba(29,78,216,0.1);">
            ${a.pinned ? '<span style="background:rgba(29,78,216,0.15);color:var(--accent);font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:4px;display:inline-block;margin-bottom:.5rem;">ðŸ“Œ FIJADO</span><br>' : ''}
            <strong style="font-size:1.05rem;color:var(--text);">${escapeHtml(a.title)}</strong>
            <div style="font-size:.75rem;color:var(--muted);margin:.35rem 0 .75rem;">ðŸ“… ${new Date(a.created_at).toLocaleString('es-CO')}</div>
            <p style="margin:0;white-space:pre-wrap;color:var(--text);line-height:1.6;">${escapeHtml(a.body)}</p>
          </div>`).join('');
      } catch(e) { container.innerHTML = '<p style="color:var(--danger)">Error al cargar anuncios.</p>'; }
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Convierte "14:00" â†’ "2:00 PM", "07:00" â†’ "7:00 AM"
    function formatTime(t) {
      if (!t) return 'â€”';
      const [hStr, mStr] = t.split(':');
      let h = parseInt(hStr, 10);
      const m = mStr || '00';
      const period = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${period}`;
    }

    // Formatea rango horario: "07:00" "09:00" â†’ "7:00 AM â€“ 9:00 AM"
    function formatRange(start, end) {
      if (!start || !end) return 'â€”';
      return `${formatTime(start)} â€“ ${formatTime(end)}`;
    }

    function goTo(section, btn) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById(`sec-${section}`).classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      setAcademicAdminTabState(section);
      // Recordar la Ãºltima secciÃ³n visitada
      localStorage.setItem('last_section', section);
      if (section === 'my-profile') {
        loadMyProfile();
      }
      if (section === 'horario') {
        loadSchedule();
        const schCareer = document.getElementById('sch-career');
        if (schCareer && schCareer.value) loadScheduleCourses();
      }
      if (section === 'mis-cursos' && USER_ROLE === 'docente') {
        loadTeacherMisCursos();
      }
      if (section === 'my-enrollments' && USER_ROLE === 'estudiante') {
        loadMyEnrollments();
      }
      if (section === 'payment') {
        loadPaymentSection();
      }
      if (section === 'assignments') {
        loadAssignments();
      }
      if (section === 'buzones') {
        const courseEl = document.getElementById('buz-teacher-course') || document.getElementById('buz-student-course');
        if (courseEl) {
          if (USER_ROLE === 'docente' && !courseEl.value && courseEl.options && courseEl.options.length > 1) {
            courseEl.value = courseEl.options[1].value;
          }
          if (USER_ROLE === 'docente' && courseEl.value) loadTeacherBuzones();
          else if (USER_ROLE === 'estudiante') loadStudentBuzones();
        }
      }
      if (section === 'comunicaciones') {
        if (USER_ROLE === 'docente') initAnnTeacherCourses();
        else if (USER_ROLE === 'estudiante') initAnnStudentCourses();
      }
      if (section === 'reports') {
        loadReportFilters();
      }
      if (section === 'grades' && USER_ROLE === 'estudiante') {
        loadMyGrades();
      }
    }

    function setText(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function setDashboardRoleState() {
      document.body.classList.remove('role-admin', 'role-docente', 'role-estudiante');
      if (USER_ROLE) {
        document.body.classList.add(`role-${USER_ROLE}`);
      }

      const subtitle = document.getElementById('dashboard-subtitle');
      if (!subtitle) return;

      if (USER_ROLE === 'admin') {
        subtitle.textContent = 'Vista ejecutiva para administraciÃ³n acadÃ©mica y operativa';
      } else if (USER_ROLE === 'docente') {
        subtitle.textContent = 'Accesos rÃ¡pidos para docencia y seguimiento acadÃ©mico';
      } else if (USER_ROLE === 'estudiante') {
        subtitle.textContent = 'Tus servicios personales y estado acadÃ©mico';
      }
    }

    async function loadAdminDashboard() {
      if (USER_ROLE !== 'admin') return;

      const requests = await Promise.allSettled([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/students/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/academic/api/careers/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/academic/api/courses/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/academic/api/teachers/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/academic/api/assignments/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/enrollments/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/grades/health`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/payments/health`, { headers: getAuthHeaders() }),
      ]);

      const parseJson = async (entry, fallback = []) => {
        if (entry.status !== 'fulfilled') return fallback;
        if (!entry.value.ok) return fallback;
        try {
          return await entry.value.json();
        } catch {
          return fallback;
        }
      };

      const health = await parseJson(requests[0], { services: {} });
      const students = await parseJson(requests[1], []);
      const careers = await parseJson(requests[2], []);
      const courses = await parseJson(requests[3], []);
      const teachers = await parseJson(requests[4], []);
      const assignments = await parseJson(requests[5], []);
      const enrollments = await parseJson(requests[6], []);

      const services = Object.values(health.services || {});
      const upServices = services.filter(state => state === 'ok').length;
      const totalServices = services.length || 7;

      setText('admin-health-score', `${upServices}/${totalServices}`);
      setText('admin-pulse-services', `${upServices} activos`);
      setText('admin-pulse-enrollments', Array.isArray(enrollments) ? String(enrollments.length) : '0');
      setText('admin-pulse-teachers', Array.isArray(teachers) ? String(teachers.length) : '0');
      setText('admin-pulse-careers', Array.isArray(careers) ? String(careers.length) : '0');

      setText('admin-students-kpi', Array.isArray(students) ? String(students.length) : '0');
      setText('admin-courses-kpi', Array.isArray(courses) ? String(courses.length) : '0');
      setText('admin-payments-kpi', requests[8].status === 'fulfilled' && requests[8].value.ok ? 'Online' : 'Offline');
      setText('admin-assignments-kpi', Array.isArray(assignments) ? String(assignments.length) : '0');
      setText('admin-grades-kpi', requests[7].status === 'fulfilled' && requests[7].value.ok ? 'OK' : 'NA');
      setText('admin-gateway-kpi', health.gateway === 'ok' ? 'Estable' : 'Revisar');
    }

    async function loadTeacherProfile() {
      if (USER_ROLE !== 'docente') return null;
      if (MY_TEACHER) return MY_TEACHER;

      try {
        const authRes = await fetch(`${API_BASE}/auth/profile`, { headers: getAuthHeaders() });
        if (!authRes.ok) return null;
        const authData = await authRes.json();
        const userId = authData?.usuario?.user_id;
        if (!userId) return null;

        const teacherRes = await fetch(`${API_BASE}/academic/api/teachers/user/${userId}`, {
          headers: getAuthHeaders(),
        });
        if (!teacherRes.ok) return null;

        MY_TEACHER = await teacherRes.json();
        return MY_TEACHER;
      } catch {
        return null;
      }
    }

    async function loadTeacherDashboard() {
      if (USER_ROLE !== 'docente') return;

      const teacher = await loadTeacherProfile();
      const requests = await Promise.allSettled([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/academic/api/courses/`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/academic/api/schedules/`, { headers: getAuthHeaders() }),
        teacher ? fetch(`${API_BASE}/academic/api/assignments/teacher/${teacher.id}`, { headers: getAuthHeaders() }) : Promise.resolve(null),
      ]);

      const parseJson = async (entry, fallback = []) => {
        if (entry.status !== 'fulfilled' || !entry.value || !entry.value.ok) return fallback;
        try {
          return await entry.value.json();
        } catch {
          return fallback;
        }
      };

      const health = await parseJson(requests[0], { services: {} });
      const courses = await parseJson(requests[1], []);
      const sessions = await parseJson(requests[2], []);
      const assignments = await parseJson(requests[3], []);
      const services = Object.values(health.services || {});
      const upServices = services.filter(state => state === 'ok').length;
      const totalServices = services.length || 7;

      setText('teacher-name', teacher?.name || `${teacher?.first_name || ''} ${teacher?.last_name || ''}`.trim() || USER_EMAIL || 'Docente');
      setText('teacher-health-score', `${upServices}/${totalServices}`);
      setText('teacher-courses-count', Array.isArray(courses) ? String(courses.length) : '0');
      setText('teacher-schedule-count', Array.isArray(sessions) ? String(sessions.length) : '0');
      setText('teacher-assignments-count', Array.isArray(assignments) ? String(assignments.length) : '0');
      setText('teacher-grade-courses', Array.isArray(courses) ? String(courses.length) : '0');
      setText('teacher-kpi-courses', Array.isArray(courses) ? String(courses.length) : '0');
      setText('teacher-kpi-hours', Array.isArray(sessions) ? `${sessions.length} bloques` : '0');
      setText('teacher-kpi-grades', Array.isArray(assignments) ? `${assignments.length} cursos` : '0');
    }

    async function loadTeacherMisCursos() {
      if (USER_ROLE !== 'docente') return;
      const tbody = document.getElementById('mis-cursos-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">â—Œ</div>Cargando...</div></td></tr>';

      try {
        const coursesRes = await fetch(`${API_BASE}/academic/api/courses/`, { headers: getAuthHeaders() });
        const courses = coursesRes.ok ? await coursesRes.json() : [];

        if (!Array.isArray(courses) || courses.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">ðŸ“­</div>No tienes cursos asignados.</div></td></tr>';
          return;
        }

        // Poblar el select de filtro por curso
        const filterSel = document.getElementById('teacher-course-filter');
        if (filterSel) {
          filterSel.innerHTML = '<option value="">â€” Todos mis cursos â€”</option>' +
            courses.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
        }

        const DAY_ES = { lunes:'Lunes', martes:'Martes', miercoles:'MiÃ©rcoles', jueves:'Jueves', viernes:'Viernes', sabado:'SÃ¡bado' };

        tbody.innerHTML = courses.map(c => {
          const dia = c.day_of_week ? (DAY_ES[c.day_of_week] || c.day_of_week) : 'â€”';
          const horario = c.start_time && c.end_time ? formatRange(c.start_time, c.end_time) : (c.schedule || 'â€”');
          const salon = c.location || 'â€”';
          const courseName = escapeHtml(`${c.code} â€” ${c.name}`);
          return `<tr>
            <td><code style="font-size:.75rem;color:var(--accent)">${c.code || 'â€”'}</code></td>
            <td>${c.name || 'â€”'}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openCourseStudents(${c.id}, '${courseName}')">ðŸ‘¥ Ver lista</button></td>
            <td>${c.semester ?? 'â€”'}</td>
            <td>${c.credits ?? 'â€”'}</td>
            <td>${dia}</td>
            <td>${horario}</td>
            <td>${salon}</td>
          </tr>`;
        }).join('');

        // Cargar estudiantes automÃ¡ticamente al tener los cursos â€” eliminado
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">âš </div>Error al cargar cursos.</div></td></tr>';
      }
    }

    async function openCourseStudents(courseId, courseLabel) {
      const modal = document.getElementById('modal-course-students');
      const title = document.getElementById('modal-course-students-title');
      const body  = document.getElementById('modal-course-students-body');

      title.textContent = `Estudiantes â€” ${courseLabel}`;
      body.innerHTML = '<div class="empty-state"><div class="big">â—Œ</div>Cargando...</div>';
      modal.style.display = 'flex';

      try {
        const res = await fetch(`${API_BASE}/enrollments/course/${courseId}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();

        const raw  = await res.json();
        const enrs = Array.isArray(raw) ? raw : (raw.value || raw.enrollments || []);

        if (!enrs.length) {
          body.innerHTML = '<div class="empty-state"><div class="big">ðŸ“­</div>No hay estudiantes matriculados en este curso.</div>';
          return;
        }

        const students = await Promise.all(enrs.map(e => _fetchStudentById(e.student_id).catch(() => null)));

        const rows = enrs.map((e, i) => {
          const s = students[i];
          const nombre = s ? `${s.nombre || ''} ${s.apellido || ''}`.trim() || s.email : `ID ${e.student_id}`;
          const email  = s?.email || 'â€”';
          const doc    = s?.document_id || 'â€”';
          const estado = e.status === 'activa' || e.status === 'active'
            ? `<span class="badge badge-activo">${e.status}</span>`
            : `<span class="badge">${e.status || 'â€”'}</span>`;
          return `<tr>
            <td><code style="font-size:.72rem;color:var(--accent)">${escapeHtml(doc)}</code></td>
            <td>${escapeHtml(nombre)}</td>
            <td style="font-size:.85rem;color:var(--muted)">${escapeHtml(email)}</td>
            <td>${estado}</td>
          </tr>`;
        }).join('');

        body.innerHTML = `
          <p style="color:var(--muted);font-size:.85rem;margin-bottom:.75rem;">${enrs.length} estudiante${enrs.length !== 1 ? 's' : ''} matriculado${enrs.length !== 1 ? 's' : ''}</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>CÃ©dula</th><th>Nombre</th><th>Correo</th><th>Estado</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      } catch {
        body.innerHTML = '<div class="empty-state"><div class="big">âš </div>Error al cargar estudiantes.</div>';
      }
    }

    async function _fetchStudentById(studentId) {
      if (!_fetchStudentById._cache) _fetchStudentById._cache = {};
      if (_fetchStudentById._cache[studentId]) return _fetchStudentById._cache[studentId];
      try {
        const res = await fetch(`${API_BASE}/students/${studentId}`, { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          _fetchStudentById._cache[studentId] = data;
          return data;
        }
      } catch (e) { /* ignorar */ }
      return null;
    }

    async function loadStudentDashboard() {
      if (USER_ROLE !== 'estudiante') return;
      if (!MY_STUDENT) {
        await loadMyStudent();
      }

      const requests = await Promise.allSettled([
        fetch(`${API_BASE}/enrollments/me`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/enrollments/me/courses`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/grades/me`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/grades/me/average`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/payments/me/summary`, { headers: getAuthHeaders() }),
      ]);

      const parseJson = async (entry, fallback = null) => {
        if (entry.status !== 'fulfilled' || !entry.value?.ok) return fallback;
        try {
          return await entry.value.json();
        } catch {
          return fallback;
        }
      };

      const enrollments = await parseJson(requests[0], []);
      const enrolledCourses = await parseJson(requests[1], { courses: [] });
      const grades = await parseJson(requests[2], []);
      const average = await parseJson(requests[3], { average: 'â€”' });
      const financial = await parseJson(requests[4], null);

      const currentEnrollments = Array.isArray(enrollments)
        ? enrollments.filter(e => isCurrentEnrollmentStatus(e?.status))
        : [];
      const currentCourses = normalizeStudentCourses(enrolledCourses);

      const studentName = MY_STUDENT
        ? `${MY_STUDENT.nombre || ''} ${MY_STUDENT.apellido || ''}`.trim() || USER_EMAIL || 'Estudiante'
        : USER_EMAIL || 'Estudiante';

      setText('student-dashboard-name', studentName);
      setText('student-dashboard-average', average?.average ?? 'â€”');
      setText('student-dashboard-courses', String(currentCourses.length));
      setText('student-dashboard-grades', String(Array.isArray(grades) ? grades.length : 0));
      setText('student-dashboard-balance', financial ? `${financial.balance ?? 0}` : 'â€”');
      setText('student-dashboard-financial-status', financial?.status || 'Sin datos');
      setText('student-kpi-document', MY_STUDENT?.document_id || 'Sin doc');
      setText('student-kpi-enrollments', String(currentEnrollments.length));
      setText('student-kpi-paid', financial ? `${financial.total_paid ?? 0}` : '0');

      await renderStudentDashboardEnrollments(currentEnrollments);
    }

    function showToast(msg, type = 'ok') {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = `show ${type}`;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function isGenericTeacherName(name) {
      if (!name) return false;
      return /^docente\s*\d+$/i.test(String(name).trim());
    }

    function emailToDisplayName(email) {
      const raw = (email || '').toString().split('@')[0].trim();
      if (!raw) return '';
      const normalized = raw.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
      return normalized
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    }

    function getTeacherDisplayName(teacher) {
      if (!teacher) return 'Docente';
      const fullFromParts = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim();
      if (fullFromParts) return fullFromParts;

      const teacherName = (teacher.name || '').toString().trim();
      if (teacherName && !isGenericTeacherName(teacherName)) return teacherName;

      const fromEmail = emailToDisplayName(teacher.email);
      if (fromEmail) return fromEmail;

      return teacherName || `Docente ${teacher.id}`;
    }

    async function fetchCourse(courseId) {
      if (COURSE_CACHE.has(courseId)) {
        return COURSE_CACHE.get(courseId);
      }

      try {
        const res = await fetch(`${API_BASE}/academic/api/courses/${courseId}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const course = await res.json();
          COURSE_CACHE.set(courseId, course);
          return course;
        }
      } catch (e) {
        console.warn('Error cargando curso', e);
      }
      return null;
    }

    async function fetchCourseTeachers(courseId) {
      if (COURSE_TEACHERS_CACHE.has(courseId)) {
        return COURSE_TEACHERS_CACHE.get(courseId);
      }

      try {
        const res = await fetch(`${API_BASE}/academic/api/assignments/course/${courseId}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const assignments = await res.json();
          const teacherPromises = (Array.isArray(assignments) ? assignments : []).map(async assignment => {
            const teacherId = assignment?.teacher_id;
            if (!teacherId) return null;

            const teacher = await fetchTeacher(teacherId);
            return teacher || null;
          });

          const teachers = (await Promise.all(teacherPromises)).filter(Boolean);
          if (teachers.length > 0) {
            COURSE_TEACHERS_CACHE.set(courseId, teachers);
          }
          return teachers;
        }
      } catch (e) {
        console.warn('Error cargando docentes del curso', e);
      }

      return [];
    }

    async function buildEnrollmentDetail(enrollment) {
      const course = await fetchCourse(enrollment.course_id);
      const sessions = await fetchCourseSessions(enrollment.course_id);
      const selectedSession = sessions.find(session => Number(session.id) === Number(enrollment.section_id));
      const teachers = await fetchCourseTeachers(enrollment.course_id);

      const courseLabel = course
        ? `${course.code ? `${course.code} â€” ` : ''}${course.name || `Curso ${enrollment.course_id}`}`
        : `Curso ${enrollment.course_id}`;

      const scheduleLabel = selectedSession?.day_of_week && selectedSession?.start_time && selectedSession?.end_time
        ? `${selectedSession.day_of_week} ${formatRange(selectedSession.start_time, selectedSession.end_time)}`
        : course?.day_of_week && course?.start_time && course?.end_time
          ? `${course.day_of_week} ${formatRange(course.start_time, course.end_time)}`
          : (course?.schedule || 'Por definir');

      const classroomLabel = selectedSession?.classroom || course?.location || 'Por definir';

      const teacherLabel = teachers.length > 0
        ? teachers.map(t => getTeacherDisplayName(t)).join(', ')
        : 'Sin docente asignado';

      return {
        enrollment,
        courseCode: course?.code || enrollment.course_id,
        courseLabel,
        semester: course?.semester || '-',
        credits: course?.credits || 0,
        section: selectedSession?.section || enrollment.section_id || '-',
        scheduleLabel,
        classroomLabel,
        teacherLabel,
      };
    }

    async function renderStudentDashboardEnrollments(enrollments) {
      const tbody = document.getElementById('student-dashboard-enrollments-tbody');
      if (!tbody) return;

      if (!Array.isArray(enrollments) || enrollments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="big">ðŸ“­</div>No tienes materias inscritas</div></td></tr>';
        return;
      }

      const details = await Promise.all(enrollments.map(buildEnrollmentDetail));
      tbody.innerHTML = details.map(item => `
        <tr>
          <td>${item.courseLabel}</td>
          <td>${item.scheduleLabel}</td>
          <td>${item.classroomLabel}</td>
          <td>${item.teacherLabel}</td>
        </tr>
      `).join('');
    }

    async function loadMyStudent() {
      try {
        const res = await fetch(`${API_BASE}/students/me`, { headers: getAuthHeaders() });
        if (!res.ok) {
          throw new Error('No se pudo cargar el perfil');
        }
        MY_STUDENT = await res.json();
        document.getElementById('student-program-text').textContent = `Programa: ${MY_STUDENT.program || 'Sin programa'}`;
        setUserInfo();
      } catch (e) {
        showToast('âœ— No se encontrÃ³ el perfil de estudiante', 'err');
      }
    }

    function setUserInfo() {
      const badge = document.getElementById('user-badge');
      if (!badge) return;
      let label = USER_EMAIL ? USER_EMAIL : 'Usuario';
      if (MY_STUDENT?.nombre) {
        label = `${MY_STUDENT.nombre} ${MY_STUDENT.apellido || ''}`.trim();
      }
      const roleEmoji = USER_ROLE === 'admin' ? 'ðŸ›¡' : USER_ROLE === 'docente' ? 'ðŸ‘©â€ðŸ«' : 'ðŸŽ“';
      const roleText = USER_ROLE ? USER_ROLE : 'desconocido';
      badge.innerHTML = `${roleEmoji} <span class="user-badge-name">${escapeHtml(label)}</span> <span class="user-badge-role">(${escapeHtml(roleText)})</span>`;
      badge.classList.add('visible');
    }

    async function setTeacherUserInfo() {
      if (!TOKEN || USER_ROLE !== 'docente') return;
      try {
        const res = await apiFetch(`${API_BASE}/academic/api/teachers/user/${USER_ID}`);
        if (!res.ok) return;
        const teacher = await res.json();
        const name = (teacher.first_name || teacher.name || '').split(' ').slice(0, 2).join(' ') ||
                     (teacher.last_name ? `${teacher.first_name || ''} ${teacher.last_name}`.trim() : null) ||
                     teacher.name || USER_EMAIL;
        const badge = document.getElementById('user-badge');
        if (badge && name) {
          badge.innerHTML = `ðŸ‘©â€ðŸ« <span class="user-badge-name">${escapeHtml(name)}</span> <span class="user-badge-role">(docente)</span>`;
          badge.classList.add('visible');
        }
      } catch { /* usa el email como fallback */ }
    }

    // â”€â”€ MATRICULACIÃ“N DE MATERIAS (Estudiante) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ENROLLMENT_CART = {};  // { courseId: { courseData, sectionId } }
    let COMPLETED_COURSES = {};  // { courseId: true }
    let MY_CAREER_ID = null;  // Para guardar la carrera del estudiante
    const COURSE_SESSIONS_CACHE = new Map();
    const ENROLLMENT_COURSE_INDEX = new Map();
    let ENROLLMENT_SECTION_OPTIONS = new Map();
    let PENDING_ENROLLMENT_COURSE = null;
    let ENROLLMENTS_ADMIN_PAGE = 1;
    const ENROLLMENTS_ADMIN_LIMIT = 25;
    let ENROLLMENTS_ADMIN_TOTAL = 0;
    let ENROLLMENT_ACTIONS_BOUND = false;
    const INLINE_SECTION_CONTEXT = new Map();
    const PENDING_ENROLLMENT_STORAGE_KEY = 'sgau_pending_enrollment_order';
    const PENDING_ENROLLMENT_HISTORY_KEY = 'sgau_pending_enrollment_orders';
    const ACTIVE_PENDING_INVOICE_KEY = 'sgau_pending_enrollment_active_invoice';
    const ACTIVE_PENDING_PAYMENT_REF_KEY = 'sgau_pending_enrollment_active_payment_ref';
    let PENDING_ENROLLMENT_ORDER = null;
    let PAYMENT_HISTORY_CACHE = [];
    const WOMPI_TEST_CHECKOUT_URL = 'https://checkout.wompi.co/l/test_VPOS_ZTf5ZN';

    function hasCompletedCourseCode(code) {
      const targetCode = normalizeText(code);
      if (!targetCode) return false;
      const completedIds = new Set(Object.keys(COMPLETED_COURSES).map(id => Number(id)));
      return COURSES.some(c => completedIds.has(Number(c.id)) && normalizeText(c.code) === targetCode);
    }

    function bindEnrollmentCourseActions() {
      if (ENROLLMENT_ACTIONS_BOUND) return;
      const container = document.getElementById('enrollment-content');
      if (!container) return;

      container.addEventListener('click', (event) => {
        const btn = event.target.closest('.enrollment-open-sections');
        if (!btn) return;

        const courseId = Number(btn.dataset.courseId || 0);
        if (!courseId) {
          showToast('âœ— No se pudo identificar la materia seleccionada', 'err');
          return;
        }
        selectCourseForEnrollmentById(courseId);
      });

      ENROLLMENT_ACTIONS_BOUND = true;
    }

    async function fetchCourseSessions(courseId, forceRefresh = false) {
      if (!forceRefresh && COURSE_SESSIONS_CACHE.has(courseId)) {
        return COURSE_SESSIONS_CACHE.get(courseId);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      let response;
      try {
        response = await fetch(`${API_BASE}/academic/api/schedules/?course_id=${courseId}`, {
          headers: getAuthHeaders(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const sessions = response.ok ? await response.json() : [];
      const normalized = Array.isArray(sessions) ? sessions : [];

      // Solo cacheamos resultados con datos para no dejar vacio "pegado" en la sesion.
      if (normalized.length > 0) {
        COURSE_SESSIONS_CACHE.set(courseId, normalized);
      } else {
        COURSE_SESSIONS_CACHE.delete(courseId);
      }

      return normalized;
    }

    async function openCourseSectionsModal(courseId, code, name, credits, courseMeta = {}) {
      const modal = document.getElementById('modal-course-sections');
      const title = document.getElementById('modal-sections-title');
      const tbody = document.getElementById('modal-sections-tbody');

      if (title) title.textContent = `Clases disponibles de ${code} - ${name}`;
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Cargando clases disponibles...</td></tr>';
      }
      if (modal) modal.style.display = 'flex';

      let sessions = await fetchCourseSessions(courseId);
      if (!sessions.length) {
        sessions = await fetchCourseSessions(courseId, true);
      }

      if (!sessions.length) {
        const course = await fetchCourse(courseId);
        if (course?.day_of_week && course?.start_time && course?.end_time) {
          sessions = [{
            id: `fallback-${courseId}`,
            course_id: courseId,
            day_of_week: course.day_of_week,
            start_time: course.start_time,
            end_time: course.end_time,
            classroom: course.location || 'Por definir',
            section: 'Ãšnica',
            modality: course.modality || null,
            isFallback: true,
          }];
        } else {
          if (title) title.textContent = `Clases disponibles de ${code} - ${name}`;
          if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Esta materia no tiene clases publicadas todavia. Intenta recargar la pagina y verifica que las clases esten guardadas.</td></tr>';
          }
          if (modal) modal.style.display = 'flex';
          return;
        }
      }

      const teachers = await fetchCourseTeachers(courseId);
      const teacherLabel = teachers.length > 0
        ? teachers.map(t => getTeacherDisplayName(t)).join(', ')
        : 'Por asignar';

      PENDING_ENROLLMENT_COURSE = {
        courseId,
        code,
        name,
        credits,
        teacherLabel,
        prerequisite_codes: Array.isArray(courseMeta.prerequisite_codes) ? courseMeta.prerequisite_codes : [],
      };
      ENROLLMENT_SECTION_OPTIONS = new Map(sessions.map(session => [String(session.id), session]));

      document.getElementById('modal-sections-title').textContent = `Clases disponibles de ${code} - ${name}`;
      document.getElementById('modal-sections-tbody').innerHTML = sessions.map(session => {
        const selected = ENROLLMENT_CART[courseId]?.sectionId === session.id;
        const sectionLabel = session.section || `Clase ${session.id}`;
        return `
          <tr>
            <td>${sectionLabel}</td>
            <td>${session.day_of_week || '-'}</td>
            <td>${session.start_time && session.end_time ? formatRange(session.start_time, session.end_time) : '-'}</td>
            <td>${session.classroom || '-'}</td>
            <td>${teacherLabel}</td>
            <td>
              <button class="btn btn-sm ${selected ? 'btn-accent' : 'btn-secondary'}" onclick="confirmCourseSectionSelection('${String(session.id).replace(/'/g, "\\'")}')">
                ${selected ? 'âœ“ Seleccionada' : 'Elegir'}
              </button>
            </td>
          </tr>
        `;
      }).join('');

      document.getElementById('modal-course-sections').style.display = 'flex';
    }

    function confirmCourseSectionSelection(sessionId) {
      if (!PENDING_ENROLLMENT_COURSE) return;

      const session = ENROLLMENT_SECTION_OPTIONS.get(String(sessionId));
      if (!session) {
        showToast('âœ— No se encontrÃ³ la clase seleccionada', 'err');
        return;
      }

      const { courseId, code, name, credits, teacherLabel, prerequisite_codes } = PENDING_ENROLLMENT_COURSE;
      const costPerCredit = 145000;
      ENROLLMENT_CART[courseId] = {
        courseId,
        code,
        name,
        credits,
        prerequisite_codes: prerequisite_codes || [],
        cost: credits * costPerCredit,
        sectionId: session.isFallback ? null : session.id,
        requiresConcreteSection: !session.isFallback,
        sectionLabel: session.section || `Clase ${session.id}`,
        day_of_week: session.day_of_week,
        start_time: session.start_time,
        end_time: session.end_time,
        classroom: session.classroom,
        modality: session.modality,
        teacherLabel,
      };

      document.getElementById('modal-course-sections').style.display = 'none';
      updateEnrollmentCart();
      loadEnrollmentSemester(parseInt(document.querySelector('[id^="sem-tab-"].active')?.id.split('-')[2] || '1'));
    }

    function selectCourseSectionInline(courseId, sessionId) {
      const context = INLINE_SECTION_CONTEXT.get(String(courseId));
      if (!context) {
        showToast('âœ— No se encontrÃ³ el contexto de clases. Vuelve a cargar.', 'err');
        return;
      }

      const session = context.sessionsMap.get(String(sessionId));
      if (!session) {
        showToast('âœ— No se encontrÃ³ la clase seleccionada', 'err');
        return;
      }

      const { course, teacherLabel, prerequisite_codes } = context;
      const costPerCredit = 145000;
      ENROLLMENT_CART[course.id] = {
        courseId: course.id,
        code: course.code,
        name: course.name,
        credits: Number(course.credits) || 0,
        prerequisite_codes: prerequisite_codes || [],
        cost: (Number(course.credits) || 0) * costPerCredit,
        sectionId: session.isFallback ? null : session.id,
        requiresConcreteSection: !session.isFallback,
        sectionLabel: session.section || `Clase ${session.id}`,
        day_of_week: session.day_of_week,
        start_time: session.start_time,
        end_time: session.end_time,
        classroom: session.classroom,
        modality: session.modality,
        teacherLabel,
      };

      showToast(`âœ“ Clase ${session.section || session.id} elegida para ${course.code}`, 'ok');
      updateEnrollmentCart();
      loadEnrollmentSemester(parseInt(document.querySelector('[id^="sem-tab-"].active')?.id.split('-')[2] || '1'));
    }

    async function toggleCourseSectionsInline(courseId) {
      const container = document.getElementById(`course-sections-inline-${courseId}`);
      const course = ENROLLMENT_COURSE_INDEX.get(Number(courseId));
      if (!container || !course) {
        showToast('âœ— No se encontrÃ³ la materia seleccionada', 'err');
        return;
      }

      if (container.style.display === 'block') {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';
      container.innerHTML = '<div style="color:var(--muted);">Cargando clases...</div>';

      let sessions = await fetchCourseSessions(course.id);
      if (!sessions.length) sessions = await fetchCourseSessions(course.id, true);

      if (!sessions.length && course?.day_of_week && course?.start_time && course?.end_time) {
        sessions = [{
          id: `fallback-${course.id}`,
          course_id: course.id,
          day_of_week: course.day_of_week,
          start_time: course.start_time,
          end_time: course.end_time,
          classroom: course.location || 'Por definir',
          section: 'Ãšnica',
          modality: course.modality || null,
          isFallback: true,
        }];
      }

      if (!sessions.length) {
        container.innerHTML = '<div style="color:var(--muted);">No hay clases disponibles para esta materia.</div>';
        return;
      }

      const teachers = await fetchCourseTeachers(course.id);
      const teacherLabel = teachers.length > 0
        ? teachers.map(t => getTeacherDisplayName(t)).join(', ')
        : 'Por asignar';

      const sessionsMap = new Map(sessions.map(s => [String(s.id), s]));
      INLINE_SECTION_CONTEXT.set(String(course.id), {
        course,
        teacherLabel,
        prerequisite_codes: Array.isArray(course.prerequisite_codes) ? course.prerequisite_codes : [],
        sessionsMap,
      });

      container.innerHTML = sessions.map(session => {
        const sid = String(session.id).replace(/'/g, "\\'");
        return `
          <div class="row">
            <div><strong>${session.section || `Clase ${session.id}`}</strong></div>
            <div>${session.day_of_week || '-'}</div>
            <div>${session.start_time && session.end_time ? formatRange(session.start_time, session.end_time) : '-'}</div>
            <button class="btn btn-sm btn-secondary" onclick="selectCourseSectionInline(${course.id}, '${sid}')">Elegir</button>
          </div>
          <div style="font-size:.75rem;color:var(--muted);margin:-.2rem 0 .3rem .2rem;">Aula: ${session.classroom || '-'} Â· Docente: ${teacherLabel}</div>
        `;
      }).join('');
    }

    async function loadMyEnrollments() {
      if (!MY_STUDENT) await loadMyStudent();
      if (!MY_STUDENT) return;

      bindEnrollmentCourseActions();

      if (!Array.isArray(ACADEMIC_CAREERS) || ACADEMIC_CAREERS.length === 0) {
        await loadCareers();
      }

      const studentProgram = (MY_STUDENT.program || '').toString().trim();
      const normalizedProgram = normalizeText(studentProgram);
      const myCareerInfo = ACADEMIC_CAREERS?.find(c => {
        const byName = normalizeText(c.name) === normalizedProgram;
        const byCode = normalizeText(c.code) === normalizedProgram;
        const byCombined = normalizeText(`${c.code} ${c.name}`).includes(normalizedProgram);
        return byName || byCode || byCombined;
      });

      if (!myCareerInfo) {
        document.getElementById('enrollment-content').innerHTML = '<div class="empty-state"><div class="big">âš </div>No se encontrÃ³ carrera</div>';
        return;
      }

      MY_CAREER_ID = myCareerInfo.id;  // Guardar para usar en otras funciones
      COMPLETED_COURSES = {};

      // Cargar materias ya inscritas para marcar completadas
      try {
        const enrollRes = await fetch(`${API_BASE}/enrollments/me`, { headers: getAuthHeaders() });
        if (enrollRes.ok) {
          const myEnrollments = await enrollRes.json();
          for (const e of myEnrollments) {
            const status = String(e?.status || '').toLowerCase();
            if (['finalizada', 'aprobada', 'completada', 'closed'].includes(status)) {
              COMPLETED_COURSES[e.course_id] = true;
            }
          }
        }
      } catch (e) {}

      // Crear tabs de semestres
      const numSemesters = myCareerInfo.duration_semesters || 8;
      let tabs = '';
      for (let i = 1; i <= numSemesters; i++) {
        tabs += `<button class="btn btn-sm btn-secondary" id="sem-tab-${i}" onclick="loadEnrollmentSemester(${i}, ${MY_CAREER_ID})" style="white-space:nowrap;">Sem ${i}</button>`;
      }
      document.getElementById('enrollment-semester-tabs').innerHTML = tabs;

      // Cargar primer semestre por defecto
      await loadEnrollmentSemester(1, MY_CAREER_ID);

      // Cargar materias ya inscritas
      loadMyCurrentEnrollments();
    }

    async function loadEnrollmentSemester(sem, careerId) {
      if (!careerId) careerId = MY_CAREER_ID;
      if (!careerId) return;

      try {
        const res = await fetch(`${API_BASE}/academic/api/careers/${careerId}/courses/semester/${sem}`, { headers: getAuthHeaders() });
        const courses = res.ok ? await res.json() : [];

        // Actualizar tabs activos
        document.querySelectorAll('[id^="sem-tab-"]').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`sem-tab-${sem}`)?.classList.add('active');
        document.getElementById('sem-tab-all')?.classList.remove('active');

        let html = `<div class="enrollment-semester-shell">
          <div class="enrollment-semester-title">Semestre ${sem}</div>
          <div class="enrollment-semester-grid">`;

        for (const course of courses) {
          ENROLLMENT_COURSE_INDEX.set(Number(course.id), course);
          const isCompleted = COMPLETED_COURSES[course.id];
          const hasPrereqs = course.prerequisite_codes && course.prerequisite_codes.length > 0;
          const preqsMet = !hasPrereqs || course.prerequisite_codes.every(code => hasCompletedCourseCode(code));
          const isBlocked = hasPrereqs && !preqsMet;
          const isSelected = ENROLLMENT_CART[course.id];
          const statusText = isCompleted ? 'âœ“ Cursado' : isBlocked ? 'Bloqueado' : isSelected ? 'Clase elegida' : 'Disponible';
          const statusClass = isCompleted ? 'completed' : isBlocked ? 'blocked' : isSelected ? 'selected' : 'available';
          const selectedSection = isSelected?.sectionLabel
            ? `<div class="enrollment-selected-section">Clase elegida: ${isSelected.sectionLabel}</div>`
            : '';

          html += `
            <div class="enrollment-course-card ${isSelected ? 'is-selected' : ''} ${isBlocked ? 'is-blocked' : ''}">
              <div class="enrollment-course-head">
                <div class="enrollment-course-code">${course.code}</div>
                <span class="enrollment-status ${statusClass}">${statusText}</span>
              </div>
              <div class="enrollment-course-name">${course.name}</div>
              <div class="enrollment-course-meta">
                <span>ðŸ’³ ${course.credits} crÃ©ditos</span>
                ${isBlocked ? `<span class="enrollment-prereq" title="${course.prerequisite_codes.join(', ')}">Requiere: ${course.prerequisite_codes.join(', ')}</span>` : ''}
              </div>
              ${selectedSection}
              ${!isCompleted ? `
                <div class="enrollment-course-actions">
                  <button class="btn btn-sm ${isSelected ? 'btn-accent' : 'btn-secondary'} enrollment-open-sections" data-course-id="${course.id}" ${isBlocked ? 'disabled' : ''}>
                    ${isSelected ? 'Cambiar clase' : 'Ver / elegir clase'}
                  </button>
                </div>
                <div id="course-sections-inline-${course.id}" class="enrollment-inline-sections" style="display:none;"></div>
              ` : `<button class="btn btn-sm btn-secondary" disabled>Ya cursado</button>`}
            </div>
          `;
        }

        html += '</div></div>';
        document.getElementById('enrollment-content').innerHTML = html;
      } catch (e) {
        console.error(e);
        document.getElementById('enrollment-content').innerHTML = '<div style="color:var(--danger);">âœ— Error cargando cursos</div>';
      }
    }

    async function selectCourseForEnrollmentById(courseId) {
      return toggleCourseSectionsInline(Number(courseId));
    }

    async function selectCourseForEnrollment(courseId, code, name, credits) {
      try {
        const courseMeta = ENROLLMENT_COURSE_INDEX.get(Number(courseId)) || {};
        await openCourseSectionsModal(courseId, code, name, credits, courseMeta);
      } catch (error) {
        console.error(error);
        const tbody = document.getElementById('modal-sections-tbody');
        const modal = document.getElementById('modal-course-sections');
        if (tbody) {
          const isTimeout = error?.name === 'AbortError';
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);">${isTimeout ? 'La consulta de clases tardÃ³ demasiado. Verifica que academic_service estÃ© activo.' : 'No se pudieron cargar las clases disponibles.'}</td></tr>`;
        }
        if (modal) modal.style.display = 'flex';
      }
    }

    function updateEnrollmentCart() {
      const cart = Object.values(ENROLLMENT_CART);
      const cartEl = document.getElementById('enrollment-cart');
      const totalEl = document.getElementById('enrollment-total-cost');
      const summaryEl = document.getElementById('enrollment-summary');
      const msgEl = document.getElementById('enrollment-msg');

      // Validaciones y advertencias
      let warnings = [];
      // Repetidos (no deberÃ­a ocurrir, pero por si acaso)
      const codes = cart.map(c => c.code);
      const repeated = codes.filter((v, i, a) => a.indexOf(v) !== i);
      if (repeated.length > 0) warnings.push('Hay materias repetidas en el carrito.');

      // Prerequisitos no cumplidos
      for (const c of cart) {
        if (c.prerequisite_codes && c.prerequisite_codes.length > 0) {
          const faltan = c.prerequisite_codes.filter(code => !hasCompletedCourseCode(code));
          if (faltan.length > 0) warnings.push(`La materia ${c.code} requiere: ${faltan.join(', ')}`);
        }
      }

      // Cruces de horario (si hay dos materias con traslape de dÃ­a y hora)
      for (let i = 0; i < cart.length; i++) {
        const a = cart[i];
        if (!a.day_of_week || !a.start_time || !a.end_time) continue;
        const aStart = timeToMinutes(a.start_time);
        const aEnd = timeToMinutes(a.end_time);
        for (let j = i + 1; j < cart.length; j++) {
          const b = cart[j];
          if (!b.day_of_week || !b.start_time || !b.end_time) continue;
          if (a.day_of_week !== b.day_of_week) continue;
          const bStart = timeToMinutes(b.start_time);
          const bEnd = timeToMinutes(b.end_time);
          // Traslape: a inicia antes de que b termine y b inicia antes de que a termine
          if (aStart < bEnd && bStart < aEnd) {
            warnings.push(`Cruce de horario entre ${a.code} y ${b.code} (${a.day_of_week} ${a.start_time}-${a.end_time})`);
          }
        }
      }

      if (cart.length === 0) {
        cartEl.innerHTML = '<div style="color:var(--muted);text-align:center;">Sin cursos seleccionados</div>';
        totalEl.textContent = '$0';
        summaryEl.textContent = '';
        if (msgEl) msgEl.innerHTML = '';
        return;
      }

      const totalCredits = cart.reduce((sum, c) => sum + c.credits, 0);
      const totalCost = cart.reduce((sum, c) => sum + c.cost, 0);

      cartEl.innerHTML = cart.map((c, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;background:var(--bg);border-radius:4px;margin-bottom:0.25rem;">
          <div style="flex:1;">
            <div style="font-weight:500;font-size:0.9rem;">${c.code} - ${c.name}</div>
            <div style="font-size:0.75rem;color:var(--muted);">${c.credits} crÃ©ditos Â· ${c.sectionLabel || 'Sin clase elegida'}</div>
            <div style="font-size:0.75rem;color:var(--muted);">${c.day_of_week && c.start_time && c.end_time ? `${c.day_of_week} ${formatRange(c.start_time, c.end_time)}` : 'Horario por definir'}${c.classroom ? ` Â· ${c.classroom}` : ''}</div>
          </div>
          <button class="btn btn-sm btn-danger" title="Quitar" onclick="deleteEnrollmentItem(${c.courseId})">âœ•</button>
        </div>
      `).join('');

      totalEl.textContent = `$${totalCost.toLocaleString('es-CO')}`;
      summaryEl.innerHTML = `
        <div style="font-weight:500;">${totalCredits} crÃ©ditos</div>
        <div style="font-size:0.75rem;color:var(--muted);">${cart.length} materias seleccionadas</div>
      `;

      if (msgEl) {
        msgEl.innerHTML = warnings.length > 0
          ? `<div style='color:var(--danger);font-weight:500;'>${warnings.join('<br>')}</div>`
          : '';
      }
    }

    function deleteEnrollmentItem(courseId) {
      delete ENROLLMENT_CART[courseId];
      updateEnrollmentCart();
    }

    function clearEnrollmentCart() {
      ENROLLMENT_CART = {};
      updateEnrollmentCart();
    }

    function loadPendingEnrollmentOrders() {
      try {
        const rawHistory = localStorage.getItem(PENDING_ENROLLMENT_HISTORY_KEY);
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory);
          if (Array.isArray(parsed)) {
            return parsed
              .filter(item => item && Array.isArray(item.items) && item.items.length)
              .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          }
        }

        // Compatibilidad con versiÃ³n anterior (un Ãºnico pedido)
        const rawSingle = localStorage.getItem(PENDING_ENROLLMENT_STORAGE_KEY);
        if (rawSingle) {
          const single = JSON.parse(rawSingle);
          if (single && Array.isArray(single.items) && single.items.length) {
            localStorage.setItem(PENDING_ENROLLMENT_HISTORY_KEY, JSON.stringify([single]));
            return [single];
          }
        }
      } catch {
        // ignorar errores de parseo
      }
      return [];
    }

    function savePendingEnrollmentOrders(orders) {
      const normalized = (orders || [])
        .filter(item => item && Array.isArray(item.items) && item.items.length)
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      localStorage.setItem(PENDING_ENROLLMENT_HISTORY_KEY, JSON.stringify(normalized));
      if (normalized.length > 0) {
        localStorage.setItem(PENDING_ENROLLMENT_STORAGE_KEY, JSON.stringify(normalized[normalized.length - 1]));
      } else {
        localStorage.removeItem(PENDING_ENROLLMENT_STORAGE_KEY);
      }
    }

    function loadPendingEnrollmentOrder() {
      if (PENDING_ENROLLMENT_ORDER) return PENDING_ENROLLMENT_ORDER;
      const orders = loadPendingEnrollmentOrders();
      if (!orders.length) return null;

      const activeInvoiceId = localStorage.getItem(ACTIVE_PENDING_INVOICE_KEY);
      const fromActive = activeInvoiceId ? orders.find(o => o.invoiceId === activeInvoiceId) : null;
      const fallback = fromActive || orders[orders.length - 1];
      if (fallback?.invoiceId) {
        localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, fallback.invoiceId);
      }
      PENDING_ENROLLMENT_ORDER = fallback || null;
      return PENDING_ENROLLMENT_ORDER;
    }

    function savePendingEnrollmentOrder(order) {
      const orders = loadPendingEnrollmentOrders();
      const idx = orders.findIndex(o => o.invoiceId === order.invoiceId);
      if (idx >= 0) orders[idx] = order;
      else orders.push(order);
      savePendingEnrollmentOrders(orders);

      PENDING_ENROLLMENT_ORDER = order;
      if (order?.invoiceId) {
        localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, order.invoiceId);
      }
    }

    function clearPendingEnrollmentOrder(invoiceId = null) {
      const orders = loadPendingEnrollmentOrders();
      const activeInvoiceId = invoiceId || localStorage.getItem(ACTIVE_PENDING_INVOICE_KEY);
      const next = orders.filter(o => o.invoiceId !== activeInvoiceId);
      savePendingEnrollmentOrders(next);
      PENDING_ENROLLMENT_ORDER = null;

      if (next.length > 0) {
        const lastId = next[next.length - 1].invoiceId;
        localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, lastId);
      } else {
        localStorage.removeItem(ACTIVE_PENDING_INVOICE_KEY);
      }
    }

    function switchPendingEnrollmentOrder(invoiceId) {
      const orders = loadPendingEnrollmentOrders();
      const selected = orders.find(o => o.invoiceId === invoiceId);
      if (!selected) return;
      PENDING_ENROLLMENT_ORDER = selected;
      localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, invoiceId);
      if (selected.payment_reference) {
        localStorage.setItem(ACTIVE_PENDING_PAYMENT_REF_KEY, selected.payment_reference);
      }
      prefillPaymentFromPendingEnrollment();
    }

    function extractInvoiceIdFromConcept(concept) {
      const raw = String(concept || '');
      const match = raw.match(/FAC-MAT-[0-9]+/i);
      return match ? match[0].toUpperCase() : null;
    }

    function getPendingEnrollmentPaymentsFromHistory() {
      return (PAYMENT_HISTORY_CACHE || [])
        .filter(p => String(p?.status || '').toLowerCase() === 'pendiente')
        .filter(p => /fac-mat-/i.test(String(p?.concept || '')))
        .map(p => ({
          reference: p.reference,
          concept: p.concept || '',
          invoiceId: extractInvoiceIdFromConcept(p.concept) || `FAC-HIST-${String(p.reference || '').slice(-6)}`,
          amount: Number(p.amount || 0),
          checkout_url: p.checkout_url || null,
          created_at: p.created_at || null,
          status: p.status || 'pendiente',
        }));
    }

    function getActiveEnrollmentPaymentReference() {
      return localStorage.getItem(ACTIVE_PENDING_PAYMENT_REF_KEY) || null;
    }

    function setActiveEnrollmentPaymentReference(reference) {
      if (reference) {
        localStorage.setItem(ACTIVE_PENDING_PAYMENT_REF_KEY, reference);
      } else {
        localStorage.removeItem(ACTIVE_PENDING_PAYMENT_REF_KEY);
      }
    }

    function switchPendingEnrollmentPayment(reference) {
      setActiveEnrollmentPaymentReference(reference || null);
      const byRef = findPendingEnrollmentOrderByReference(reference);
      if (byRef?.invoiceId) {
        localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, byRef.invoiceId);
        PENDING_ENROLLMENT_ORDER = byRef;
      }
      prefillPaymentFromPendingEnrollment();
    }

    function findPendingEnrollmentOrderByReference(reference) {
      const target = String(reference || '').trim();
      if (!target) return null;
      return loadPendingEnrollmentOrders().find(o => String(o.payment_reference || '') === target) || null;
    }

    function buildEnrollmentInvoice(cart) {
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const invoiceId = `FAC-MAT-${stamp}`;
      const totalCredits = cart.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
      const totalCost = cart.reduce((sum, c) => sum + (Number(c.cost) || 0), 0);
      return {
        invoiceId,
        createdAt: now.toISOString(),
        status: 'pending_payment',
        totalCredits,
        totalCost,
        concept: `Matricula ${invoiceId}`,
        items: cart.map(c => ({
          course_id: Number(c.courseId),
          section_id: c.sectionId == null ? null : Number(c.sectionId),
          code: c.code,
          name: c.name,
          credits: Number(c.credits) || 0,
          sectionLabel: c.sectionLabel || null,
          cost: Number(c.cost) || 0,
        })),
      };
    }

    async function ensureJsPdfLoaded() {
      if (window.jspdf?.jsPDF) return true;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return !!window.jspdf?.jsPDF;
    }

    async function downloadEnrollmentInvoicePdf(orderParam = null, paymentRef = null, statusLabel = 'PENDIENTE') {
      const order = orderParam || loadPendingEnrollmentOrder();
      if (!order) {
        showToast('No hay factura disponible para descargar', 'warn');
        return;
      }

      try {
        await ensureJsPdfLoaded();
        const jsPDFCtor = window.jspdf?.jsPDF;
        if (!jsPDFCtor) throw new Error('No se pudo cargar el generador PDF');

        if (!MY_STUDENT && USER_ROLE === 'estudiante') {
          await loadMyStudent();
        }

        const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
        const left = 44;
        let y = 52;
        const line = (text, size = 11, weight = 'normal') => {
          doc.setFont('helvetica', weight);
          doc.setFontSize(size);
          doc.text(String(text), left, y);
          y += size + 8;
        };

        line('SGAU - Factura de Matricula', 18, 'bold');
        line(`Factura: ${order.invoiceId}`, 11, 'bold');
        line(`Fecha: ${new Date(order.createdAt || Date.now()).toLocaleString('es-CO')}`);
        line(`Estado: ${statusLabel}`);
        line(`Estudiante: ${MY_STUDENT?.nombre || USER_EMAIL || 'N/A'}`);
        line(`Referencia pago: ${paymentRef || order.payment_reference || 'Pendiente'}`);
        y += 4;

        doc.setDrawColor(180);
        doc.line(left, y, 560, y);
        y += 18;
        line('Detalle de materias', 12, 'bold');

        order.items.forEach((item, idx) => {
          const itemText = `${idx + 1}. ${item.code} - ${item.name} | Clase: ${item.sectionLabel || '-'} | Creditos: ${item.credits} | Valor: $${(item.cost || 0).toLocaleString('es-CO')}`;
          const wrapped = doc.splitTextToSize(itemText, 500);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.text(wrapped, left, y);
          y += wrapped.length * 13 + 2;
          if (y > 760) {
            doc.addPage();
            y = 52;
          }
        });

        y += 4;
        doc.line(left, y, 560, y);
        y += 20;
        line(`Total creditos: ${order.totalCredits}`, 12, 'bold');
        line(`Total pagado: $${(order.totalCost || 0).toLocaleString('es-CO')} COP`, 14, 'bold');
        line('Documento generado automaticamente por SGAU.', 9);

        doc.save(`${order.invoiceId}.pdf`);
        showToast('Factura PDF descargada', 'ok');
      } catch (error) {
        showToast(`No se pudo generar el PDF: ${error.message || error}`, 'err');
      }
    }

    function isValidWompiCheckoutUrl(url) {
      return typeof url === 'string' && /^https:\/\/checkout\.wompi\.co\/l\//i.test(url.trim());
    }

    async function resolveEnrollmentCheckoutUrl() {
      const order = loadPendingEnrollmentOrder();
      const pendingHistory = getPendingEnrollmentPaymentsFromHistory();
      const activeRef = getActiveEnrollmentPaymentReference() || order?.payment_reference || null;
      const selectedHistory = activeRef ? pendingHistory.find(p => p.reference === activeRef) : null;

      if (selectedHistory?.checkout_url && isValidWompiCheckoutUrl(selectedHistory.checkout_url)) {
        return selectedHistory.checkout_url;
      }

      if (order?.checkout_url && isValidWompiCheckoutUrl(order.checkout_url)) {
        return order.checkout_url;
      }

      if (!activeRef) return WOMPI_TEST_CHECKOUT_URL;

      const res = await fetch(`${API_BASE}/payments/status/${encodeURIComponent(activeRef)}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return WOMPI_TEST_CHECKOUT_URL;

      const data = await res.json().catch(() => ({}));
      const checkoutUrl = data.checkout_url || null;
      if (isValidWompiCheckoutUrl(checkoutUrl)) {
        if (order && String(order.payment_reference || '') === String(activeRef)) {
          order.checkout_url = checkoutUrl;
          savePendingEnrollmentOrder(order);
        }
        return checkoutUrl;
      }
      return WOMPI_TEST_CHECKOUT_URL;
    }

    async function openEnrollmentCheckout() {
      const checkoutUrl = await resolveEnrollmentCheckoutUrl();
      if (!checkoutUrl) {
        showToast('No se encontrÃ³ un checkout vÃ¡lido. Primero verifica el pago.', 'warn');
        return;
      }
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
    }

    function prefillPaymentFromPendingEnrollment() {
      const order = loadPendingEnrollmentOrder();
      const pendingHistory = getPendingEnrollmentPaymentsFromHistory();
      const activeRef = getActiveEnrollmentPaymentReference();
      const selectedHistory = activeRef
        ? pendingHistory.find(p => String(p.reference) === String(activeRef))
        : (pendingHistory[0] || null);

      if (selectedHistory?.reference) {
        setActiveEnrollmentPaymentReference(selectedHistory.reference);
      }

      const orderView = order || (selectedHistory ? {
        invoiceId: selectedHistory.invoiceId,
        createdAt: selectedHistory.created_at,
        status: 'awaiting_payment',
        totalCredits: 0,
        totalCost: Number(selectedHistory.amount || 0),
        concept: selectedHistory.concept,
        items: [],
        payment_reference: selectedHistory.reference,
        checkout_url: selectedHistory.checkout_url,
      } : null);

      const resultArea = document.getElementById('pay-result-area');
      if (!orderView) {
        if (resultArea) resultArea.innerHTML = '';
        return;
      }

      const orders = loadPendingEnrollmentOrders().filter(o => o.status !== 'enrolled');

      const amountInput = document.getElementById('pay-amount');
      if (amountInput) amountInput.value = String((selectedHistory?.amount ?? orderView.totalCost) || 0);

      const conceptSelect = document.getElementById('pay-concept');
      if (conceptSelect) {
        const conceptValue = selectedHistory?.concept || orderView.concept;
        const hasOption = Array.from(conceptSelect.options).some(opt => opt.value === conceptValue);
        if (!hasOption) {
          const opt = document.createElement('option');
          opt.value = conceptValue;
          opt.textContent = conceptValue;
          conceptSelect.appendChild(opt);
        }
        conceptSelect.value = conceptValue;
      }

      if (resultArea) {
        const activeReference = selectedHistory?.reference || orderView.payment_reference || null;
        const verifyBtn = activeReference
          ? `<button class="btn btn-secondary btn-sm" onclick="verifyEnrollmentCheckoutPayment('${activeReference}')">Verificar pago</button>`
          : '';
        const openBtn = activeReference
          ? `<button class="btn btn-primary btn-sm" onclick="openEnrollmentCheckout()">Abrir checkout</button>`
          : '';
        resultArea.innerHTML = `
          <div style="background:rgba(29,78,216,.08);border:1px solid rgba(29,78,216,.2);border-radius:10px;padding:.8rem;">
            ${pendingHistory.length > 1 ? `
            <div style="margin-bottom:.55rem;">
              <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:.25rem;">Seleccionar factura pendiente</label>
              <select style="width:100%;max-width:520px;" onchange="switchPendingEnrollmentPayment(this.value)">
                ${pendingHistory.map(p => `<option value="${p.reference}" ${String(p.reference) === String(activeReference) ? 'selected' : ''}>${p.invoiceId} Â· $${(p.amount || 0).toLocaleString('es-CO')} Â· ${new Date(p.created_at || Date.now()).toLocaleDateString('es-CO')}</option>`).join('')}
              </select>
            </div>` : ''}
            ${orders.length > 1 ? `
            <div style="margin-bottom:.55rem;">
              <label style="font-size:.78rem;color:var(--muted);display:block;margin-bottom:.25rem;">Factura activa</label>
              <select style="width:100%;max-width:420px;" onchange="switchPendingEnrollmentOrder(this.value)">
                ${orders.map(o => `<option value="${o.invoiceId}" ${o.invoiceId === orderView.invoiceId ? 'selected' : ''}>${o.invoiceId} Â· $${(o.totalCost || 0).toLocaleString('es-CO')} Â· ${(o.status || 'pending')}</option>`).join('')}
              </select>
            </div>` : ''}
            <div style="font-weight:600;color:var(--accent2);">Factura pendiente: ${orderView.invoiceId}</div>
            <div style="font-size:.85rem;color:var(--muted);margin-top:.2rem;">${orderView.items.length || '-'} materias Â· ${orderView.totalCredits || '-'} creditos Â· $${(selectedHistory?.amount ?? orderView.totalCost || 0).toLocaleString('es-CO')} COP</div>
            <div style="font-size:.78rem;color:var(--muted);margin-top:.25rem;">Despues del pago aprobado, la matricula se activa automaticamente.</div>
            <div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.6rem;">
              <button class="btn btn-secondary btn-sm" onclick="downloadEnrollmentInvoicePdf()">Descargar PDF</button>
              ${openBtn}
              ${verifyBtn}
            </div>
          </div>
        `;
      }
    }

    async function submitEnrollment() {
      const cart = Object.values(ENROLLMENT_CART);
      if (cart.length === 0) {
        showToast('âš  Selecciona al menos un curso', 'warn');
        return;
      }
      if (cart.some(c => c.requiresConcreteSection && !c.sectionId)) {
        showToast('âš  Debes elegir una clase para cada materia antes de confirmar', 'warn');
        return;
      }
      // ValidaciÃ³n previa
      let warnings = [];
      const codes = cart.map(c => c.code);
      const repeated = codes.filter((v, i, a) => a.indexOf(v) !== i);
      if (repeated.length > 0) warnings.push('Hay materias repetidas en el carrito.');
      for (const c of cart) {
        if (c.prerequisite_codes && c.prerequisite_codes.length > 0) {
          const faltan = c.prerequisite_codes.filter(code => !hasCompletedCourseCode(code));
          if (faltan.length > 0) warnings.push(`La materia ${c.code} requiere: ${faltan.join(', ')}`);
        }
      }
      // Cruces de horario
      for (let i = 0; i < cart.length; i++) {
        const a = cart[i];
        if (!a.day_of_week || !a.start_time || !a.end_time) continue;
        const aStart = timeToMinutes(a.start_time);
        const aEnd = timeToMinutes(a.end_time);
        for (let j = i + 1; j < cart.length; j++) {
          const b = cart[j];
          if (!b.day_of_week || !b.start_time || !b.end_time) continue;
          if (a.day_of_week !== b.day_of_week) continue;
          const bStart = timeToMinutes(b.start_time);
          const bEnd = timeToMinutes(b.end_time);
          if (aStart < bEnd && bStart < aEnd) {
            warnings.push(`Cruce de horario entre ${a.code} y ${b.code} (${a.day_of_week} ${a.start_time}-${a.end_time})`);
          }
        }
      }
      if (warnings.length > 0) {
        showToast('âš  Corrige los problemas antes de confirmar:\n' + warnings.join('\n'), 'warn');
        updateEnrollmentCart();
        return;
      }

      // Mostrar modal de pre-factura/resumen
      showEnrollmentSummaryModal(cart);
      return;
    }

    // Modal de resumen/pre-factura matrÃ­cula
    function showEnrollmentSummaryModal(cart) {
      const previewInvoice = buildEnrollmentInvoice(cart);
      window.__ENROLLMENT_INVOICE_PREVIEW = previewInvoice;
      let html = `<div style='font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;'>Resumen de MatrÃ­cula</div>`;
      html += `<div style='max-height:200px;overflow-y:auto;margin-bottom:1rem;'>`;
      html += `<table style='width:100%;font-size:0.95rem;'>`;
      html += `<thead><tr><th style='text-align:left;'>CÃ³digo</th><th style='text-align:left;'>Materia</th><th>Clase</th><th>CrÃ©ditos</th><th>Costo</th></tr></thead><tbody>`;
      let totalCred = 0;
      let totalCost = 0;
      for (const c of cart) {
        html += `<tr><td>${c.code}</td><td>${c.name}</td><td>${c.sectionLabel || '-'}</td><td style='text-align:center;'>${c.credits}</td><td style='text-align:right;'>$${c.cost.toLocaleString('es-CO')}</td></tr>`;
        totalCred += c.credits;
        totalCost += c.cost;
      }
      html += `</tbody></table></div>`;
      html += `<div style='font-weight:500;margin-bottom:0.5rem;'>Total crÃ©ditos: ${totalCred}</div>`;
      html += `<div style='font-weight:600;font-size:1.2rem;margin-bottom:1rem;'>Total a pagar: $${totalCost.toLocaleString('es-CO')}</div>`;
      html += `<div style='color:var(--muted);font-size:0.95rem;margin-bottom:1rem;'>Se generara una pre-factura y seras enviado a Pagos. La matricula se activa solo con pago aprobado.</div>`;
      html += `<div style='display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap;'><button class='btn btn-secondary' onclick='downloadEnrollmentInvoicePdf(window.__ENROLLMENT_INVOICE_PREVIEW, null, "PENDIENTE")'>Descargar PDF</button><button class='btn btn-secondary' onclick='closeModal()'>Cancelar</button><button class='btn btn-primary' onclick='proceedEnrollmentPayment()'>Confirmar matrÃ­cula</button></div>`;
      showModal(html);
    }

    function showModal(html) {
      let modal = document.getElementById('generic-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'generic-modal';
        modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0008;z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `<div id='generic-modal-content' style='background:#fff;padding:2rem 2.5rem;border-radius:10px;max-width:95vw;max-height:90vh;overflow:auto;box-shadow:0 8px 32px #0003;'></div>`;
        document.body.appendChild(modal);
        modal.onclick = function(e) { if (e.target === modal) closeModal(); };
      }
      document.getElementById('generic-modal-content').innerHTML = html;
      modal.style.display = 'flex';
    }

    function closeModal() {
      const modal = document.getElementById('generic-modal');
      if (modal) modal.style.display = 'none';
    }

    async function proceedEnrollmentPayment() {
      closeModal();

      const cart = Object.values(ENROLLMENT_CART);
      const msgEl = document.getElementById('enrollment-msg');
      if (!cart.length) {
        if (msgEl) msgEl.innerHTML = `<span style="color:var(--danger);">âœ— No hay materias en el carrito.</span>`;
        return;
      }

      const invoice = buildEnrollmentInvoice(cart);
      savePendingEnrollmentOrder(invoice);

      if (msgEl) {
        msgEl.innerHTML = `<span style="color:var(--accent2);">Factura ${invoice.invoiceId} generada. Continua en Pagos para completar la matricula.</span>`;
      }

      const payBtn = document.getElementById('nav-payment');
      goTo('payment', payBtn);
      setTimeout(() => prefillPaymentFromPendingEnrollment(), 120);
      showToast(`Factura ${invoice.invoiceId} lista para pago`, 'ok');
    }

    async function finalizePendingEnrollmentAfterPayment(session) {
      const order = loadPendingEnrollmentOrder();
      if (!order || order.status === 'enrolled') return;

      const resultArea = document.getElementById('pay-result-area');
      if (resultArea) {
        resultArea.innerHTML += `<div style="margin-top:.6rem;color:var(--muted);font-size:.85rem;">Activando matricula de ${order.items.length} materias...</div>`;
      }

      try {
        const items = order.items.map(item => ({
          course_id: item.course_id,
          section_id: item.section_id,
        }));

        const res = await fetch(`${API_BASE}/enrollments/me/batch`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Pago aprobado, pero no se pudo activar la matricula');
        }

        const result = await res.json().catch(() => ({}));
        order.status = 'enrolled';
        order.payment_reference = session?.reference || session?.payment_id || session?.session_token || null;
        order.enrolled_at = new Date().toISOString();
        savePendingEnrollmentOrder(order);

        ENROLLMENT_CART = {};
        updateEnrollmentCart();
        await loadMyCurrentEnrollments();
        await loadStudentDashboard();

        clearPendingEnrollmentOrder();
        if (resultArea) {
          resultArea.innerHTML += `<div style="margin-top:.5rem;color:var(--accent);font-weight:600;">âœ“ Matricula activada (${result.created || items.length} materias)</div>`;
        }
        showToast('âœ“ Pago aprobado y matricula activada', 'ok');
      } catch (e) {
        if (resultArea) {
          resultArea.innerHTML += `<div style="margin-top:.5rem;color:var(--danger);">âœ— ${e.message}</div><div style="font-size:.8rem;color:var(--muted);">Tu orden queda pendiente para reintentar la activacion.</div>`;
        }
        showToast(e.message, 'err');
      }
    }

    async function loadMyCurrentEnrollments() {
      if (!MY_STUDENT) return;

      try {
        COURSE_TEACHERS_CACHE.clear();
        const res = await fetch(`${API_BASE}/enrollments/me`, { headers: getAuthHeaders() });
        const tbody = document.getElementById('enrollments-tbody');
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">âš </div>No se pueden cargar materias</div></td></tr>';
          return;
        }

        const enrollments = await res.json();
        const currentEnrollments = Array.isArray(enrollments)
          ? enrollments.filter(e => isCurrentEnrollmentStatus(e?.status))
          : [];

        if (!currentEnrollments.length) {
          tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">ðŸ“­</div>No estÃ¡s inscrito en materias</div></td></tr>';
          return;
        }

        const details = await Promise.all(currentEnrollments.map(buildEnrollmentDetail));
        const rows = details.map(item => {
          const e = item.enrollment;
          return `
            <tr>
              <td>${item.courseCode}</td>
              <td>${item.courseLabel}</td>
              <td>${item.semester || '-'}</td>
              <td>${item.credits || '-'}</td>
              <td>${item.section || '-'}</td>
              <td>${item.scheduleLabel}${item.classroomLabel && item.classroomLabel !== 'Por definir' ? ` Â· <span style="font-size:0.85em;">${item.classroomLabel}</span>` : ''}</td>
              <td>${item.teacherLabel}</td>
              <td><span class="badge badge-activo">${e.status || 'pendiente'}</span></td>
            </tr>
          `;
        });

        tbody.innerHTML = rows.join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function buildEnrollmentDetailFromCache(enrollment) {
      const course = COURSES.find(c => c.id === enrollment.course_id);
      const sessions = await fetchCourseSessions(enrollment.course_id);
      const selectedSession = sessions.find(session => Number(session.id) === Number(enrollment.section_id));
      const teacher = enrollment.teacher_id ? await fetch(`${API_BASE}/academic/api/teachers/${enrollment.teacher_id}`, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : {}) : {};
      return {
        enrollment,
        courseCode: course?.code || enrollment.course_id,
        courseLabel: course?.name || 'Curso desconocido',
        semester: course?.semester || '-',
        credits: course?.credits || 0,
        section: selectedSession?.section || enrollment.section_id || '-',
        scheduleLabel: selectedSession?.day_of_week && selectedSession?.start_time && selectedSession?.end_time
          ? `${selectedSession.day_of_week} ${formatRange(selectedSession.start_time, selectedSession.end_time)}`
          : course?.day_of_week && course?.start_time && course?.end_time
          ? `${course.day_of_week} ${formatRange(course.start_time, course.end_time)}`
          : (course?.schedule || 'Por definir'),
        classroomLabel: selectedSession?.classroom || course?.location || 'Por definir',
        teacherLabel: teacher.name || teacher.nombre || 'Por asignar'
      };
    }

    async function loadMyProfile() {
      const title = document.querySelector('#sec-my-profile .section-title');
      const subtitle = document.querySelector('#sec-my-profile .section-subtitle');
      const profileProgramField = document.getElementById('profile-program-field');
      const profileProgram = document.getElementById('profile-program');
      const profileProgramLabel = document.getElementById('profile-program-label');
      const passwordFields = document.getElementById('profile-password-fields');

      const currentPasswordInput = document.getElementById('profile-current-password');
      const newPasswordInput = document.getElementById('profile-new-password');
      const confirmPasswordInput = document.getElementById('profile-confirm-password');
      if (currentPasswordInput) currentPasswordInput.value = '';
      if (newPasswordInput) newPasswordInput.value = '';
      if (confirmPasswordInput) confirmPasswordInput.value = '';
      if (profileProgramField) profileProgramField.style.display = '';
      else if (profileProgram?.parentElement) profileProgram.parentElement.style.display = '';
      if (profileProgramLabel?.parentElement) profileProgramLabel.parentElement.style.display = '';
      if (passwordFields) passwordFields.style.display = 'none';

      if (USER_ROLE === 'docente') {
        const teacher = await loadTeacherProfile();
        if (!teacher) {
          showToast('âœ— No se pudo cargar el perfil del docente', 'err');
          return;
        }

        MY_TEACHER = teacher;
        PROFILE_TARGET_STUDENT_ID = null;

        const fullName = (teacher.name || '').trim();
        let firstName = (teacher.first_name || '').trim();
        let lastName = (teacher.last_name || '').trim();
        if (!firstName && fullName) {
          const parts = fullName.split(/\s+/);
          firstName = parts.slice(0, 2).join(' ');
          lastName = parts.slice(2).join(' ');
        }

        document.getElementById('profile-nombre').value = firstName;
        document.getElementById('profile-apellido').value = lastName;

        if (profileProgramField) profileProgramField.style.display = 'none';
        else if (profileProgram?.parentElement) profileProgram.parentElement.style.display = 'none';
        if (profileProgramLabel?.parentElement) profileProgramLabel.parentElement.style.display = 'none';
        if (passwordFields) passwordFields.style.display = 'block';
        if (title) title.textContent = 'Mi Perfil Docente';
        if (subtitle) subtitle.textContent = 'Puedes actualizar nombres, apellidos y contraseÃ±a';
        return;
      }

      if (USER_ROLE === 'admin' && ADMIN_PROFILE_MODE !== 'student') {
        ADMIN_PROFILE_MODE = 'self';
        PROFILE_TARGET_STUDENT_ID = null;
        const authRes = await fetch(`${API_BASE}/auth/profile`, { headers: getAuthHeaders() });
        if (!authRes.ok) {
          showToast('âœ— No se pudo cargar el perfil de administrador', 'err');
          return;
        }

        const authData = await authRes.json();
        const account = authData?.usuario || {};
        document.getElementById('profile-nombre').value = account.first_name || '';
        document.getElementById('profile-apellido').value = account.last_name || '';
        if (profileProgramField) profileProgramField.style.display = 'none';
        else if (profileProgram?.parentElement) profileProgram.parentElement.style.display = 'none';
        if (profileProgramLabel?.parentElement) profileProgramLabel.parentElement.style.display = 'none';
        if (passwordFields) passwordFields.style.display = 'block';
        if (title) title.textContent = 'Mi Perfil';
        if (subtitle) subtitle.textContent = 'InformaciÃ³n personal';
        return;
      }

      if (USER_ROLE === 'admin' && ADMIN_PROFILE_MODE === 'student' && PROFILE_TARGET_STUDENT_ID) {
        ADMIN_PROFILE_MODE = 'student';
        await editStudentProfileAsAdmin(PROFILE_TARGET_STUDENT_ID);
        return;
      }

      if (!MY_STUDENT) {
        await loadMyStudent();
      }
      if (!MY_STUDENT) return;

      PROFILE_TARGET_STUDENT_ID = MY_STUDENT.id;
      document.getElementById('profile-nombre').value = MY_STUDENT.nombre || '';
      document.getElementById('profile-apellido').value = MY_STUDENT.apellido || '';
      if (profileProgram) {
        profileProgram.value = MY_STUDENT.program || '';
        profileProgram.disabled = USER_ROLE === 'estudiante';
      }
      if (USER_ROLE === 'estudiante') {
        if (profileProgramField) profileProgramField.style.display = 'none';
        else if (profileProgram?.parentElement) profileProgram.parentElement.style.display = 'none';
      }
      if (title) title.textContent = 'Mi Perfil';
      if (subtitle) subtitle.textContent = 'InformaciÃ³n personal';
    }

    async function updateProfile() {
      const isAdminSelfProfile = USER_ROLE === 'admin' && ADMIN_PROFILE_MODE === 'self';
      const targetId = USER_ROLE === 'docente' ? null : (isAdminSelfProfile ? null : MY_STUDENT?.id || PROFILE_TARGET_STUDENT_ID);

      if (USER_ROLE !== 'docente' && !isAdminSelfProfile && !targetId) {
        showToast('âœ— Selecciona un estudiante para editar', 'err');
        return;
      }

      const nombre = document.getElementById('profile-nombre').value.trim();
      const apellido = document.getElementById('profile-apellido').value.trim();
      const program = document.getElementById('profile-program').value;

      if (!nombre || !apellido) {
        showToast('Completa nombre y apellido', 'err');
        return;
      }

      if (USER_ROLE === 'docente' || isAdminSelfProfile) {
        const currentPassword = (document.getElementById('profile-current-password')?.value || '').trim();
        const newPassword = (document.getElementById('profile-new-password')?.value || '').trim();
        const confirmPassword = (document.getElementById('profile-confirm-password')?.value || '').trim();

        if ((currentPassword || newPassword || confirmPassword) && (!currentPassword || !newPassword || !confirmPassword)) {
          showToast('Completa los 3 campos de contraseÃ±a para cambiarla', 'err');
          return;
        }
        if (newPassword && newPassword.length < 8) {
          showToast('La nueva contraseÃ±a debe tener mÃ­nimo 8 caracteres', 'err');
          return;
        }
        if (newPassword && newPassword !== confirmPassword) {
          showToast('La confirmaciÃ³n de contraseÃ±a no coincide', 'err');
          return;
        }

        if (USER_ROLE === 'docente') {
          const teacher = await loadTeacherProfile();
          if (!teacher?.id) {
            showToast('âœ— No se encontrÃ³ el perfil docente', 'err');
            return;
          }

          try {
            const teacherRes = await fetch(`${API_BASE}/academic/api/teachers/${teacher.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders(),
              },
              body: JSON.stringify({
                first_name: nombre,
                last_name: apellido,
                name: `${nombre} ${apellido}`.trim(),
              }),
            });

            if (!teacherRes.ok) {
              const data = await teacherRes.json().catch(() => null);
              showToast(data?.detail || 'âœ— No se pudo actualizar el perfil docente', 'err');
              return;
            }

            const authPayload = {
              first_name: nombre,
              last_name: apellido,
            };
            if (newPassword) {
              authPayload.current_password = currentPassword;
              authPayload.new_password = newPassword;
            }

            const authRes = await fetch(`${API_BASE}/auth/me`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders(),
              },
              body: JSON.stringify(authPayload),
            });

            if (!authRes.ok) {
              const data = await authRes.json().catch(() => null);
              showToast(data?.detail || 'âœ— No se pudo actualizar la contraseÃ±a', 'err');
              return;
            }

            MY_TEACHER = {
              ...teacher,
              first_name: nombre,
              last_name: apellido,
              name: `${nombre} ${apellido}`.trim(),
            };
            await setTeacherUserInfo();

            document.getElementById('profile-current-password').value = '';
            document.getElementById('profile-new-password').value = '';
            document.getElementById('profile-confirm-password').value = '';

            showToast(newPassword ? 'âœ“ Perfil y contraseÃ±a actualizados' : 'âœ“ Perfil actualizado', 'ok');
            return;
          } catch (e) {
            showToast('âœ— Error de conexiÃ³n', 'err');
            return;
          }
        }

        try {
          const authPayload = {
            first_name: nombre,
            last_name: apellido,
          };
          if (newPassword) {
            authPayload.current_password = currentPassword;
            authPayload.new_password = newPassword;
          }

          const authRes = await fetch(`${API_BASE}/auth/me`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            body: JSON.stringify(authPayload),
          });

          if (!authRes.ok) {
            const data = await authRes.json().catch(() => null);
            showToast(data?.detail || 'âœ— No se pudo actualizar la contraseÃ±a', 'err');
            return;
          }

          document.getElementById('profile-current-password').value = '';
          document.getElementById('profile-new-password').value = '';
          document.getElementById('profile-confirm-password').value = '';

          showToast(newPassword ? 'âœ“ Perfil y contraseÃ±a actualizados' : 'âœ“ Perfil actualizado', 'ok');
          return;
        } catch (e) {
          showToast('âœ— Error de conexiÃ³n', 'err');
          return;
        }
      }

      const payload = {
        nombre,
        apellido,
      };

      if (USER_ROLE === 'admin') {
        payload.program = program || null;
      }

      try {
        const res = await fetch(`${API_BASE}/students/${targetId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const updated = await res.json();
          if (USER_ROLE === 'estudiante') {
            MY_STUDENT = updated;
            document.getElementById('student-program-text').textContent = `Programa: ${MY_STUDENT.program || 'Sin programa'}`;
          }
          showToast('âœ“ Perfil actualizado', 'ok');
          loadStudents();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al actualizar', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function checkHealth() {
      try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
          const data = await response.json();
          showToast('âœ“ Sistema operacional', 'ok');
          updateStatus(data.services || {});
        } else {
          showToast('âœ— Error del sistema', 'err');
        }
      } catch (e) {
        showToast('âœ— No se puede conectar', 'err');
      }
    }

    function updateStatus(services = {}) {
      const mapping = [
        { id: 'auth', name: 'auth-service' },
        { id: 'student', name: 'student-service' },
        { id: 'academic', name: 'academic-service' },
        { id: 'enrollment', name: 'enrollment-service' },
        { id: 'grades', name: 'grades-service' },
        { id: 'payment', name: 'payment-service' },
        { id: 'reporting', name: 'reporting-service' },
      ];

      mapping.forEach(svc => {
        const dot = document.getElementById(`dot-${svc.id}`);
        const label = document.getElementById(`label-${svc.id}`);
        const stat = document.getElementById(`stat-${svc.id}`);
        const state = services[svc.name];

        if (state === 'ok') {
          dot.classList.remove('down');
          dot.classList.add('ok');
          label.textContent = `${svc.id} âœ“`;
          if (stat) stat.textContent = 'OK';
        } else {
          dot.classList.remove('ok');
          dot.classList.add('down');
          label.textContent = `${svc.id} âœ—`;
          if (stat) stat.textContent = 'NA';
        }
      });
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // GRADES MODULE â€“ estado global
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    /** Wrapper de fetch que inyecta el token de autorizaciÃ³n automÃ¡ticamente */
    async function apiFetch(url, options = {}) {
      const opts = { ...options };
      opts.headers = { ...getAuthHeaders(), ...(options.headers || {}) };
      return fetch(url, opts);
    }

    const gradesState = {
      currentGradebook: null,
      components: [],
      rosterData: null,
      overrideFinalId: null,
      currentGradeInputStudentId: null,
    };

    function initGradesSection(role) {
      document.getElementById('grades-teacher-panel').style.display = (role === 'docente') ? '' : 'none';
      document.getElementById('grades-student-panel').style.display = (role === 'estudiante') ? '' : 'none';
      document.getElementById('grades-admin-panel').style.display = (role === 'admin') ? '' : 'none';
    }

    // â”€â”€ Docente: listar gradebooks propios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadGradebooks() {
      const period = document.getElementById('gb-period').value.trim();
      const courseId = document.getElementById('gb-course-filter').value.trim();
      const section = document.getElementById('gb-section-filter').value.trim();
      let url = `${API_BASE}/grades/gradebooks?`;
      if (period) url += `period=${encodeURIComponent(period)}&`;
      if (courseId) url += `course_id=${courseId}&`;
      if (section) url += `section=${encodeURIComponent(section)}&`;

      const res = await apiFetch(url);
      const tbody = document.getElementById('gradebooks-tbody');
      if (!res.ok) { tbody.innerHTML = `<tr><td colspan="6">Error cargando libros</td></tr>`; return; }
      const data = await res.json();
      if (!data.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="big">â—Œ</div>No hay libros para este filtro.</div></td></tr>`; return; }

      const statusLabel = { draft: 'ðŸ“ Borrador', published: 'ðŸ“¢ Publicado', closed: 'ðŸ”’ Cerrado' };
      tbody.innerHTML = data.map(gb => `
        <tr>
          <td>${gb.id}</td>
          <td>${gb.course_id}</td>
          <td>${gb.period}</td>
          <td>${gb.section}</td>
          <td>${statusLabel[gb.status] || gb.status}</td>
          <td><button class="btn btn-primary btn-sm" onclick="openGradebook(${gb.id})">Abrir</button></td>
        </tr>`).join('');
    }

    function showCreateGradebookModal() {
      const period = document.getElementById('gb-period').value.trim();
      if (period) document.getElementById('new-gb-period').value = period;
      document.getElementById('modal-new-gradebook').style.display = 'flex';
    }

    async function createGradebook() {
      const courseId = parseInt(document.getElementById('new-gb-course').value);
      const period = document.getElementById('new-gb-period').value.trim();
      const section = document.getElementById('new-gb-section').value.trim() || 'A';
      if (!courseId || !period) { showToast('Completa curso y perÃ­odo', 'error'); return; }

      const res = await apiFetch(`${API_BASE}/grades/gradebooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: courseId, period, section }),
      });
      document.getElementById('modal-new-gradebook').style.display = 'none';
      if (res.ok) {
        showToast('Libro creado exitosamente', 'success');
        loadGradebooks();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Error creando libro', 'error');
      }
    }

    async function openGradebook(gradebookId) {
      const res = await apiFetch(`${API_BASE}/grades/gradebooks?`);
      // Obtener detalle del gradebook directamente desde la lista
      const listRes = await apiFetch(`${API_BASE}/grades/gradebooks`);
      const list = listRes.ok ? await listRes.json() : [];
      gradesState.currentGradebook = list.find(g => g.id === gradebookId) || { id: gradebookId };

      document.getElementById('gradebook-detail').style.display = '';
      document.getElementById('gradebook-detail-title').textContent =
        `Libro #${gradebookId} â€” Curso ${gradesState.currentGradebook.course_id}`;
      document.getElementById('gradebook-detail-meta').textContent =
        `PerÃ­odo ${gradesState.currentGradebook.period} Â· SecciÃ³n ${gradesState.currentGradebook.section} Â· Estado: ${gradesState.currentGradebook.status}`;

      const isClosed = gradesState.currentGradebook.status === 'closed';
      document.getElementById('btn-recalc').disabled = isClosed;
      document.getElementById('btn-publish').disabled = isClosed;
      document.getElementById('btn-close-gb').disabled = isClosed;
      document.getElementById('add-component-panel').style.opacity = isClosed ? '0.4' : '1';
      document.getElementById('add-component-panel').style.pointerEvents = isClosed ? 'none' : '';

      await loadComponents();
      await loadRoster();
    }

    function closeGradebookDetail() {
      gradesState.currentGradebook = null;
      document.getElementById('gradebook-detail').style.display = 'none';
    }

    // â”€â”€ Componentes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadComponents() {
      const gbId = gradesState.currentGradebook?.id;
      if (!gbId) return;
      const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/components`);
      if (!res.ok) return;
      gradesState.components = await res.json();
      renderComponents();
    }

    function renderComponents() {
      const container = document.getElementById('components-list');
      const totalWeight = gradesState.components.reduce((s, c) => s + c.weight, 0);
      const fill = document.getElementById('weight-fill');
      const info = document.getElementById('weight-info');

      fill.style.width = Math.min(totalWeight, 100) + '%';
      fill.style.background = totalWeight === 100 ? 'var(--accent)' : totalWeight > 100 ? 'var(--danger)' : 'var(--warn)';
      info.textContent = `Peso acumulado: ${totalWeight}% de 100% requerido`;

      if (!gradesState.components.length) {
        container.innerHTML = `<span style="color:var(--muted);font-size:.85rem;">Sin componentes aÃºn.</span>`;
        return;
      }
      container.innerHTML = gradesState.components.map(c => `
        <span style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:.85rem;">
          ${c.name} <strong>${c.weight}%</strong>
        </span>`).join('');
    }

    async function addComponent() {
      const gbId = gradesState.currentGradebook?.id;
      const name = document.getElementById('comp-name').value.trim();
      const weight = parseFloat(document.getElementById('comp-weight').value);
      if (!name || !weight) { showToast('Nombre y peso son requeridos', 'error'); return; }

      const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, weight, order_index: gradesState.components.length + 1 }),
      });
      if (res.ok) {
        document.getElementById('comp-name').value = '';
        document.getElementById('comp-weight').value = '';
        showToast('Componente agregado', 'success');
        await loadComponents();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Error agregando componente', 'error');
      }
    }

    // â”€â”€ Roster â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadRoster() {
      const gbId = gradesState.currentGradebook?.id;
      if (!gbId) return;
      const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/roster`);
      const tbody = document.getElementById('roster-tbody');
      const thead = document.getElementById('roster-thead');

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        tbody.innerHTML = `<tr><td colspan="10" style="color:var(--danger);">${err.detail || 'Error cargando roster'}</td></tr>`;
        return;
      }
      const data = await res.json();
      gradesState.rosterData = data;

      const comps = gradesState.components;
      const statusLabel = { draft: 'Borrador', published: 'Publicado', closed: 'Cerrado', sin_notas: 'â€”' };
      const isClosed = gradesState.currentGradebook?.status === 'closed';

      // Cabecera dinÃ¡mica con componentes
      thead.innerHTML = `<tr>
        <th>Estudiante ID</th>
        ${comps.map(c => `<th>${c.name}<br><small style="color:var(--muted);">${c.weight}%</small></th>`).join('')}
        <th>Definitiva</th><th>AprobÃ³</th><th>Estado</th>
        ${isClosed ? '' : '<th>Acciones</th>'}
      </tr>`;

      if (!data.roster.length) {
        tbody.innerHTML = `<tr><td colspan="${4 + comps.length}"><div class="empty-state"><div class="big">â—Œ</div>No hay estudiantes matriculados en este curso.</div></td></tr>`;
        return;
      }

      tbody.innerHTML = data.roster.map(row => {
        const itemsMap = {};
        (row.items || []).forEach(i => { itemsMap[i.component_id] = i.score; });
        const scoreColor = row.final_score === null ? 'var(--muted)'
          : row.final_score >= data.pass_mark ? 'var(--accent)' : 'var(--danger)';
        return `<tr>
          <td><strong>${row.student_id}</strong></td>
          ${comps.map(c => {
            const s = itemsMap[c.id];
            return `<td style="text-align:center;">${s !== undefined ? s.toFixed(1) : '<span style="color:var(--muted)">â€”</span>'}</td>`;
          }).join('')}
          <td style="text-align:center;font-weight:700;color:${scoreColor};">${row.final_score !== null ? row.final_score.toFixed(1) : 'â€”'}</td>
          <td style="text-align:center;">${row.passed === null ? 'â€”' : row.passed ? 'âœ…' : 'âŒ'}</td>
          <td>${statusLabel[row.status] || row.status}</td>
          ${isClosed ? '' : `<td style="display:flex;gap:.35rem;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="openGradeInput(${row.student_id})">âœï¸ Notas</button>
            ${row.final_score !== null ? `<button class="btn btn-secondary btn-sm" onclick="openOverride(${row.student_id})">âš¡ Ajustar</button>` : ''}
          </td>`}
        </tr>`;
      }).join('');
    }

    // â”€â”€ Ingreso de notas por componente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function openGradeInput(studentId) {
      gradesState.currentGradeInputStudentId = studentId;
      const comps = gradesState.components;
      const roster = gradesState.rosterData?.roster || [];
      const row = roster.find(r => r.student_id === studentId);
      const itemsMap = {};
      (row?.items || []).forEach(i => { itemsMap[i.component_id] = i.score; });

      document.getElementById('grade-input-title').textContent = `âœï¸ Notas â€” Estudiante ${studentId}`;
      document.getElementById('grade-input-fields').innerHTML = comps.map(c => `
        <div class="form-group">
          <label>${c.name} (${c.weight}%)</label>
          <input id="score-comp-${c.id}" type="number" step="0.1" min="0" max="5"
            value="${itemsMap[c.id] !== undefined ? itemsMap[c.id] : ''}" placeholder="0.0 â€“ 5.0" />
        </div>`).join('');
      document.getElementById('modal-grade-input').style.display = 'flex';
    }

    async function saveGradeItems() {
      const gbId = gradesState.currentGradebook?.id;
      const studentId = gradesState.currentGradeInputStudentId;
      const comps = gradesState.components;
      let hadError = false;

      for (const c of comps) {
        const val = document.getElementById(`score-comp-${c.id}`)?.value;
        if (val === '' || val === null || val === undefined) continue;
        const score = parseFloat(val);
        if (isNaN(score)) continue;

        const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/items/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ component_id: c.id, items: [{ student_id: studentId, score }] }),
        });
        if (!res.ok) { hadError = true; }
      }

      document.getElementById('modal-grade-input').style.display = 'none';
      if (hadError) {
        showToast('Algunas notas no se pudieron guardar', 'error');
      } else {
        showToast('Notas guardadas. Recalcula para actualizar la definitiva.', 'success');
      }
      await loadRoster();
    }

    // â”€â”€ Override manual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function openOverride(studentId) {
      const roster = gradesState.rosterData?.roster || [];
      const row = roster.find(r => r.student_id === studentId);
      gradesState.overrideFinalId = row?._final_id || null;
      gradesState.overrideStudentId = studentId;
      document.getElementById('override-score').value = row?.final_score || '';
      document.getElementById('override-reason').value = '';
      document.getElementById('modal-override').style.display = 'flex';
    }

    async function submitOverride() {
      const score = parseFloat(document.getElementById('override-score').value);
      const reason = document.getElementById('override-reason').value.trim();
      if (isNaN(score) || !reason) { showToast('Completa nota y motivo', 'error'); return; }

      // Primero recalcular para obtener el final_grade id real
      const gbId = gradesState.currentGradebook?.id;
      const recalcRes = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/recalculate`, { method: 'POST' });
      if (!recalcRes.ok) { showToast('Error al recalcular antes de ajuste', 'error'); return; }
      const finals = await recalcRes.json();
      const finalEntry = finals.find(f => f.student_id === gradesState.overrideStudentId);
      if (!finalEntry) { showToast('No se encontrÃ³ la definitiva', 'error'); return; }

      const res = await apiFetch(`${API_BASE}/grades/finals/${finalEntry.id}/override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_score: score, reason }),
      });
      document.getElementById('modal-override').style.display = 'none';
      if (res.ok) {
        showToast(`Definitiva ajustada a ${score.toFixed(1)}`, 'success');
        await loadRoster();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Error en ajuste', 'error');
      }
    }

    // â”€â”€ Recalcular â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function recalcuateGrades() {
      const gbId = gradesState.currentGradebook?.id;
      const totalWeight = gradesState.components.reduce((s, c) => s + c.weight, 0);
      if (Math.round(totalWeight) !== 100) {
        showToast(`Los componentes suman ${totalWeight}%, deben sumar 100%`, 'error'); return;
      }
      const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/recalculate`, { method: 'POST' });
      if (res.ok) {
        showToast('Definitivas recalculadas', 'success');
        await loadRoster();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Error al recalcular', 'error');
      }
    }

    // â”€â”€ Estado del libro â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function setGradebookStatus(newStatus) {
      const gbId = gradesState.currentGradebook?.id;
      const messages = { published: 'publicar', closed: 'cerrar definitivamente' };
      if (!confirm(`Â¿Seguro que deseas ${messages[newStatus] || newStatus} este libro?`)) return;

      const res = await apiFetch(`${API_BASE}/grades/gradebooks/${gbId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json();
        gradesState.currentGradebook = updated;
        showToast(`Libro ${newStatus === 'published' ? 'publicado' : 'cerrado'}`, 'success');
        document.getElementById('gradebook-detail-meta').textContent =
          `PerÃ­odo ${updated.period} Â· SecciÃ³n ${updated.section} Â· Estado: ${updated.status}`;
        const isClosed = updated.status === 'closed';
        document.getElementById('btn-recalc').disabled = isClosed;
        document.getElementById('btn-publish').disabled = isClosed;
        document.getElementById('btn-close-gb').disabled = isClosed;
        document.getElementById('add-component-panel').style.opacity = isClosed ? '0.4' : '1';
        document.getElementById('add-component-panel').style.pointerEvents = isClosed ? 'none' : '';
        await loadRoster();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Error cambiando estado', 'error');
      }
    }

    // â”€â”€ Vista estudiante â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadMyGrades() {
      const container = document.getElementById('my-grades-content');
      container.innerHTML = `<div class="empty-state"><div class="big">â—Œ</div>Cargando calificaciones...</div>`;

      try {
        const currentCourses = await getMyCurrentCourses();
        if (!currentCourses.length) {
          container.innerHTML = `<div class="empty-state"><div class="big">ðŸ“­</div>No tienes materias activas en este momento.</div>`;
          return;
        }

        const byCourse = await Promise.all(currentCourses.map(async course => {
          const boxesRes = await apiFetch(`${API_BASE}/grades/buzones?course_id=${course.id}`);
          if (!boxesRes.ok) return { course, gradedSubmissions: [] };

          const boxes = await boxesRes.json();
          const gradedSubmissions = [];

          await Promise.all((boxes || []).map(async box => {
            const subRes = await apiFetch(`${API_BASE}/grades/buzones/${box.id}/my-submission`);
            if (!subRes.ok) return;
            const sub = await subRes.json();
            if (sub && sub.score != null) {
              gradedSubmissions.push({ box, submission: sub });
            }
          }));

          gradedSubmissions.sort((a, b) => {
            const da = a.submission?.graded_at || a.submission?.submitted_at || '';
            const db = b.submission?.graded_at || b.submission?.submitted_at || '';
            return da < db ? 1 : -1;
          });

          return { course, gradedSubmissions };
        }));

        const coursesWithGrades = byCourse.filter(c => c.gradedSubmissions.length > 0);
        if (!coursesWithGrades.length) {
          container.innerHTML = `<div class="empty-state"><div class="big">ðŸ“š</div>AÃºn no tienes actividades calificadas en tus materias activas.</div>`;
          return;
        }

        container.innerHTML = coursesWithGrades.map(({ course, gradedSubmissions }) => {
          const average = gradedSubmissions.reduce((sum, item) => sum + Number(item.submission.score || 0), 0) / gradedSubmissions.length;
          return `
            <div style="border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem;background:var(--surface2);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
                <div>
                  <div style="font-weight:600;font-size:1rem;">${escapeHtml(`${course.code} ${course.name}`.trim())}</div>
                  <div style="font-size:.8rem;color:var(--muted);">${gradedSubmissions.length} actividad(es) calificadas</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:2rem;font-weight:700;color:${average >= 3 ? 'var(--accent)' : 'var(--danger)'};">${average.toFixed(1)}</div>
                  <div style="font-size:.8rem;color:var(--muted);">Promedio actividades</div>
                </div>
              </div>
              <table class="table" style="font-size:.85rem;">
                <thead><tr><th>Actividad</th><th>Entrega</th><th>Nota</th><th>Comentario docente</th></tr></thead>
                <tbody>
                  ${gradedSubmissions.map(({ box, submission }) => `
                    <tr>
                      <td>${escapeHtml(box.title || `BuzÃ³n ${box.id}`)}</td>
                      <td>${submission.submitted_at ? new Date(submission.submitted_at).toLocaleString('es-CO') : 'â€”'}</td>
                      <td style="text-align:center;font-weight:700;color:${Number(submission.score) >= 3 ? 'var(--accent)' : 'var(--danger)'};">${Number(submission.score).toFixed(1)}</td>
                      <td>${escapeHtml(submission.teacher_comment || 'â€”')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`;
        }).join('');
      } catch (e) {
        container.innerHTML = `<div style="color:var(--danger);">Error cargando calificaciones</div>`;
        return;
      }
    }

    // â”€â”€ Vista admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadAdminGradebooks() {
      const period = document.getElementById('admin-gb-period').value.trim();
      let url = `${API_BASE}/grades/gradebooks?`;
      if (period) url += `period=${encodeURIComponent(period)}`;
      const res = await apiFetch(url);
      const tbody = document.getElementById('admin-gradebooks-tbody');
      if (!res.ok) { tbody.innerHTML = `<tr><td colspan="7">Error</td></tr>`; return; }
      const data = await res.json();
      const statusLabel = { draft: 'ðŸ“ Borrador', published: 'ðŸ“¢ Publicado', closed: 'ðŸ”’ Cerrado' };
      tbody.innerHTML = data.map(gb => `
        <tr>
          <td>${gb.id}</td><td>${gb.course_id}</td><td>${gb.period}</td><td>${gb.section}</td>
          <td>${gb.teacher_user_id || 'â€”'}</td>
          <td>${statusLabel[gb.status] || gb.status}</td>
          <td><button class="btn btn-primary btn-sm" onclick="openGradebook(${gb.id})">Abrir</button></td>
        </tr>`).join('') || `<tr><td colspan="7"><div class="empty-state"><div class="big">â—Œ</div>Sin libros.</div></td></tr>`;
    }

    async function loadGrades() {
      // compatibilidad con cÃ³digo anterior (health check)
      try {
        const res = await fetch(`${API_BASE}/grades/health`);
        return res.ok;
      } catch { return false; }
    }


    async function loadReports() {
      // ya no se usa el botÃ³n genÃ©rico, pero se mantiene por compatibilidad
    }

    // â”€â”€ Descargar reporte de estudiante o curso (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function downloadReport(type, format) {
      const isStudent = type === 'student';
      const msgId   = isStudent ? 'rpt-student-msg' : 'rpt-course-msg';
      const msgEl = document.getElementById(msgId);

      let id = null;

      if (isStudent) {
        // CÃ©dula: buscar estudiante y obtener su ID
        const cedula = document.getElementById('rpt-student-id')?.value?.trim();
        if (!cedula) {
          msgEl.innerHTML = `<span style="color:var(--danger)">âš  Ingresa una cÃ©dula.</span>`;
          return;
        }
        
        // Buscar estudiante por cÃ©dula
        try {
          const students = await fetch(`${API_BASE}/students?limit=10000`, { headers: getAuthHeaders() }).then(r => r.json());
          const student = students.find(s => String(s.id_estudiante || s.cedula) === String(cedula) || 
                                            String(s.id) === String(cedula));
          if (!student) {
            msgEl.innerHTML = `<span style="color:var(--danger)">âœ— Estudiante no encontrado.</span>`;
            return;
          }
          id = student.id;
        } catch (e) {
          msgEl.innerHTML = `<span style="color:var(--danger)">âœ— Error al buscar estudiante.</span>`;
          return;
        }
      } else {
        // Curso: usar el ID seleccionado en el select
        id = document.getElementById('rpt-course-id')?.value?.trim();
        if (!id || isNaN(Number(id)) || Number(id) < 1) {
          msgEl.innerHTML = `<span style="color:var(--danger)">âš  Selecciona un curso.</span>`;
          return;
        }
      }

      msgEl.innerHTML = `<span style="color:var(--muted)">Generando ${format.toUpperCase()}â€¦</span>`;

      try {
        const url = `${API_BASE}/reports/${type}/${id}/export?format=${format}`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          msgEl.innerHTML = `<span style="color:var(--danger)">âœ— ${detail.detail || 'Error al generar informe.'}</span>`;
          return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `reporte_${type}_${id}.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
        msgEl.innerHTML = `<span style="color:var(--accent)">âœ“ Descarga iniciada.</span>`;
      } catch (e) {
        msgEl.innerHTML = `<span style="color:var(--danger)">âœ— Error de conexiÃ³n.</span>`;
      }
    }

    // â”€â”€ Descargar mi propio reporte (estudiante) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function downloadMyReport(format) {
      const msgEl = document.getElementById('rpt-me-msg');
      msgEl.innerHTML = `<span style="color:var(--muted)">Generando ${format.toUpperCase()}â€¦</span>`;

      try {
        if (!MY_STUDENT) await loadMyStudent();
        const studentId = MY_STUDENT?.id;
        if (!studentId) {
          msgEl.innerHTML = `<span style="color:var(--danger)">âœ— No se pudo obtener tu perfil.</span>`;
          return;
        }
        const url = `${API_BASE}/reports/student/${studentId}/export?format=${format}`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          msgEl.innerHTML = `<span style="color:var(--danger)">âœ— ${detail.detail || 'Error al generar informe.'}</span>`;
          return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mi_informe.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
        msgEl.innerHTML = `<span style="color:var(--accent)">âœ“ Descarga iniciada.</span>`;
      } catch (e) {
        msgEl.innerHTML = `<span style="color:var(--danger)">âœ— Error de conexiÃ³n.</span>`;
      }
    }

    // â”€â”€ Llenar filtros de carrera y curso para reporte de curso â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadReportFilters() {
      const careerSel = document.getElementById('rpt-course-career');
      const courseSel = document.getElementById('rpt-course-id');
      if (!careerSel || !courseSel) return;

      try {
        const careers = ACADEMIC_CAREERS || [];
        careerSel.innerHTML = '<option value="">â€” Selecciona carrera â€”</option>' +
          careers.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
      } catch (e) {
        console.error('Error cargando carreras:', e);
      }
    }

    async function loadReportCoursesByCareer() {
      const careerId = document.getElementById('rpt-course-career')?.value;
      const courseSel = document.getElementById('rpt-course-id');
      if (!careerId || !courseSel) return;

      courseSel.innerHTML = '<option value="">Cargando cursos...</option>';
      try {
        const courses = COURSES.filter(c => c.career_id == careerId);
        if (courses.length === 0) {
          courseSel.innerHTML = '<option value="">No hay cursos en esta carrera</option>';
          return;
        }
        courseSel.innerHTML = '<option value="">â€” Selecciona curso â€”</option>' +
          courses.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
      } catch (e) {
        courseSel.innerHTML = '<option value="">Error cargando cursos</option>';
        console.error('Error:', e);
      }
    }

    async function loadPayment() {
      loadPaymentSection();
    }

    // â”€â”€â”€ MÃ³dulo de pagos completo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    let CURRENT_PAY_METHOD = 'pse';
    let ACTIVE_PSE_SESSION = null;
    let NEQUI_POLL_INTERVAL = null;
    let PSE_WINDOW = null;

    function selectPayMethod(method, btn) {
      CURRENT_PAY_METHOD = method;
      document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');

      document.querySelectorAll('.pay-method-fields').forEach(el => el.style.display = 'none');
      const fields = document.getElementById(`pay-fields-${method === 'bancolombia' ? 'pse' : method}`);
      if (fields) fields.style.display = 'block';
      document.getElementById('pay-result-area').innerHTML = '';
    }

    function formatCardNumber(input) {
      let val = input.value.replace(/\D/g, '').substring(0, 16);
      input.value = val.replace(/(.{4})/g, '$1 ').trim();
    }

    async function loadPaymentSection() {
      // Determinar quÃ© panel mostrar
      document.getElementById('payment-student-panel').style.display = 'none';
      document.getElementById('payment-admin-panel').style.display = 'none';
      document.getElementById('payment-generic-panel').style.display = 'none';
      document.getElementById('payment-summary-cards').style.display = 'none';

      if (!TOKEN) {
        document.getElementById('payment-generic-panel').style.display = 'block';
        return;
      }

      if (USER_ROLE === 'estudiante') {
        document.getElementById('payment-student-panel').style.display = 'block';
        document.getElementById('payment-summary-cards').style.display = 'grid';
        await Promise.all([loadPaymentSummary(), loadPaymentHistory(), loadBankList()]);
        prefillPaymentFromPendingEnrollment();
      } else if (USER_ROLE === 'admin') {
        document.getElementById('payment-admin-panel').style.display = 'block';
        await loadPaymentServiceStatus();
      } else {
        document.getElementById('payment-generic-panel').style.display = 'block';
        await loadPaymentServiceStatus();
      }
    }

    async function loadPaymentSummary() {
      try {
        const res = await fetch(`${API_BASE}/payments/me/summary`, { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          const fmt = n => `$${(n||0).toLocaleString('es-CO')}`;
          setText('pay-stat-debt', fmt(data.total_debt));
          setText('pay-stat-paid', fmt(data.total_paid));
          setText('pay-stat-balance', fmt(data.balance));
          setText('pay-stat-status', data.status || 'â€”');
        } else if (res.status === 404) {
          setText('pay-stat-debt', '$0');
          setText('pay-stat-paid', '$0');
          setText('pay-stat-balance', '$0');
          setText('pay-stat-status', 'Sin cuenta');
        }
      } catch (e) { /* ignorar */ }
    }

    async function loadBankList() {
      try {
        const res = await fetch(`${API_BASE}/payments/banks`);
        if (res.ok) {
          const banks = await res.json();
          const sel = document.getElementById('pay-bank');
          if (sel) {
            sel.innerHTML = '<option value="">Selecciona tu banco</option>' +
              banks.map(b => `<option value="${b.code}">${b.name}</option>`).join('');
          }
        }
      } catch (e) { /* ignorar */ }
    }

    async function loadPaymentHistory() {
      const tbody = document.getElementById('payment-history-tbody');
      if (!tbody) return;
      try {
        const res = await fetch(`${API_BASE}/payments/me`, { headers: getAuthHeaders() });
        if (!res.ok) {
          PAYMENT_HISTORY_CACHE = [];
          tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">ðŸ“­</div>Sin historial de pagos</div></td></tr>';
          return;
        }
        const payments = await res.json();
        PAYMENT_HISTORY_CACHE = Array.isArray(payments) ? payments : [];
        const pendingEnrollment = getPendingEnrollmentPaymentsFromHistory();
        if (pendingEnrollment.length > 0) {
          const activeRef = getActiveEnrollmentPaymentReference();
          if (!activeRef || !pendingEnrollment.some(p => String(p.reference) === String(activeRef))) {
            setActiveEnrollmentPaymentReference(pendingEnrollment[0].reference);
          }
        } else {
          setActiveEnrollmentPaymentReference(null);
        }
        if (!Array.isArray(payments) || payments.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">ðŸ“­</div>Sin pagos registrados</div></td></tr>';
          return;
        }
        const statusBadge = s => {
          const map = { aprobado: 'approved', pendiente: 'pending', rechazado: 'rejected' };
          const cls = map[s] || 'pending';
          return `<span class="badge badge-status-${cls}">${s || 'desconocido'}</span>`;
        };
        const fmt = n => `$${(n||0).toLocaleString('es-CO')}`;
        tbody.innerHTML = payments.map(p => `
          <tr>
            <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('es-CO', {day:'2-digit',month:'short',year:'numeric'}) : 'â€”'}</td>
            <td>${p.concept || 'â€”'}</td>
            <td>${(p.payment_method||'').toUpperCase()}</td>
            <td style="color:var(--accent);font-weight:600">${fmt(p.amount)}</td>
            <td><code style="font-size:.7rem;color:var(--muted)">${p.reference || 'â€”'}</code></td>
            <td>${statusBadge(p.status)}</td>
          </tr>
        `).reverse().join('');
      } catch (e) {
        PAYMENT_HISTORY_CACHE = [];
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">âš </div>Error al cargar historial</div></td></tr>';
      }
    }

    async function submitPayment() {
      if (!MY_STUDENT && USER_ROLE === 'estudiante') {
        await loadMyStudent();
      }

      const amount = parseInt(document.getElementById('pay-amount').value);
      const concept = document.getElementById('pay-concept').value;
      const method = CURRENT_PAY_METHOD;

      if (!amount || amount < 1000) {
        showToast('Ingresa un monto vÃ¡lido (mÃ­nimo $1,000)', 'err');
        return;
      }
      if (!concept) {
        showToast('Selecciona un concepto', 'err');
        return;
      }

      const studentId = MY_STUDENT?.id;
      if (!studentId) {
        showToast('No se pudo obtener tu perfil de estudiante', 'err');
        return;
      }

      const payload = {
        student_id: studentId,
        amount,
        concept,
        method,
      };

      const pendingEnrollment = loadPendingEnrollmentOrder();
      if (pendingEnrollment && pendingEnrollment.status !== 'enrolled') {
        if (amount !== pendingEnrollment.totalCost) {
          showToast(`El monto para la factura ${pendingEnrollment.invoiceId} debe ser $${pendingEnrollment.totalCost.toLocaleString('es-CO')}`, 'err');
          return;
        }
        payload.concept = pendingEnrollment.concept;

        const btn = document.getElementById('btn-pay-submit');
        btn.disabled = true;
        btn.textContent = 'Conectando checkout...';
        await startRealEnrollmentCheckout(pendingEnrollment, studentId, btn);
        return;
      }

      if (method === 'pse' || method === 'bancolombia') {
        const bankCode = document.getElementById('pay-bank').value;
        if (!bankCode) { showToast('Selecciona un banco', 'err'); return; }
        payload.bank_code = bankCode;
      } else if (method === 'nequi') {
        const phone = document.getElementById('pay-nequi-phone').value.trim();
        if (!phone || phone.length < 10) { showToast('Ingresa un nÃºmero de celular vÃ¡lido (10 dÃ­gitos)', 'err'); return; }
        payload.phone = phone;
      } else if (method === 'tarjeta') {
        const cardNum = document.getElementById('pay-card-number').value.replace(/\s/g, '');
        const exp = document.getElementById('pay-card-exp').value;
        const cvv = document.getElementById('pay-card-cvv').value;
        const name = document.getElementById('pay-card-name').value;
        if (!cardNum || cardNum.length < 15) { showToast('NÃºmero de tarjeta invÃ¡lido', 'err'); return; }
        if (!exp || !exp.includes('/')) { showToast('Fecha de vencimiento invÃ¡lida', 'err'); return; }
        if (!cvv) { showToast('Ingresa el CVV', 'err'); return; }
        if (!name) { showToast('Ingresa el nombre en la tarjeta', 'err'); return; }
        // Para tarjeta, lo procesamos directo
      }

      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = true;
      btn.textContent = 'Procesando...';
      document.getElementById('pay-result-area').innerHTML = '';

      try {
        const res = await fetch(`${API_BASE}/payments/initiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
          showToast(data?.detail || 'âœ— Error al iniciar pago', 'err');
          btn.disabled = false;
          btn.textContent = 'Pagar ahora';
          return;
        }

        ACTIVE_PSE_SESSION = data.session_token;

        if (method === 'tarjeta') {
          await handleTarjetaFlow(data);
        } else if (method === 'nequi') {
          handleNequiFlow(data);
        } else {
          handlePseFlow(data);
        }

      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
        btn.disabled = false;
        btn.textContent = 'Pagar ahora';
      }
    }

    async function startRealEnrollmentCheckout(order, studentId, btn) {
      const resultArea = document.getElementById('pay-result-area');
      try {
        const payload = {
          student_id: studentId,
          amount_in_cents: Number(order.totalCost || 0) * 100,
          customer_email: USER_EMAIL || `${studentId}@ucc.edu.co`,
          concept: order.concept,
          description: `Pago de ${order.items.length} materias - ${order.invoiceId}`,
          payment_method: 'checkout',
          academic_order_id: order.invoiceId,
          metadata: {
            flow: 'enrollment_real_checkout',
            invoice_id: order.invoiceId,
            courses: order.items.map(item => ({
              course_id: item.course_id,
              section_id: item.section_id,
            })),
          },
        };

        const res = await fetch(`${API_BASE}/payments/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.payment?.reference) {
          throw new Error(data?.detail || 'No se pudo crear el checkout real de pago');
        }

        order.payment_reference = data.payment.reference;
        order.checkout_url = data.checkout_url || data.payment.checkout_url || null;
        order.checkout_method_hint = CURRENT_PAY_METHOD;
        order.status = 'awaiting_payment';
        savePendingEnrollmentOrder(order);
        setActiveEnrollmentPaymentReference(order.payment_reference);

        if (resultArea) {
          resultArea.innerHTML = `
            <div style="background:rgba(29,78,216,.08);border:1px solid rgba(29,78,216,.22);border-radius:12px;padding:1rem;">
              <div style="font-weight:700;color:var(--accent2);">Checkout real creado</div>
              <div style="font-size:.84rem;color:var(--muted);margin-top:.25rem;">Factura: ${order.invoiceId}</div>
              <div style="font-size:.84rem;color:var(--muted);">Referencia: ${order.payment_reference}</div>
              <div style="font-size:.82rem;color:var(--muted);margin-top:.35rem;">En el checkout de Wompi puedes pagar con PSE o Nequi de forma real, segun disponibilidad de tu comercio.</div>
              <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.65rem;">
                <button class="btn btn-primary btn-sm" onclick="openEnrollmentCheckout()">Ir a pagar</button>
                <button class="btn btn-secondary btn-sm" onclick="verifyEnrollmentCheckoutPayment('${order.payment_reference}')">Verificar pago</button>
                <button class="btn btn-secondary btn-sm" onclick="downloadEnrollmentInvoicePdf()">Descargar PDF</button>
              </div>
            </div>
          `;
        }
      } catch (error) {
        showPaymentError(error.message || 'No se pudo iniciar checkout real');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Pagar ahora';
      }
    }

    async function verifyEnrollmentCheckoutPayment(reference) {
      if (!reference) {
        showToast('No hay referencia de pago para verificar', 'warn');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/payments/status/${encodeURIComponent(reference)}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.detail || 'No se pudo verificar el estado del pago');
        }

        const normalized = String(data.status || '').toLowerCase();
        if (normalized === 'aprobado') {
          const orderByRef = findPendingEnrollmentOrderByReference(reference);
          if (orderByRef?.invoiceId) {
            localStorage.setItem(ACTIVE_PENDING_INVOICE_KEY, orderByRef.invoiceId);
            PENDING_ENROLLMENT_ORDER = orderByRef;
          }
          setActiveEnrollmentPaymentReference(reference);
          const order = loadPendingEnrollmentOrder();
          const pendingFromHistory = getPendingEnrollmentPaymentsFromHistory().find(p => String(p.reference) === String(reference));
          const session = {
            amount: order?.totalCost || pendingFromHistory?.amount || 0,
            concept: order?.concept || pendingFromHistory?.concept || 'Matricula',
            method: 'checkout',
            reference,
          };
          showPaymentSuccess(session);
          return;
        }

        if (normalized === 'rechazado' || normalized === 'expirado') {
          showPaymentError(`Pago ${normalized}`);
          return;
        }

        showToast(`Estado actual del pago: ${data.status || 'pendiente'}`, 'warn');
      } catch (error) {
        showPaymentError(error.message || 'Error verificando pago');
      }
    }

    async function handleTarjetaFlow(session) {
      // Tarjeta: confirmar directamente (simulaciÃ³n)
      const resultArea = document.getElementById('pay-result-area');
      resultArea.innerHTML = `<div style="color:var(--muted);font-size:.875rem;">â³ Validando tarjeta y procesando pago...</div>`;

      await new Promise(r => setTimeout(r, 1800));

      try {
        const confirmRes = await fetch(`${API_BASE}/payments/session/${session.session_token}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        });
        const result = await confirmRes.json();
        if (confirmRes.ok && result.status === 'approved') {
          showPaymentSuccess(result);
        } else {
          showPaymentError('Pago rechazado por la entidad bancaria.');
        }
      } catch (e) {
        showPaymentError('Error procesando el pago.');
      }

      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = false;
      btn.textContent = 'Pagar ahora';
    }

    function handleNequiFlow(session) {
      const resultArea = document.getElementById('pay-result-area');
      const phone = document.getElementById('pay-nequi-phone').value;
      resultArea.innerHTML = `
        <div class="nequi-waiting">
          <div class="pulse-dot"></div>
          <div>
            <div style="font-weight:600;color:#a855f7;">ðŸ’œ NotificaciÃ³n enviada a Nequi</div>
            <div style="font-size:.8rem;color:var(--muted);margin-top:4px;">
              Abre la app Nequi en el celular <strong>${phone}</strong> y aprueba el cobro de
              <strong>$${(session.amount||0).toLocaleString('es-CO')} COP</strong>.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.75rem;">
          <button class="btn btn-primary btn-sm" onclick="confirmNequiManually('${session.session_token}')">âœ“ He aprobado en Nequi</button>
          <button class="btn btn-danger btn-sm" onclick="cancelNequiPayment('${session.session_token}')">âœ— Cancelar</button>
        </div>
      `;

      // Polling automÃ¡tico por 3 min
      let attempts = 0;
      NEQUI_POLL_INTERVAL = setInterval(async () => {
        attempts++;
        if (attempts > 36) {
          clearInterval(NEQUI_POLL_INTERVAL);
          showPaymentError('Tiempo de espera agotado. El pago fue cancelado.');
          const btn = document.getElementById('btn-pay-submit');
          btn.disabled = false;
          btn.textContent = 'Pagar ahora';
          return;
        }
        try {
          const r = await fetch(`${API_BASE}/payments/session/${session.session_token}`, { headers: getAuthHeaders() });
          if (r.ok) {
            const s = await r.json();
            if (s.status === 'approved') {
              clearInterval(NEQUI_POLL_INTERVAL);
              showPaymentSuccess(s);
              const btn = document.getElementById('btn-pay-submit');
              btn.disabled = false;
              btn.textContent = 'Pagar ahora';
            } else if (s.status === 'rejected') {
              clearInterval(NEQUI_POLL_INTERVAL);
              showPaymentError('Pago rechazado o cancelado desde Nequi.');
              const btn = document.getElementById('btn-pay-submit');
              btn.disabled = false;
              btn.textContent = 'Pagar ahora';
            }
          }
        } catch (e) { /* ignorar */ }
      }, 5000);
    }

    async function confirmNequiManually(token) {
      clearInterval(NEQUI_POLL_INTERVAL);
      try {
        const res = await fetch(`${API_BASE}/payments/session/${token}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        });
        const result = await res.json();
        if (res.ok && result.status === 'approved') {
          showPaymentSuccess(result);
        } else {
          showPaymentError(result?.detail || 'Error al confirmar pago');
        }
      } catch (e) {
        showPaymentError('Error de conexiÃ³n');
      }
      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = false;
      btn.textContent = 'Pagar ahora';
    }

    async function cancelNequiPayment(token) {
      clearInterval(NEQUI_POLL_INTERVAL);
      try {
        await fetch(`${API_BASE}/payments/session/${token}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        });
      } catch (e) { /* ignorar */ }
      showPaymentError('Pago cancelado.');
      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = false;
      btn.textContent = 'Pagar ahora';
    }

    function handlePseFlow(session) {
      const resultArea = document.getElementById('pay-result-area');
      const bankSel = document.getElementById('pay-bank');
      const bankName = bankSel?.options[bankSel?.selectedIndex]?.text || 'tu banco';
      const redirectUrl = `${API_BASE}/payments${session.redirect_url}`;

      resultArea.innerHTML = `
        <div class="pse-redirect-cta">
          <div style="font-weight:600;color:var(--accent2);">ðŸ¦ Redirigir a ${bankName}</div>
          <div style="font-size:.85rem;color:var(--muted);">
            Se abrirÃ¡ el portal seguro de <strong>${bankName}</strong> para que completes el pago de
            <strong>$${(session.amount||0).toLocaleString('es-CO')} COP</strong>.<br>
            Una vez finalices en el banco, regresa aquÃ­ y haz clic en "Verificar resultado".
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="openPseWindow('${redirectUrl}', '${session.session_token}')">
              ðŸ”— Ir al portal del banco
            </button>
            <button class="btn btn-secondary btn-sm" onclick="checkPseResult('${session.session_token}')">
              ðŸ” Verificar resultado
            </button>
            <button class="btn btn-danger btn-sm" onclick="cancelPsePayment('${session.session_token}')">
              âœ— Cancelar
            </button>
          </div>
        </div>
      `;

      // Escuchar mensaje postMessage de la ventana PSE
      window.addEventListener('message', async (event) => {
        if (event.data?.type === 'PSE_CONFIRM' && event.data?.token === session.session_token) {
          await checkPseResult(session.session_token);
        } else if (event.data?.type === 'PSE_CANCEL' && event.data?.token === session.session_token) {
          showPaymentError('Pago cancelado desde el portal bancario.');
          const btn = document.getElementById('btn-pay-submit');
          btn.disabled = false;
          btn.textContent = 'Pagar ahora';
        }
      }, { once: true });

      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = false;
      btn.textContent = 'Pagar ahora';
    }

    function openPseWindow(url, token) {
      PSE_WINDOW = window.open(url, 'pse_bank_portal', 'width=580,height=700,scrollbars=yes');
    }

    async function checkPseResult(token) {
      try {
        const r = await fetch(`${API_BASE}/payments/session/${token}`, { headers: getAuthHeaders() });
        if (r.ok) {
          const session = await r.json();
          if (session.status === 'approved') {
            if (PSE_WINDOW && !PSE_WINDOW.closed) PSE_WINDOW.close();
            showPaymentSuccess(session);
          } else if (session.status === 'rejected') {
            showPaymentError('El pago fue rechazado por el banco.');
          } else {
            // Auto-confirm para la simulaciÃ³n (el usuario volviÃ³ del banco)
            const confirmRes = await fetch(`${API_BASE}/payments/session/${token}/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            });
            const result = await confirmRes.json();
            if (confirmRes.ok && result.status === 'approved') {
              if (PSE_WINDOW && !PSE_WINDOW.closed) PSE_WINDOW.close();
              showPaymentSuccess(result);
            } else {
              showToast('El pago aÃºn no ha sido confirmado por el banco.', 'err');
            }
          }
        }
      } catch (e) {
        showToast('Error verificando el resultado del pago', 'err');
      }
    }

    async function cancelPsePayment(token) {
      try {
        await fetch(`${API_BASE}/payments/session/${token}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        });
      } catch (e) { /* ignorar */ }
      if (PSE_WINDOW && !PSE_WINDOW.closed) PSE_WINDOW.close();
      showPaymentError('Pago cancelado.');
      const btn = document.getElementById('btn-pay-submit');
      btn.disabled = false;
      btn.textContent = 'Pagar ahora';
    }

    function showPaymentSuccess(session) {
      const fmt = n => `$${(n||0).toLocaleString('es-CO')}`;
      const reference = session.reference || session.payment_reference || session.session_token || 'N/A';
      const resultArea = document.getElementById('pay-result-area');
      resultArea.innerHTML = `
        <div style="background:rgba(79,255,176,.08);border:1px solid rgba(79,255,176,.25);border-radius:12px;padding:1.25rem;margin-top:.5rem;">
          <div style="font-size:1.2rem;font-weight:700;color:var(--accent);margin-bottom:.5rem;">âœ” Pago aprobado</div>
          <div style="font-size:.875rem;color:var(--muted);line-height:1.7;">
            <div>Monto: <strong style="color:var(--text)">${fmt(session.amount)} COP</strong></div>
            <div>Concepto: <strong style="color:var(--text)">${session.concept || 'â€”'}</strong></div>
            <div>MÃ©todo: <strong style="color:var(--text)">${(session.method||'').toUpperCase()}</strong></div>
            <div>Referencia: <code style="color:var(--accent2);font-size:.75rem">${reference}</code></div>
            <div style="margin-top:.55rem;display:flex;gap:.45rem;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" onclick="downloadEnrollmentInvoicePdf(null, '${reference}', 'PAGADA')">Descargar factura PDF</button>
            </div>
          </div>
        </div>
      `;
      showToast('âœ“ Pago procesado exitosamente', 'ok');
      finalizePendingEnrollmentAfterPayment(session);
      // Actualizar resumen y historial
      setTimeout(() => {
        loadPaymentSummary();
        loadPaymentHistory();
        loadStudentDashboard();
        document.getElementById('pay-amount').value = '';
      }, 600);
    }

    function showPaymentError(msg) {
      const resultArea = document.getElementById('pay-result-area');
      resultArea.innerHTML = `
        <div style="background:rgba(255,79,106,.08);border:1px solid rgba(255,79,106,.25);border-radius:12px;padding:1rem;margin-top:.5rem;color:var(--danger);">
          âœ— ${msg}
        </div>
      `;
      showToast(`âœ— ${msg}`, 'err');
    }

    async function loadPaymentServiceStatus() {
      const content = document.getElementById('payment-service-status') || document.getElementById('payment-content');
      if (!content) return;
      try {
        const res = await fetch(`${API_BASE}/payments/health`);
        if (res.ok) {
          content.innerHTML = '<span style="color:var(--accent)">âœ” Payment Service disponible y operando</span>';
        } else {
          content.textContent = 'Payment Service no disponible';
        }
      } catch (e) {
        content.textContent = 'No se pudo conectar a Payment Service';
      }
    }

    async function adminAddDebt() {
      const studentId = parseInt(document.getElementById('admin-debt-student-id').value);
      const amount = parseInt(document.getElementById('admin-debt-amount').value);
      const description = document.getElementById('admin-debt-description').value;

      if (!studentId || !amount || amount < 1) {
        showToast('Completa ID de estudiante y monto', 'err');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/payments/accounts/${studentId}/debt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ amount, description }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`âœ“ Deuda registrada: $${amount.toLocaleString('es-CO')} COP`, 'ok');
          document.getElementById('admin-debt-student-id').value = '';
          document.getElementById('admin-debt-amount').value = '';
          document.getElementById('admin-debt-description').value = '';
        } else {
          showToast(data?.detail || 'âœ— Error al registrar deuda', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function adminCheckAccount() {
      const studentId = parseInt(document.getElementById('admin-check-student-id').value);
      if (!studentId) { showToast('Ingresa el ID del estudiante', 'err'); return; }

      const resultDiv = document.getElementById('admin-account-result');
      resultDiv.textContent = 'Consultando...';

      try {
        const res = await fetch(`${API_BASE}/payments/accounts/${studentId}`, { headers: getAuthHeaders() });
        if (res.status === 404) {
          resultDiv.innerHTML = '<span style="color:var(--muted)">Sin cuenta financiera registrada para este estudiante.</span>';
          return;
        }
        const data = await res.json();
        const fmt = n => `$${(n||0).toLocaleString('es-CO')}`;
        resultDiv.innerHTML = `
          <div style="display:grid;gap:.4rem;margin-top:.5rem;">
            <div>Deuda total: <strong style="color:var(--danger)">${fmt(data.total_debt)}</strong></div>
            <div>Pagado: <strong style="color:var(--accent)">${fmt(data.total_paid)}</strong></div>
            <div>Saldo: <strong style="color:var(--warn)">${fmt(data.balance)}</strong></div>
            <div>Estado: <strong>${data.status}</strong></div>
          </div>
        `;
      } catch (e) {
        resultDiv.textContent = 'Error al consultar cuenta';
      }
    }

    async function loadStudents() {
      if (USER_ROLE === 'estudiante') {
        return;
      }
      try {
        const documentFilter = document.getElementById('students-document-filter')?.value?.trim() || '';
        const careerFilter = document.getElementById('students-career-filter')?.value || '';
        const params = new URLSearchParams();
        if (documentFilter) params.set('document_id', documentFilter);
        if (careerFilter) params.set('program', careerFilter);
        const query = params.toString();

        const res = await fetch(`${API_BASE}/students/${query ? `?${query}` : ''}`, { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          const students = Array.isArray(data) ? data : data.students || [];
          const tbody = document.getElementById('students-tbody');

          if (students.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">ðŸ“­</div>Sin estudiantes</div></td></tr>';
            return;
          }

          tbody.innerHTML = students.map(s => `
            <tr>
              <td><code style="font-size: .7rem; color: var(--accent)">${s.id}</code></td>
              <td>${s.document_id || 'â€”'}</td>
              <td>${`${s.nombre || ''} ${s.apellido || ''}`.trim() || s.email}</td>
              <td>${s.program || 'â€”'}</td>
              <td>${s.email}</td>
              <td><span class="badge badge-activo">${s.status || 'activo'}</span></td>
              <td style="display:flex;gap:.4rem;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="editStudentProfileAsAdmin(${s.id})">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="deleteStudent(${s.id})">Eliminar</button>
              </td>
            </tr>
          `).join('');
        }
      } catch (e) {
        showToast('âœ— Error al cargar estudiantes', 'err');
      }
    }

    function validateStudentData(firstName, lastName, documentId, email, program) {
      // Validar cÃ©dula: 10 dÃ­gitos exactos
      if (!/^\d{10}$/.test(documentId)) {
        showToast('âœ— La cÃ©dula debe tener exactamente 10 dÃ­gitos', 'err');
        return false;
      }
      // Validar nombre y apellido: mÃ­nimo 2 caracteres
      if (firstName.length < 2) {
        showToast('âœ— El nombre debe tener al menos 2 caracteres', 'err');
        return false;
      }
      if (lastName.length < 2) {
        showToast('âœ— El apellido debe tener al menos 2 caracteres', 'err');
        return false;
      }
      // Validar email: debe terminar en @ucc.edu.co
      if (!email.endsWith('@ucc.edu.co')) {
        showToast('âœ— El email debe ser institucional (@ucc.edu.co)', 'err');
        return false;
      }
      // Validar carrera seleccionada
      if (!program || program === 'Sin carrera') {
        showToast('âœ— Debes seleccionar una carrera vÃ¡lida', 'err');
        return false;
      }
      return true;
    }

    async function createStudentRecord(userId, firstName, lastName, email, documentId, program) {
      const payload = {
        user_id: userId,
        nombre: firstName,
        apellido: lastName,
        email,
        document_id: documentId,
        program: program || null,
        status: 'activo',
      };
      const res = await fetch(`${API_BASE}/students/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'No se pudo registrar el estudiante en student_service');
      }
      return await res.json();
    }

    async function createTeacherRecord(userId, firstName, lastName, email, documentId, careerCode = '') {
      const payload = {
        user_id: userId,
        email,
        nombres: firstName,
        apellidos: lastName,
        nombre: `${firstName} ${lastName}`,
        document_id: documentId,
        career_code: careerCode || null,
      };
      const res = await fetch(`${API_BASE}/academic/api/teachers/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'No se pudo registrar el docente en academic_service');
      }
      return await res.json();
    }

    async function createStudent() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear estudiantes', 'err');
        return;
      }

      const firstName = document.getElementById('student-first-name').value.trim();
      const lastName = document.getElementById('student-last-name').value.trim();
      const documentId = document.getElementById('student-document-id').value.trim();
      const program = document.getElementById('student-program').value;
      const email = document.getElementById('student-email').value.trim();
      const password = document.getElementById('student-password').value;

      if (!firstName || !lastName || !documentId || !email || !password || !program) {
        showToast('Completa todos los campos, incluida la carrera', 'err');
        return;
      }

      // Validar datos antes de enviar
      if (!validateStudentData(firstName, lastName, documentId, email, program)) {
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/create-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            document_id: documentId,
            email: email,
            password: password,
            role: 'estudiante'
          }),
        });

        if (res.ok) {
          const authData = await res.json();
          const userId = authData?.user_id;
          if (!userId) {
            throw new Error('No se recibiÃ³ user_id al crear el usuario');
          }

          await createStudentRecord(userId, firstName, lastName, email, documentId, program);
          showToast('âœ“ Estudiante creado', 'ok');
          document.getElementById('student-first-name').value = '';
          document.getElementById('student-last-name').value = '';
          document.getElementById('student-document-id').value = '';
          document.getElementById('student-program').value = '';
          document.getElementById('student-email').value = '';
          document.getElementById('student-password').value = '';
          loadStudents();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al crear', 'err');
        }
      } catch (e) {
        showToast(`âœ— ${e?.message || 'Error de conexiÃ³n'}`, 'err');
      }
    }

    function resetAdminUserForm(prefix) {
      ['first-name', 'last-name', 'document-id', 'email', 'password', 'program'].forEach(field => {
        const input = document.getElementById(`${prefix}-${field}`);
        if (input) input.value = '';
      });
    }

    async function createManagedUser(payload) {
      const res = await fetch(`${API_BASE}/auth/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        loadAdminDashboard();
        return { ok: true, data };
      }

      const data = await res.json().catch(() => null);
      showToast(data?.detail || 'âœ— Error al crear usuario', 'err');
      return { ok: false, data: null };
    }

    async function createStudentFromAdminPanel() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear estudiantes', 'err');
        return;
      }

      const payload = {
        first_name: document.getElementById('admin-student-first-name').value.trim(),
        last_name: document.getElementById('admin-student-last-name').value.trim(),
        document_id: document.getElementById('admin-student-document-id').value.trim(),
        email: document.getElementById('admin-student-email').value.trim(),
        password: document.getElementById('admin-student-password').value,
        role: 'estudiante',
      };
      const program = document.getElementById('admin-student-program').value;

      if (!payload.first_name || !payload.last_name || !payload.document_id || !payload.email || !payload.password || !program) {
        showToast('Completa todos los campos del estudiante, incluida la carrera', 'err');
        return;
      }

      // Validar datos antes de enviar
      if (!validateStudentData(payload.first_name, payload.last_name, payload.document_id, payload.email, program)) {
        return;
      }

      const created = await createManagedUser(payload);
      if (created.ok) {
        const userId = created.data?.user_id;
        if (userId) {
          try {
            await createStudentRecord(userId, payload.first_name, payload.last_name, payload.email, payload.document_id, program);
            showToast('âœ“ Estudiante creado desde gestiÃ³n de usuarios', 'ok');
            loadStudents();
          } catch (e) {
            showToast(`âœ— ${e?.message || 'No se pudo registrar en student_service'}`, 'err');
            return;
          }
        }
        resetAdminUserForm('admin-student');
      }
    }

    async function editStudentProfileAsAdmin(studentId) {
      try {
        const res = await fetch(`${API_BASE}/students/${studentId}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— No se pudo cargar el estudiante', 'err');
          return;
        }
        const student = await res.json();
        PROFILE_TARGET_STUDENT_ID = student.id;
        ADMIN_PROFILE_MODE = 'student';
        document.getElementById('profile-nombre').value = student.nombre || '';
        document.getElementById('profile-apellido').value = student.apellido || '';
        const profileProgram = document.getElementById('profile-program');
        if (profileProgram) {
          if (profileProgram.parentElement) profileProgram.parentElement.style.display = '';
          profileProgram.value = student.program || '';
          profileProgram.disabled = false;
        }
        const profileProgramLabel = document.getElementById('profile-program-label');
        if (profileProgramLabel?.parentElement) profileProgramLabel.parentElement.style.display = '';
        const passwordFields = document.getElementById('profile-password-fields');
        if (passwordFields) passwordFields.style.display = 'none';
        const title = document.querySelector('#sec-my-profile .section-title');
        const subtitle = document.querySelector('#sec-my-profile .section-subtitle');
        if (title) title.textContent = 'Perfil de Estudiante';
        if (subtitle) subtitle.textContent = `Editando estudiante ID ${student.id}`;
        goTo('my-profile', document.getElementById('nav-my-profile'));
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n al cargar perfil', 'err');
      }
    }

    async function createAdministratorFromAdminPanel() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear administradores', 'err');
        return;
      }

      const payload = {
        first_name: document.getElementById('admin-user-first-name').value,
        last_name: document.getElementById('admin-user-last-name').value,
        document_id: document.getElementById('admin-user-document-id').value,
        email: document.getElementById('admin-user-email').value,
        password: document.getElementById('admin-user-password').value,
        role: 'admin',
      };

      if (!payload.first_name || !payload.last_name || !payload.document_id || !payload.email || !payload.password) {
        showToast('Completa todos los campos del administrador', 'err');
        return;
      }

      const created = await createManagedUser(payload);
      if (created.ok) {
        showToast('âœ“ Administrador creado correctamente', 'ok');
        resetAdminUserForm('admin-user');
      }
    }

    function validateTeacherData(firstName, lastName, documentId, email) {
      // Validar cÃ©dula: 10 dÃ­gitos exactos
      if (!/^\d{10}$/.test(documentId)) {
        showToast('âœ— La cÃ©dula debe tener exactamente 10 dÃ­gitos', 'err');
        return false;
      }
      // Validar nombre y apellido: mÃ­nimo 2 caracteres
      if (firstName.length < 2) {
        showToast('âœ— El nombre debe tener al menos 2 caracteres', 'err');
        return false;
      }
      if (lastName.length < 2) {
        showToast('âœ— El apellido debe tener al menos 2 caracteres', 'err');
        return false;
      }
      // Validar email: debe terminar en @ucc.edu.co
      if (!email.endsWith('@ucc.edu.co')) {
        showToast('âœ— El email debe ser institucional (@ucc.edu.co)', 'err');
        return false;
      }
      return true;
    }

    async function createTeacherFromAdminPanel() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear docentes', 'err');
        return;
      }

      const payload = {
        first_name: document.getElementById('admin-teacher-first-name').value.trim(),
        last_name: document.getElementById('admin-teacher-last-name').value.trim(),
        document_id: document.getElementById('admin-teacher-document-id').value.trim(),
        email: document.getElementById('admin-teacher-email').value.trim(),
        password: document.getElementById('admin-teacher-password').value,
        role: 'docente',
      };
      const careerCode = document.getElementById('admin-teacher-career')?.value || '';

      if (!payload.first_name || !payload.last_name || !payload.document_id || !payload.email || !payload.password) {
        showToast('Completa todos los campos del docente', 'err');
        return;
      }

      // Validar datos antes de enviar
      if (!validateTeacherData(payload.first_name, payload.last_name, payload.document_id, payload.email)) {
        return;
      }

      const created = await createManagedUser(payload);
      if (created.ok) {
        const userId = created.data?.user_id;
        if (userId) {
          try {
            await createTeacherRecord(userId, payload.first_name, payload.last_name, payload.email, payload.document_id, careerCode);
            showToast('âœ“ Docente creado correctamente', 'ok');
            loadTeachers();
          } catch (e) {
            showToast(`âœ— ${e?.message || 'No se pudo registrar en academic_service'}`, 'err');
            return;
          }
        }
        resetAdminUserForm('admin-teacher');
        const adminTeacherCareer = document.getElementById('admin-teacher-career');
        if (adminTeacherCareer) adminTeacherCareer.value = '';
      }
    }

    async function deleteStudent(id) {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para eliminar estudiantes', 'err');
        return;
      }
      if (!confirm('Â¿Eliminar este estudiante?')) return;
      try {
        const res = await fetch(`${API_BASE}/students/${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          showToast('âœ“ Estudiante eliminado', 'ok');
          loadStudents();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al eliminar', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function loadAcademic() {
      try {
        const selectedCareer = document.getElementById('materias-career-filter')?.value || '';
        const selectedSemester = document.getElementById('materias-semester-filter')?.value || '';
        const res = await fetch(`${API_BASE}/academic/api/courses/?limit=5000`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          const courses = Array.isArray(data) ? data : data.courses || [];
          const tbody = document.getElementById('academic-tbody');
          const courseSelect = document.getElementById('assign-course-select');
          COURSES = courses;
          ALL_ACADEMIC_COURSES = courses;

          let filtered = courses;
          if (selectedCareer) {
            filtered = filtered.filter(c => String(c.career_id) === String(selectedCareer));
          }

          const semesterSelect = document.getElementById('materias-semester-filter');
          if (semesterSelect) {
            const previous = selectedSemester;
            const semesterOptions = [...new Set(filtered.map(c => c.semester).filter(s => s !== null && s !== undefined))]
              .sort((a, b) => a - b)
              .map(s => `<option value="${s}">Semestre ${s}</option>`)
              .join('');
            semesterSelect.innerHTML = '<option value="">Todos los semestres</option>' + semesterOptions;
            if (previous && [...semesterSelect.options].some(opt => opt.value === previous)) {
              semesterSelect.value = previous;
            }
          }

          if (selectedSemester) {
            filtered = filtered.filter(c => String(c.semester || '') === String(selectedSemester));
          }
          
          if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="big">ðŸ“š</div>Sin materias para el filtro actual</div></td></tr>';
            if (courseSelect) courseSelect.innerHTML = '<option value="">No hay cursos</option>';
            return;
          }

          const sorted = [...filtered].sort((a, b) => {
            const aSem = a.semester || 999;
            const bSem = b.semester || 999;
            if (aSem !== bSem) return aSem - bSem;
            return (a.name || '').localeCompare(b.name || '');
          });

          tbody.innerHTML = renderCourseRowsBySemester(sorted);

          if (courseSelect) {
            populateAssignmentCourseSelect();
          }
        }
      } catch (e) {
        showToast('âœ— Error al cargar cursos', 'err');
      }
    }

    async function loadCareers() {
      try {
        const res = await fetch(`${API_BASE}/academic/api/careers/`, {
          headers: getAuthHeaders(),
        });
        const tbody = document.getElementById('careers-tbody');
        const careerSelect = document.getElementById('course-career');

        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">âš </div>No se pueden cargar carreras</div></td></tr>';
          careerSelect.innerHTML = '<option value="">Cargar carreras primero</option>';
          return;
        }

        const careers = await res.json();
        ACADEMIC_CAREERS = Array.isArray(careers) ? careers : [];
        if (!Array.isArray(careers) || careers.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="big">ðŸ“­</div>No hay carreras</div></td></tr>';
          careerSelect.innerHTML = '<option value="">Sin carreras</option>';
          const filterSelect = document.getElementById('materias-career-filter');
          if (filterSelect) filterSelect.innerHTML = '<option value="">Todas las carreras</option>';
          const teacherCareerFilter = document.getElementById('teacher-career-filter');
          if (teacherCareerFilter) {
            teacherCareerFilter.innerHTML = '<option value="">Todas las carreras</option>';
          }
          const studentsCareerFilter = document.getElementById('students-career-filter');
          if (studentsCareerFilter) {
            studentsCareerFilter.innerHTML = '<option value="">Todas las carreras</option>';
          }
          const assignCareerFilter = document.getElementById('assign-career-filter');
          if (assignCareerFilter) {
            assignCareerFilter.innerHTML = '<option value="">Todas las carreras</option>';
          }
          const assignCourseCareerFilter = document.getElementById('assign-course-career-filter');
          if (assignCourseCareerFilter) {
            assignCourseCareerFilter.innerHTML = '<option value="">Todas las carreras</option>';
          }
          const studentProgram = document.getElementById('student-program');
          if (studentProgram) {
            studentProgram.innerHTML = '<option value="">Selecciona una carrera</option>';
          }
          const adminStudentProgram = document.getElementById('admin-student-program');
          if (adminStudentProgram) {
            adminStudentProgram.innerHTML = '<option value="">Selecciona una carrera</option>';
          }
          const teacherCareer = document.getElementById('teacher-career');
          if (teacherCareer) {
            teacherCareer.innerHTML = '<option value="">Sin carrera asignada</option>';
          }
          const adminTeacherCareer = document.getElementById('admin-teacher-career');
          if (adminTeacherCareer) {
            adminTeacherCareer.innerHTML = '<option value="">Sin carrera asignada</option>';
          }
          const profileProgram = document.getElementById('profile-program');
          if (profileProgram) {
            profileProgram.innerHTML = '<option value="">Sin carrera</option>';
          }
          return;
        }

        tbody.innerHTML = careers.map(c => `
          <tr>
            <td><code style="font-size: .7rem; color: var(--accent)">${c.id}</code></td>
            <td>${c.code}</td>
            <td>${c.name}</td>
            <td>${c.description || 'â€”'}</td>
            <td>${c.faculty || 'â€”'}</td>
            <td>${c.duration_semesters != null ? c.duration_semesters : 'â€”'}</td>
            <td>${c.modality || 'â€”'}</td>
            <td>${c.degree_title || 'â€”'}</td>
          </tr>
        `).join('');

        careerSelect.innerHTML = '<option value="">Selecciona una carrera</option>' + careers.map(c => `
          <option value="${c.id}">${c.code} â€” ${c.name}</option>
        `).join('');

        const filterSelect = document.getElementById('materias-career-filter');
        if (filterSelect) {
          const selectedValue = filterSelect.value;
          filterSelect.innerHTML = '<option value="">Todas las carreras</option>' + careers.map(c => `
            <option value="${c.id}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (selectedValue) {
            filterSelect.value = selectedValue;
          }
        }

        const teacherCareerFilter = document.getElementById('teacher-career-filter');
        if (teacherCareerFilter) {
          const selectedCareer = teacherCareerFilter.value;
          teacherCareerFilter.innerHTML = '<option value="">Todas las carreras</option>' + careers.map(c => `
            <option value="${c.code}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (selectedCareer) {
            teacherCareerFilter.value = selectedCareer;
          }
        }

        const studentsCareerFilter = document.getElementById('students-career-filter');
        if (studentsCareerFilter) {
          const selectedStudentCareer = studentsCareerFilter.value;
          studentsCareerFilter.innerHTML = '<option value="">Todas las carreras</option>' + careers.map(c => `
            <option value="${c.name}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (selectedStudentCareer) {
            studentsCareerFilter.value = selectedStudentCareer;
          }
        }

        const assignCareerFilter = document.getElementById('assign-career-filter');
        if (assignCareerFilter) {
          const selectedAssignCareer = assignCareerFilter.value;
          assignCareerFilter.innerHTML = '<option value="">Todas las carreras</option>' + careers.map(c => `
            <option value="${c.code}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (selectedAssignCareer) assignCareerFilter.value = selectedAssignCareer;
        }

        const assignCourseCareerFilter = document.getElementById('assign-course-career-filter');
        if (assignCourseCareerFilter) {
          const selectedAssignCourseCareer = assignCourseCareerFilter.value;
          assignCourseCareerFilter.innerHTML = '<option value="">Todas las carreras</option>' + careers.map(c => `
            <option value="${c.code}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (selectedAssignCourseCareer) assignCourseCareerFilter.value = selectedAssignCourseCareer;
        }

        const studentProgram = document.getElementById('student-program');
        if (studentProgram) {
          const currentValue = studentProgram.value;
          studentProgram.innerHTML = '<option value="">Selecciona una carrera</option>' + careers.map(c => `
            <option value="${c.name}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (currentValue) studentProgram.value = currentValue;
        }

        const adminStudentProgram = document.getElementById('admin-student-program');
        if (adminStudentProgram) {
          const currentAdminValue = adminStudentProgram.value;
          adminStudentProgram.innerHTML = '<option value="">Selecciona una carrera</option>' + careers.map(c => `
            <option value="${c.name}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (currentAdminValue) adminStudentProgram.value = currentAdminValue;
        }

        const teacherCareer = document.getElementById('teacher-career');
        if (teacherCareer) {
          const currentTeacherCareer = teacherCareer.value;
          teacherCareer.innerHTML = '<option value="">Sin carrera asignada</option>' + careers.map(c => `
            <option value="${c.code}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (currentTeacherCareer) teacherCareer.value = currentTeacherCareer;
        }

        const adminTeacherCareer = document.getElementById('admin-teacher-career');
        if (adminTeacherCareer) {
          const currentAdminTeacherCareer = adminTeacherCareer.value;
          adminTeacherCareer.innerHTML = '<option value="">Sin carrera asignada</option>' + careers.map(c => `
            <option value="${c.code}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (currentAdminTeacherCareer) adminTeacherCareer.value = currentAdminTeacherCareer;
        }

        const profileProgram = document.getElementById('profile-program');
        if (profileProgram) {
          const currentProfileProgram = profileProgram.value;
          profileProgram.innerHTML = '<option value="">Sin carrera</option>' + careers.map(c => `
            <option value="${c.name}">${c.code} â€” ${c.name}</option>
          `).join('');
          if (currentProfileProgram) profileProgram.value = currentProfileProgram;
        }

        populateScheduleCareerSelects();
        populateAssignmentCourseSelect();
      } catch (e) {
        showToast('âœ— Error al cargar carreras', 'err');
      }
    }

    async function createCareer() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear carreras', 'err');
        return;
      }

      const code = document.getElementById('career-code').value;
      const name = document.getElementById('career-name').value;
      const description = document.getElementById('career-description').value;
      const faculty = document.getElementById('career-faculty').value;
      const duration_semesters = document.getElementById('career-duration').value
        ? parseInt(document.getElementById('career-duration').value) : null;
      const modality = document.getElementById('career-modality').value || null;
      const degree_title = document.getElementById('career-degree-title').value;

      if (!code || !name) {
        showToast('Completa cÃ³digo y nombre de la carrera', 'err');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/academic/api/careers/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ code, name, description, faculty, duration_semesters, modality, degree_title }),
        });

        if (res.ok) {
          showToast('âœ“ Carrera creada', 'ok');
          document.getElementById('career-code').value = '';
          document.getElementById('career-name').value = '';
          document.getElementById('career-description').value = '';
          document.getElementById('career-faculty').value = '';
          document.getElementById('career-duration').value = '';
          document.getElementById('career-modality').value = '';
          document.getElementById('career-degree-title').value = '';
          loadCareers();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al crear carrera', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function createCourse() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear materias', 'err');
        return;
      }

      const code = document.getElementById('course-code').value;
      const name = document.getElementById('course-name').value;
      const credits = Number(document.getElementById('course-credits').value);
      const semester = Number(document.getElementById('course-semester').value);
      const careerId = Number(document.getElementById('course-career').value);
      const startDateTime = document.getElementById('course-start-datetime').value;
      const durationMinutes = Number(document.getElementById('course-duration').value || '120');
      const location = document.getElementById('course-location').value;
      const maxStudentsRaw = document.getElementById('course-max-students').value;
      const maxStudents = maxStudentsRaw ? Number(maxStudentsRaw) : null;

      if (!startDateTime) {
        showToast('Selecciona fecha y hora de inicio', 'err');
        return;
      }

      const dt = new Date(startDateTime);
      const day = WEEKDAYS_ES[dt.getDay()];
      const startTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      const endTime = fromMinutes(toMinutes(startTime) + durationMinutes);

      if (!code || !name || !credits || !semester || !careerId || !day || !startTime || !endTime || !location) {
        showToast('Completa todos los campos de la materia', 'err');
        return;
      }

      const conflict = ALL_ACADEMIC_COURSES.find(c => {
        if ((c.day_of_week || '').toLowerCase() !== day.toLowerCase()) return false;
        if (String(c.location || '') !== String(location)) return false;
        const aStart = toMinutes(startTime);
        const aEnd = toMinutes(endTime);
        const bStart = toMinutes(c.start_time || '');
        const bEnd = toMinutes(c.end_time || '');
        if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false;
        return aStart < bEnd && bStart < aEnd;
      });

      if (conflict) {
        showToast(`âœ— SalÃ³n ${location} ocupado el ${day} de ${conflict.start_time} a ${conflict.end_time}`, 'err');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/academic/api/courses/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            codigo: code,
            nombre: name,
            creditos: credits,
            semestre: semester,
            career_id: careerId,
            dia: day,
            hora_inicio: startTime,
            hora_fin: endTime,
            aula: location,
            ...(maxStudents ? { max_estudiantes: maxStudents } : {}),
          }),
        });

        if (res.ok) {
          showToast('âœ“ Materia creada', 'ok');
          document.getElementById('course-code').value = '';
          document.getElementById('course-name').value = '';
          document.getElementById('course-credits').value = '';
          document.getElementById('course-semester').value = '';
          document.getElementById('course-start-datetime').value = '';
          document.getElementById('course-duration').value = '120';
          document.getElementById('course-max-students').value = '';
          loadAcademic();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al crear materia', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function fetchTeacher(teacherId) {
      try {
        const res = await fetch(`${API_BASE}/academic/api/teachers/${teacherId}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.warn('Error cargando docente', e);
      }
      return null;
    }

    async function loadTeachers() {
      try {
        const searchFilter = document.getElementById('teacher-document-filter')?.value?.trim() || '';
        const careerFilter = document.getElementById('teacher-career-filter')?.value || '';
        const params = new URLSearchParams();
        if (searchFilter) {
          if (/^\d+$/.test(searchFilter)) {
            params.set('document_id', searchFilter);
          } else {
            params.set('name', searchFilter);
          }
        }
        if (careerFilter) params.set('career_code', careerFilter);
        const query = params.toString();

        const res = await fetch(`${API_BASE}/academic/api/teachers/${query ? `?${query}` : ''}`, {
          headers: getAuthHeaders(),
        });
        const tbody = document.getElementById('teachers-tbody');
        const teacherSelect = document.getElementById('assign-teacher-select');
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">âš </div>No se pueden cargar docentes</div></td></tr>';
          if (teacherSelect) teacherSelect.innerHTML = '<option value="">No se pueden cargar docentes</option>';
          return;
        }

        const teachers = await res.json();
        TEACHERS = Array.isArray(teachers) ? teachers : [];
        if (TEACHERS.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">ðŸ“­</div>No hay docentes</div></td></tr>';
          if (teacherSelect) teacherSelect.innerHTML = '<option value="">No hay docentes</option>';
          return;
        }

        tbody.innerHTML = TEACHERS.map(t => `
          <tr>
            <td><code style="font-size: .7rem; color: var(--accent)">${t.id}</code></td>
            <td>${t.document_id || 'â€”'}</td>
            <td>${t.first_name || 'â€”'}</td>
            <td>${t.last_name || 'â€”'}</td>
            <td>${(Array.isArray(t.career_codes) && t.career_codes.length) ? t.career_codes.join(', ') : 'â€”'}</td>
            <td>${t.email || 'â€”'}</td>
          </tr>
        `).join('');

        populateAssignmentCourseSelect();
        populateAssignmentTeacherSelect();

        await loadScheduleTeachers();
      } catch (e) {
        showToast('âœ— Error al cargar docentes', 'err');
      }
    }

    async function createTeacher() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para crear docentes', 'err');
        return;
      }

      const firstName = document.getElementById('teacher-first-name').value.trim();
      const lastName = document.getElementById('teacher-last-name').value.trim();
      const email = document.getElementById('teacher-email').value.trim();
      const documentId = document.getElementById('teacher-document').value.trim();
      const password = document.getElementById('teacher-password').value;
      const careerCode = document.getElementById('teacher-career')?.value || '';

      if (!firstName || !lastName || !email || !documentId || !password) {
        showToast('Completa todos los campos del docente', 'err');
        return;
      }

      // Validar datos antes de enviar
      if (!validateTeacherData(firstName, lastName, documentId, email)) {
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/create-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            email,
            password,
            role: 'docente',
            first_name: firstName,
            last_name: lastName,
            document_id: documentId,
          }),
        });

        if (res.ok) {
          const authData = await res.json();
          const userId = authData?.user_id;

          if (userId) {
            await createTeacherRecord(userId, firstName, lastName, email, documentId, careerCode);
          }

          showToast('âœ“ Docente creado correctamente', 'ok');
          document.getElementById('teacher-first-name').value = '';
          document.getElementById('teacher-last-name').value = '';
          document.getElementById('teacher-email').value = '';
          document.getElementById('teacher-document').value = '';
          document.getElementById('teacher-password').value = '';
          const teacherCareer = document.getElementById('teacher-career');
          if (teacherCareer) teacherCareer.value = '';
          loadTeachers();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al crear docente', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    function getCareerCodeByCourse(course) {
      if (!course) return '';
      const career = ACADEMIC_CAREERS.find(c => Number(c.id) === Number(course.career_id));
      return career?.code || '';
    }

    function getCareerNameByCode(careerCode) {
      if (!careerCode) return '';
      const career = ACADEMIC_CAREERS.find(c => c.code === careerCode);
      return career ? `${career.code} â€” ${career.name}` : careerCode;
    }

    function getCareerNameByCourse(course) {
      if (!course) return 'â€”';
      const career = ACADEMIC_CAREERS.find(c => Number(c.id) === Number(course.career_id));
      if (!career) return 'â€”';
      return `${career.code} â€” ${career.name}`;
    }

    function getTeacherFixedCareerCode(teacher) {
      if (!teacher) return '';
      if (teacher.career_code) return teacher.career_code;
      if (Array.isArray(teacher.career_codes)) {
        const firstCareerCode = teacher.career_codes.find(code => !!code);
        if (firstCareerCode) return firstCareerCode;
      }
      return '';
    }

    function getTeacherDisplayLabel(teacher) {
      if (!teacher) return 'Docente';
      const fullName = getTeacherDisplayName(teacher);
      const doc = teacher.document_id || 'Sin cÃ©dula';
      const fixedCareer = teacher.career_code || (Array.isArray(teacher.career_codes) ? teacher.career_codes[0] : '');
      const careerLabel = getCareerNameByCode(fixedCareer);
      return careerLabel ? `${doc} - ${fullName} (${careerLabel})` : `${doc} - ${fullName}`;
    }

    function goAcademicAdminTab(tab) {
      if (tab === 'teachers') {
        goTo('teachers', document.getElementById('nav-teachers'));
        return;
      }
      if (tab === 'courses') {
        goTo('materias', document.getElementById('nav-materias'));
        return;
      }
      goTo('assignments', document.getElementById('nav-assignments'));
    }

    function setAcademicAdminTabState(section) {
      const tabBySection = {
        teachers: 'teachers',
        materias: 'courses',
        assignments: 'assignments',
      };
      const activeTab = tabBySection[section] || '';
      document.querySelectorAll('[data-academic-tabs] .academic-admin-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === activeTab);
      });
    }

    function getFilteredItems(items, searchText, toSearchText) {
      if (!searchText) return [...items];
      return items.filter(item => normalizeText(toSearchText(item)).includes(searchText));
    }

    function fillSelectOptions(selectElement, items, emptyLabel, getValue, getLabel, keepValue = true) {
      if (!selectElement) return;
      const previous = keepValue ? selectElement.value : '';
      selectElement.innerHTML = `<option value="">${emptyLabel}</option>` + items.map(item => (
        `<option value="${getValue(item)}">${getLabel(item)}</option>`
      )).join('');
      if (previous && items.some(item => String(getValue(item)) === String(previous))) {
        selectElement.value = previous;
      }
    }

    function normalizeText(value) {
      return (value || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function onAssignmentCareerChange() {
      const courseSearchInput = document.getElementById('assign-course-search');
      const courseSelect = document.getElementById('assign-course-select');
      const teacherSearchInput = document.getElementById('assign-teacher-search');
      const teacherSelect = document.getElementById('assign-teacher-select');

      if (courseSearchInput) courseSearchInput.value = '';
      if (courseSelect) courseSelect.value = '';
      if (teacherSearchInput) teacherSearchInput.value = '';
      if (teacherSelect) teacherSelect.value = '';

      populateAssignmentCourseSelect();
      populateAssignmentTeacherSelect();
    }

    function onAssignmentCourseChange() {
      const teacherSearchInput = document.getElementById('assign-teacher-search');
      const teacherSelect = document.getElementById('assign-teacher-select');
      if (teacherSearchInput) teacherSearchInput.value = '';
      if (teacherSelect) teacherSelect.value = '';
      populateAssignmentTeacherSelect();
    }

    function populateAssignmentTeacherSelect() {
      const teacherSelect = document.getElementById('assign-teacher-select');
      if (!teacherSelect) return;

      const careerCode = document.getElementById('assign-course-career-filter')?.value || '';
      const courseId = Number(document.getElementById('assign-course-select')?.value || 0);
      const teacherSearchInput = document.getElementById('assign-teacher-search');
      const hint = document.getElementById('assign-rule-hint');
      const selectedCourse = COURSES.find(c => Number(c.id) === courseId);
      const selectedCourseCareer = getCareerCodeByCourse(selectedCourse) || careerCode;

      if (!careerCode) {
        if (teacherSearchInput) {
          teacherSearchInput.value = '';
          teacherSearchInput.disabled = true;
        }
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Selecciona carrera primero</option>';
        if (hint) hint.textContent = 'Paso 1: selecciona carrera. Paso 2: elige materia. Paso 3: selecciona docente permitido.';
        return;
      }

      if (!courseId) {
        if (teacherSearchInput) {
          teacherSearchInput.value = '';
          teacherSearchInput.disabled = true;
        }
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Selecciona materia primero</option>';
        if (hint) hint.textContent = 'Selecciona una materia para habilitar docentes.';
        return;
      }

      if (teacherSearchInput) teacherSearchInput.disabled = false;
      teacherSelect.disabled = false;

      const search = normalizeText(document.getElementById('assign-teacher-search')?.value || '');
      const filteredTeachers = getFilteredItems(
        TEACHERS.filter(t => {
          const fixedCareerCode = getTeacherFixedCareerCode(t);
          return !fixedCareerCode || fixedCareerCode === selectedCourseCareer;
        }),
        search,
        t => `${t.document_id || ''} ${t.name || ''} ${t.first_name || ''} ${t.last_name || ''}`,
      );

      fillSelectOptions(
        teacherSelect,
        filteredTeachers,
        `Selecciona un docente (${filteredTeachers.length})`,
        t => t.id,
        t => getTeacherDisplayLabel(t),
        true,
      );

      if (hint) {
        hint.textContent = filteredTeachers.length
          ? 'Selecciona un docente para completar la asignaciÃ³n.'
          : 'No hay docentes disponibles para la carrera y materia seleccionadas.';
      }
    }

    function populateAssignmentCourseSelect() {
      const courseSelect = document.getElementById('assign-course-select');
      const hint = document.getElementById('assign-rule-hint');
      const detectedCareer = document.getElementById('assign-detected-career');
      const careerFilterControl = document.getElementById('assign-course-career-filter');
      const courseSearchInput = document.getElementById('assign-course-search');
      if (!courseSelect) return;

      const selectedCareerFilter = careerFilterControl?.value || '';
      if (!selectedCareerFilter) {
        if (courseSearchInput) courseSearchInput.disabled = true;
        courseSelect.disabled = true;
        courseSelect.innerHTML = '<option value="">Selecciona una carrera primero</option>';
        if (detectedCareer) detectedCareer.textContent = 'Carrera detectada: â€”';
        if (hint) {
          hint.textContent = 'Paso 1: selecciona carrera. Paso 2: elige materia. Paso 3: selecciona docente permitido.';
        }
        return;
      }

      if (courseSearchInput) courseSearchInput.disabled = false;
      courseSelect.disabled = false;
      const courseSearch = normalizeText(courseSearchInput?.value || '');
      const previousCourseId = courseSelect.value;

      let availableCourses = [...COURSES];
      if (selectedCareerFilter) {
        availableCourses = availableCourses.filter(course => getCareerCodeByCourse(course) === selectedCareerFilter);
      }
      if (courseSearch) {
        availableCourses = availableCourses.filter(course => {
          const text = normalizeText(`${course.code || ''} ${course.name || ''}`);
          return text.includes(courseSearch);
        });
      }

      availableCourses.sort((a, b) => {
        const aCode = (a.code || '').toString();
        const bCode = (b.code || '').toString();
        return aCode.localeCompare(bCode);
      });

      courseSelect.innerHTML = `<option value="">Selecciona un curso (${availableCourses.length})</option>` + availableCourses.map(course => {
        const careerCode = getCareerCodeByCourse(course);
        const label = `${course.code || `Curso ${course.id}`} â€” ${course.name || 'Sin nombre'}`;
        return `<option value="${course.id}">${label}${careerCode ? ` (${careerCode})` : ''}</option>`;
      }).join('');

      if (previousCourseId && availableCourses.some(c => String(c.id) === String(previousCourseId))) {
        courseSelect.value = previousCourseId;
      }

      if (hint) {
        hint.textContent = availableCourses.length
          ? 'Selecciona una materia para habilitar docentes.'
          : 'No hay materias disponibles para la carrera seleccionada.';
      }

      if (detectedCareer) {
        const detectedLabel = getCareerNameByCode(selectedCareerFilter);
        detectedCareer.textContent = `Carrera detectada: ${detectedLabel}`;
      }
    }

    function updateAssignmentKpis(assignments) {
      const total = assignments.length;
      const teacherSet = new Set(assignments.map(a => a.teacher_id));
      const courseSet = new Set(assignments.map(a => a.course_id));
      setText('assign-kpi-total', String(total));
      setText('assign-kpi-teachers', String(teacherSet.size));
      setText('assign-kpi-courses', String(courseSet.size));
    }

    function populateAssignmentFilters(assignments) {
      const teacherFilter = document.getElementById('assign-teacher-filter');
      const courseFilter = document.getElementById('assign-course-filter');
      const careerFilter = document.getElementById('assign-career-filter');
      const teacherFilterSearch = normalizeText(document.getElementById('assign-teacher-filter-search')?.value || '');
      const courseFilterSearch = normalizeText(document.getElementById('assign-course-filter-search')?.value || '');

      const selectedCareer = careerFilter?.value || '';
      const selectedCourse = courseFilter?.value || '';
      const selectedTeacher = teacherFilter?.value || '';

      if (careerFilter) {
        const options = ACADEMIC_CAREERS.map(c => `<option value="${c.code}">${c.code} â€” ${c.name}</option>`).join('');
        careerFilter.innerHTML = '<option value="">Todas las carreras</option>' + options;
        if (selectedCareer && ACADEMIC_CAREERS.some(c => c.code === selectedCareer)) {
          careerFilter.value = selectedCareer;
        }
      }

      const assignmentsByCareer = selectedCareer
        ? assignments.filter(a => {
            const course = COURSES.find(c => Number(c.id) === Number(a.course_id));
            return getCareerCodeByCourse(course) === selectedCareer;
          })
        : [...assignments];

      if (courseFilter) {
        const assignedCourseIds = [...new Set(assignmentsByCareer.map(a => Number(a.course_id)))];
        const assignedCourses = COURSES.filter(c => assignedCourseIds.includes(Number(c.id)));
        const filteredCourses = getFilteredItems(
          assignedCourses,
          courseFilterSearch,
          c => `${c.code || ''} ${c.name || ''}`,
        );
        fillSelectOptions(
          courseFilter,
          filteredCourses,
          `Todos los cursos (${filteredCourses.length})`,
          c => c.id,
          c => `${c.code || `Curso ${c.id}`} â€” ${c.name || 'Sin nombre'}`,
          true,
        );
        if (selectedCourse && filteredCourses.some(c => String(c.id) === String(selectedCourse))) {
          courseFilter.value = selectedCourse;
        }
      }

      if (teacherFilter) {
        const assignmentsByCourse = selectedCourse
          ? assignmentsByCareer.filter(a => String(a.course_id) === String(selectedCourse))
          : assignmentsByCareer;
        const allowedTeacherIds = new Set(assignmentsByCourse.map(a => Number(a.teacher_id)));
        const allowedTeachers = TEACHERS.filter(t => allowedTeacherIds.has(Number(t.id)));
        const filteredTeachers = getFilteredItems(
          allowedTeachers,
          teacherFilterSearch,
          t => `${t.document_id || ''} ${t.name || ''} ${t.first_name || ''} ${t.last_name || ''}`,
        );
        fillSelectOptions(
          teacherFilter,
          filteredTeachers,
          `Todos los docentes (${filteredTeachers.length})`,
          t => t.id,
          t => getTeacherDisplayLabel(t),
          true,
        );
        if (selectedTeacher && filteredTeachers.some(t => String(t.id) === String(selectedTeacher))) {
          teacherFilter.value = selectedTeacher;
        }
      }
    }

    async function loadAssignments() {
      try {
        if (ACADEMIC_CAREERS.length === 0) await loadCareers();
        if (COURSES.length === 0) await loadAcademic();
        if (TEACHERS.length === 0) await loadTeachers();

        const res = await fetch(`${API_BASE}/academic/api/assignments/`, {
          headers: getAuthHeaders(),
        });
        const tbody = document.getElementById('assignments-tbody');
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="big">âš </div>No se pueden cargar asignaciones</div></td></tr>';
          return;
        }

        const assignments = await res.json();
        ASSIGNMENTS = Array.isArray(assignments) ? assignments : [];

        // Completar metadatos de cursos que no estÃ©n en cachÃ© local para evitar etiquetas tipo "Curso 215".
        const missingCourseIds = [...new Set(ASSIGNMENTS.map(a => Number(a.course_id)))].filter(courseId => {
          return !COURSES.some(c => Number(c.id) === Number(courseId));
        });

        if (missingCourseIds.length > 0) {
          const courseRequests = missingCourseIds.map(courseId =>
            fetch(`${API_BASE}/academic/api/courses/${courseId}`, { headers: getAuthHeaders() })
          );
          const courseResponses = await Promise.allSettled(courseRequests);
          for (const entry of courseResponses) {
            if (entry.status !== 'fulfilled' || !entry.value.ok) continue;
            const course = await entry.value.json().catch(() => null);
            if (course && !COURSES.some(c => Number(c.id) === Number(course.id))) {
              COURSES.push(course);
            }
          }
        }

        updateAssignmentKpis(ASSIGNMENTS);
        populateAssignmentFilters(ASSIGNMENTS);
        populateAssignmentCourseSelect();
        populateAssignmentTeacherSelect();

        if (ASSIGNMENTS.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="big">ðŸ“­</div>No hay asignaciones. Crea la primera desde el formulario superior.</div></td></tr>';
          return;
        }

        const teacherFilter = document.getElementById('assign-teacher-filter')?.value || '';
        const courseFilter = document.getElementById('assign-course-filter')?.value || '';
        const careerFilter = document.getElementById('assign-career-filter')?.value || '';

        const filtered = ASSIGNMENTS.filter(a => {
          const teacher = TEACHERS.find(t => Number(t.id) === Number(a.teacher_id));
          const course = COURSES.find(c => Number(c.id) === Number(a.course_id));
          const teacherLabel = normalizeText(`${teacher?.document_id || ''} ${teacher?.name || ''} ${teacher?.first_name || ''} ${teacher?.last_name || ''}`);
          const courseLabel = normalizeText(`${course?.code || ''} ${course?.name || ''}`);
          const courseCareerCode = getCareerCodeByCourse(course);
          if (teacherFilter && String(a.teacher_id) !== String(teacherFilter)) return false;
          if (courseFilter && String(a.course_id) !== String(courseFilter)) return false;
          if (careerFilter && courseCareerCode !== careerFilter) return false;

          return true;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="big">ðŸ”Ž</div>No hay resultados con esos filtros.</div></td></tr>';
          return;
        }

        tbody.innerHTML = filtered.map(a => {
          const teacher = TEACHERS.find(t => Number(t.id) === Number(a.teacher_id));
          const course = COURSES.find(c => Number(c.id) === Number(a.course_id));
          const teacherLabel = teacher ? getTeacherDisplayName(teacher) : `Docente ${a.teacher_id}`;
          const courseLabel = course ? `${course.code || `Curso ${course.id}`} â€” ${course.name || 'Sin nombre'}` : `Curso ${a.course_id}`;
          const careerLabel = getCareerNameByCourse(course);
          return `
            <tr>
              <td><code style="font-size: .72rem; color: var(--accent)">${a.id}</code></td>
              <td>${careerLabel}</td>
              <td>${courseLabel}</td>
              <td>${teacherLabel}</td>
              <td>
                <button class="btn btn-secondary" style="padding:.35rem .7rem" onclick="startAssignmentEdit(${a.id})">Editar</button>
                <button class="btn btn-secondary" style="padding:.35rem .7rem" onclick="removeAssignment(${a.id})">Quitar</button>
              </td>
            </tr>
          `;
        }).join('');
      } catch (e) {
        showToast('âœ— Error al cargar asignaciones', 'err');
      }
    }

    async function removeAssignment(assignmentId) {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para eliminar asignaciones', 'err');
        return;
      }
      if (!confirm('Â¿Quitar esta asignaciÃ³n?')) return;

      try {
        const res = await fetch(`${API_BASE}/academic/api/assignments/${assignmentId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          showToast('âœ“ AsignaciÃ³n eliminada', 'ok');
          await loadTeachers();
          await loadAssignments();
          return;
        }
        const data = await res.json().catch(() => null);
        showToast(data?.detail || 'âœ— No se pudo eliminar la asignaciÃ³n', 'err');
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n al eliminar', 'err');
      }
    }

    function startAssignmentEdit(assignmentId) {
      const assignment = ASSIGNMENTS.find(a => Number(a.id) === Number(assignmentId));
      if (!assignment) return;

      ASSIGNMENT_EDITING_ID = Number(assignment.id);

      const teacherSelect = document.getElementById('assign-teacher-select');
      const courseSelect = document.getElementById('assign-course-select');
      const teacherSearch = document.getElementById('assign-teacher-search');
      const courseSearch = document.getElementById('assign-course-search');
      const banner = document.getElementById('assign-edit-banner');
      const bannerId = document.getElementById('assign-edit-id');
      const submitBtn = document.getElementById('assign-submit-btn');
      const cancelBtn = document.getElementById('assign-cancel-btn');

      if (teacherSearch) teacherSearch.value = '';
      if (courseSearch) courseSearch.value = '';
      const careerFilter = document.getElementById('assign-course-career-filter');
      const selectedCourse = COURSES.find(c => Number(c.id) === Number(assignment.course_id));
      const selectedCareerCode = getCareerCodeByCourse(selectedCourse);
      if (careerFilter) {
        careerFilter.value = selectedCareerCode || '';
      }
      onAssignmentCareerChange();
      if (courseSelect) courseSelect.value = String(assignment.course_id);
      onAssignmentCourseChange();
      if (teacherSelect) teacherSelect.value = String(assignment.teacher_id);

      if (banner) banner.style.display = 'block';
      if (bannerId) bannerId.textContent = `#${assignment.id}`;
      if (submitBtn) submitBtn.textContent = 'Guardar cambios';
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function cancelAssignmentEdit() {
      ASSIGNMENT_EDITING_ID = null;
      const teacherSelect = document.getElementById('assign-teacher-select');
      const courseSelect = document.getElementById('assign-course-select');
      const careerFilter = document.getElementById('assign-course-career-filter');
      const teacherSearch = document.getElementById('assign-teacher-search');
      const courseSearch = document.getElementById('assign-course-search');
      if (teacherSelect) teacherSelect.value = '';
      if (courseSelect) courseSelect.value = '';
      if (careerFilter) careerFilter.value = '';
      if (teacherSearch) teacherSearch.value = '';
      if (courseSearch) courseSearch.value = '';

      const banner = document.getElementById('assign-edit-banner');
      const submitBtn = document.getElementById('assign-submit-btn');
      const cancelBtn = document.getElementById('assign-cancel-btn');
      if (banner) banner.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Asignar';
      if (cancelBtn) cancelBtn.style.display = 'none';
      onAssignmentCareerChange();
    }

    async function assignTeacher() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para asignar docentes', 'err');
        return;
      }

      const teacherId = Number(document.getElementById('assign-teacher-select').value);
      const courseId = Number(document.getElementById('assign-course-select').value);

      if (!teacherId || !courseId) {
        showToast('Selecciona docente y curso', 'err');
        return;
      }

      const teacher = TEACHERS.find(t => Number(t.id) === teacherId);
      const course = COURSES.find(c => Number(c.id) === courseId);
      const selectedCareer = document.getElementById('assign-course-career-filter')?.value || '';
      const fixedCareerCode = getTeacherFixedCareerCode(teacher);
      const courseCareerCode = getCareerCodeByCourse(course);

      if (selectedCareer && courseCareerCode && selectedCareer !== courseCareerCode) {
        showToast('âœ— La materia no pertenece a la carrera seleccionada', 'err');
        return;
      }

      if (fixedCareerCode && fixedCareerCode !== courseCareerCode) {
        showToast(`âœ— ${fixedCareerCode}: este docente no puede dictar materias de ${courseCareerCode || 'otra carrera'}`, 'err');
        return;
      }

      const exists = ASSIGNMENTS.some(a => Number(a.teacher_id) === teacherId && Number(a.course_id) === courseId);
      if (exists && !ASSIGNMENT_EDITING_ID) {
        showToast('âœ— Ese docente ya estÃ¡ asignado a esa materia', 'err');
        return;
      }

      try {
        const endpoint = ASSIGNMENT_EDITING_ID
          ? `${API_BASE}/academic/api/assignments/${ASSIGNMENT_EDITING_ID}`
          : `${API_BASE}/academic/api/assignments/`;
        const method = ASSIGNMENT_EDITING_ID ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            teacher_id: teacherId,
            course_id: courseId,
          }),
        });

        if (res.ok) {
          showToast(ASSIGNMENT_EDITING_ID ? 'âœ“ AsignaciÃ³n actualizada' : 'âœ“ Docente asignado al curso', 'ok');
          cancelAssignmentEdit();
          await loadTeachers();
          await loadAssignments();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al asignar', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    // â”€â”€â”€ Funciones para MatriculaciÃ³n de Estudiantes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ALL_STUDENTS = [];
    let ALL_CAREERS = [];
    let ALL_COURSES_BY_CAREER = {};
    let ALL_STUDENTS_FILTERED = [];

    function filterStudents() {
      const searchInput = document.getElementById('enroll-student-search');
      const searchTerm = searchInput.value.toLowerCase().trim();
      const studentSelect = document.getElementById('enroll-student-select');
      
      if (!searchTerm) {
        // Si estÃ¡ vacÃ­o, mostrar todos
        ALL_STUDENTS_FILTERED = [...ALL_STUDENTS];
      } else {
        // Filtrar por cÃ©dula, nombre o email
        ALL_STUDENTS_FILTERED = ALL_STUDENTS.filter(s => {
          const cedula = (s.document_id || '').toLowerCase();
          const nombre = (s.nombre || '').toLowerCase();
          const apellido = (s.apellido || '').toLowerCase();
          const email = (s.email || '').toLowerCase();
          
          return cedula.includes(searchTerm) || 
                 nombre.includes(searchTerm) || 
                 apellido.includes(searchTerm) || 
                 email.includes(searchTerm);
        });
      }

      // Actualizar el select con los resultados filtrados
      studentSelect.innerHTML = `<option value="">Selecciona un estudiante</option>` + 
        ALL_STUDENTS_FILTERED.map(s => {
          const cedula = s.document_id || 'N/A';
          const nombre = s.nombre || s.name || '';
          const apellido = s.apellido || '';
          const nombreCompleto = `${nombre} ${apellido}`.trim();
          return `<option value="${s.id}">${cedula} â€” ${nombreCompleto} (${s.email})</option>`;
        }).join('');
      
      console.log(`Estudiantes encontrados: ${ALL_STUDENTS_FILTERED.length}`);
    }

    async function loadEnrollmentsData() {
      console.log('ðŸ”„ Cargando datos de matriculaciÃ³n...');
      
      // Cargar carreras
      try {
        const resCareer = await fetch(`${API_BASE}/academic/api/careers/`, {
          headers: getAuthHeaders(),
        });
        if (resCareer.ok) {
          ALL_CAREERS = await resCareer.json();
          console.log('âœ“ Carreras cargadas:', ALL_CAREERS.length);
          const careerSelect = document.getElementById('enroll-career-select');
          careerSelect.innerHTML = `<option value="">Selecciona una carrera</option>` + 
            ALL_CAREERS.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
        }
      } catch (e) {
        console.error('âœ— Error al cargar carreras:', e);
        showToast('âœ— Error al cargar carreras', 'err');
      }

      // Cargar estudiantes
      try {
        console.log('Obteniendo estudiantes desde:', `${API_BASE}/students/`);
        const resStudents = await fetch(`${API_BASE}/students/`, {
          headers: getAuthHeaders(),
        });
        console.log('Respuesta students:', resStudents.status, resStudents.statusText);
        
        if (resStudents.ok) {
          const studentsData = await resStudents.json();
          console.log('Datos estudiantes recibidos:', studentsData);
          ALL_STUDENTS = Array.isArray(studentsData) ? studentsData : studentsData.students || [];
          ALL_STUDENTS_FILTERED = [...ALL_STUDENTS]; // Inicializar filtrados
          console.log('âœ“ Estudiantes cargados:', ALL_STUDENTS.length);
          
          filterStudents(); // Llenar el select inicial
        } else {
          const errorText = await resStudents.text();
          console.error('Error en respuesta de estudiantes:', errorText);
          showToast('âœ— Error al cargar estudiantes', 'err');
        }
      } catch (e) {
        console.error('âœ— Error al cargar estudiantes:', e);
        showToast('âœ— Error al cargar estudiantes', 'err');
      }

      // Cargar todos los cursos al inicio (con auth y lÃ­mite amplio)
      try {
        const resCourses = await fetch(`${API_BASE}/academic/api/courses/?limit=1000`, {
          headers: getAuthHeaders(),
        });
        if (resCourses.ok) {
          const allCourses = await resCourses.json();
          console.log('âœ“ Cursos cargados:', allCourses.length);
          // Agrupar cursos por carrera
          ALL_COURSES_BY_CAREER = {};
          allCourses.forEach(course => {
            const careerId = String(course.career_id || 'sin-carrera');
            if (!ALL_COURSES_BY_CAREER[careerId]) {
              ALL_COURSES_BY_CAREER[careerId] = [];
            }
            ALL_COURSES_BY_CAREER[careerId].push(course);
          });
        } else {
          const errText = await resCourses.text().catch(() => '');
          console.error('âœ— Error al cargar cursos:', resCourses.status, errText);
          showToast('âœ— No se pudieron cargar cursos iniciales', 'err');
        }
      } catch (e) {
        console.error('âœ— Error al cargar cursos:', e);
        showToast('âœ— Error al cargar cursos', 'err');
      }

      ENROLLMENTS_ADMIN_PAGE = 1;
      loadEnrollmentsTable(1);
    }

    async function loadCoursesForCareer(forceReload = false) {
      const careerId = document.getElementById('enroll-career-select').value;
      const courseSelect = document.getElementById('enroll-course-select');

      if (!careerId) {
        courseSelect.innerHTML = `<option value="">Selecciona una carrera primero</option>`;
        return;
      }

      const cacheKey = String(careerId);
      let courses = ALL_COURSES_BY_CAREER[cacheKey] || [];

      if (forceReload || courses.length === 0) {
        courseSelect.innerHTML = `<option value="">Cargando cursos...</option>`;
        try {
          const res = await fetch(`${API_BASE}/academic/api/courses/?career_id=${encodeURIComponent(careerId)}&limit=1000`, {
            headers: getAuthHeaders(),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('âœ— Error al consultar cursos por carrera:', res.status, errText);
            courseSelect.innerHTML = `<option value="">No se pudieron cargar cursos</option>`;
            return;
          }

          courses = await res.json();
          ALL_COURSES_BY_CAREER[cacheKey] = Array.isArray(courses) ? courses : [];
          courses = ALL_COURSES_BY_CAREER[cacheKey];
        } catch (e) {
          console.error('âœ— Error al consultar cursos por carrera:', e);
          courseSelect.innerHTML = `<option value="">Error de conexiÃ³n al cargar cursos</option>`;
          return;
        }
      }

      if (courses.length === 0) {
        courseSelect.innerHTML = `<option value="">No hay cursos en esta carrera</option>`;
        return;
      }

      courseSelect.innerHTML = `<option value="">Selecciona un curso</option>` + 
        courses.map(c => {
          const maxS = c.max_students;
          let badge = '';
          if (maxS) {
            // Conteo real se carga en `renderEnrollmentCounts` â€” aquÃ­ solo mostramos el lÃ­mite configurado
            badge = ` [cupo: ${maxS}]`;
          }
          return `<option value="${c.id}">${c.code || c.id} â€” ${c.name}${badge}</option>`;
        }).join('');
    }

    async function enrollStudent() {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para matricular estudiantes', 'err');
        return;
      }

      const studentId = Number(document.getElementById('enroll-student-select').value);
      const courseId = Number(document.getElementById('enroll-course-select').value);

      if (!studentId || !courseId) {
        showToast('Selecciona estudiante y curso', 'err');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/enrollments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            student_id: studentId,
            course_id: courseId,
            status: 'activa',
          }),
        });

        if (res.ok) {
          showToast('âœ“ Estudiante matriculado correctamente', 'ok');
          document.getElementById('enroll-student-select').value = '';
          document.getElementById('enroll-student-search').value = '';
          document.getElementById('enroll-course-select').value = '';
          document.getElementById('enroll-career-select').value = '';
          filterStudents(); // Resetear filtro
          loadEnrollmentsTable();
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al matricular', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    function updateEnrollmentsAdminPager() {
      const label = document.getElementById('enrollments-admin-page-label');
      if (!label) return;
      const from = ENROLLMENTS_ADMIN_TOTAL === 0 ? 0 : ((ENROLLMENTS_ADMIN_PAGE - 1) * ENROLLMENTS_ADMIN_LIMIT) + 1;
      const to = Math.min(ENROLLMENTS_ADMIN_TOTAL, ENROLLMENTS_ADMIN_PAGE * ENROLLMENTS_ADMIN_LIMIT);
      const totalPages = Math.max(1, Math.ceil(ENROLLMENTS_ADMIN_TOTAL / ENROLLMENTS_ADMIN_LIMIT));
      label.textContent = `PÃ¡gina ${ENROLLMENTS_ADMIN_PAGE}/${totalPages} Â· ${from}-${to} de ${ENROLLMENTS_ADMIN_TOTAL}`;
    }

    async function loadEnrollmentsTable(page = ENROLLMENTS_ADMIN_PAGE) {
      try {
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * ENROLLMENTS_ADMIN_LIMIT;
        const res = await fetch(`${API_BASE}/enrollments/?limit=${ENROLLMENTS_ADMIN_LIMIT}&offset=${offset}`, {
          headers: getAuthHeaders(),
        });
        const tbody = document.getElementById('enrollments-admin-tbody');

        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">âš </div>No se pueden cargar matriculaciones</div></td></tr>';
          return;
        }

        const payload = await res.json();
        const enrollments = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : []);
        ENROLLMENTS_ADMIN_TOTAL = Array.isArray(payload) ? payload.length : Number(payload.total || 0);
        ENROLLMENTS_ADMIN_PAGE = safePage;
        updateEnrollmentsAdminPager();

        if (!Array.isArray(enrollments) || enrollments.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">ðŸ“­</div>No hay matriculaciones</div></td></tr>';
          return;
        }

        const rows = await Promise.all(enrollments.map(async e => {
          const course = await fetchCourse(e.course_id);
          // Buscar por id del servicio de estudiantes o por user_id (auth) para compatibilidad
          const student = ALL_STUDENTS.find(s => s.id === e.student_id)
                       || ALL_STUDENTS.find(s => s.user_id === e.student_id);
          const cedula = student?.document_id || 'N/A';
          const nombreCompleto = student ? `${student.nombre || ''} ${student.apellido || ''}`.trim() || student.email : `ID ${e.student_id}`;
          const email = student?.email || 'â€”';
          const courseName = course?.name || `Curso ${e.course_id}`;
          const realStudentId = student?.id || null;

          return `
            <tr>
              <td><code style="font-size: .7rem; color: var(--accent)">${e.id}</code></td>
              <td><strong>${cedula}</strong></td>
              <td>${nombreCompleto}</td>
              <td>${email}</td>
              <td>${courseName}</td>
              <td><span class="badge badge-activo">${e.status || 'activa'}</span></td>
              <td>${new Date(e.enrollment_date).toLocaleDateString('es-CO')}</td>
              <td style="display:flex;gap:.4rem;flex-wrap:wrap">
                <button class="btn btn-danger btn-sm" onclick="deleteEnrollment(${e.id})">Eliminar matrÃ­cula</button>
                ${realStudentId ? `<button class="btn btn-secondary btn-sm" onclick="confirmDeleteStudent(${realStudentId}, '${nombreCompleto.replace(/'/g, "&apos;")}')">Eliminar estudiante</button>` : ''}
              </td>
            </tr>
          `;
        }));

        tbody.innerHTML = rows.join('');
      } catch (e) {
        showToast('âœ— Error al cargar matriculaciones', 'err');
      }
    }

    async function deleteEnrollment(enrollmentId) {
      if (USER_ROLE !== 'admin') {
        showToast('âœ— No autorizado para eliminar matriculaciones', 'err');
        return;
      }

      if (!confirm('Â¿Eliminar esta matriculaciÃ³n?')) return;

      try {
        const res = await fetch(`${API_BASE}/enrollments/${enrollmentId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });

        if (res.ok) {
          showToast('âœ“ MatriculaciÃ³n eliminada', 'ok');
          loadEnrollmentsTable(ENROLLMENTS_ADMIN_PAGE);
        } else {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error al eliminar', 'err');
        }
      } catch (e) {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function confirmDeleteStudent(studentId, nombre) {
      if (USER_ROLE !== 'admin') { showToast('âœ— No autorizado', 'err'); return; }
      if (!confirm(`Â¿Eliminar permanentemente al estudiante "${nombre}"?\nEsta acciÃ³n no se puede deshacer.`)) return;
      await deleteStudent(studentId);
      loadEnrollmentsData();
      loadStudentsManagement();
    }

    async function loadStudentsManagement() {
      const tbody = document.getElementById('students-mgmt-tbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">â—Œ</div>Cargando...</div></td></tr>';
      try {
        const res = await fetch(`${API_BASE}/students/`, { headers: getAuthHeaders() });
        if (!res.ok) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">âš </div>Error al cargar estudiantes.</div></td></tr>'; return; }
        const students = await res.json();
        const list = Array.isArray(students) ? students : students.students || [];
        if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">ðŸ“­</div>No hay estudiantes.</div></td></tr>'; return; }
        tbody.innerHTML = list.map(s => {
          const nombre = `${s.nombre || ''} ${s.apellido || ''}`.trim() || s.email;
          const estadoBadge = s.status === 'activo'
            ? `<span class="badge badge-activo">${s.status}</span>`
            : `<span class="badge" style="background:#666">${s.status || 'â€”'}</span>`;
          return `<tr>
            <td><code style="font-size:.7rem;color:var(--accent)">${s.id}</code></td>
            <td>${s.document_id || 'â€”'}</td>
            <td>${nombre}</td>
            <td>${s.email || 'â€”'}</td>
            <td>${s.program || 'â€”'}</td>
            <td>${estadoBadge}</td>
            <td><button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent(${s.id}, '${nombre.replace(/'/g, '&apos;')}')">Eliminar</button></td>
          </tr>`;
        }).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">âš </div>Error de conexiÃ³n.</div></td></tr>';
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // BUZONES DE ACTIVIDADES (dentro de grades service)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let currentBuzonId = null;
    let currentBuzonTitle = '';

    async function initBuzonesSection(role) {
      const teacher = document.getElementById('buzones-teacher-panel');
      const student = document.getElementById('buzones-student-panel');
      if (teacher) teacher.style.display = role === 'docente' ? '' : 'none';
      if (student) student.style.display = role === 'estudiante' ? '' : 'none';
      await loadBuzonCourses();
    }

    async function loadBuzonCourses() {
      try {
        let courses = [];
        if (USER_ROLE === 'docente') {
          const res = await fetch(`${API_BASE}/academic/api/courses/`, { headers: getAuthHeaders() });
          if (!res.ok) return;
          courses = await res.json();
        } else if (USER_ROLE === 'estudiante') {
          courses = await getMyCurrentCourses();
        }

        if (!Array.isArray(courses)) return;
        const opts = courses.map(c => `<option value="${c.id}">${c.code ? c.code + ' â€” ' : ''}${c.name}</option>`).join('');
        const placeholder = '<option value="">â€” Selecciona un curso â€”</option>';
        const studentPlaceholder = '<option value="">â€” Todos tus cursos â€”</option>';

        if (USER_ROLE === 'docente') {
          ['buz-teacher-course', 'cb-course-id'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = placeholder + opts;
          });
        } else if (USER_ROLE === 'estudiante') {
          const sel = document.getElementById('buz-student-course');
          if (sel) {
            sel.innerHTML = studentPlaceholder + opts;
            restoreStudentActivityFilters();
          }
        }

        const activeSection = document.querySelector('.section.active');
        if (activeSection && activeSection.id === 'sec-buzones' && courses.length > 0) {
          if (USER_ROLE === 'docente') {
            const sel = document.getElementById('buz-teacher-course');
            if (sel && !sel.value) sel.value = String(courses[0].id);
            loadTeacherBuzones();
          } else if (USER_ROLE === 'estudiante') {
            loadStudentBuzones();
          }
        }
      } catch { /* silencioso */ }
    }

    function openCreateBuzonModal() {
      // Sincronizar courses en modal tambiÃ©n (por si aÃºn no cargaron)
      const src = document.getElementById('buz-teacher-course');
      const dst = document.getElementById('cb-course-id');
      if (src && dst && src.options.length > 1 && dst.options.length <= 1) {
        dst.innerHTML = src.innerHTML;
      }
      // Pre-seleccionar el curso del filtro si ya se eligiÃ³ uno
      if (src && src.value && dst) dst.value = src.value;
      document.getElementById('modal-create-buzon').style.display = 'flex';
    }

    async function loadTeacherBuzones() {
      const courseId = document.getElementById('buz-teacher-course').value;
      const tbody = document.getElementById('teacher-buzones-tbody');
      let url = `${API_BASE}/grades/buzones`;
      if (courseId) url += `?course_id=${courseId}`;

      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">â—Œ</div>Cargando...</div></td></tr>';
      try {
        const res = await apiFetch(url);
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="6">Error cargando buzones</td></tr>';
          return;
        }
        const data = await res.json();
        if (!data.length) {
          tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="big">ðŸ“­</div>No hay buzones.</div></td></tr>';
          return;
        }
        tbody.innerHTML = data.map(b => {
          const due = b.due_date ? new Date(b.due_date).toLocaleString('es-CO') : 'â€”';
          const pesoLabel = b.weight > 0 ? `<span style="color:#a78bfa;font-weight:600;">${b.weight}%</span>` : '<span style="color:var(--muted);">â€”</span>';
          return `<tr>
            <td>${b.id}</td>
            <td>${b.title}</td>
            <td>${due}</td>
            <td>${pesoLabel}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="loadSubmissions(${b.id}, '${b.title.replace(/'/g, '&apos;')}')">Ver envÃ­os</button></td>
            <td><button class="btn btn-danger btn-sm" onclick="deleteBuzon(${b.id})">Eliminar</button></td>
          </tr>`;
        }).join('');
      } catch {
        tbody.innerHTML = '<tr><td colspan="6">Error de conexiÃ³n</td></tr>';
      }
    }

    async function createBuzon() {
      const courseId = parseInt(document.getElementById('cb-course-id').value, 10);
      const title = document.getElementById('cb-title').value.trim();
      const dueDateRaw = document.getElementById('cb-due-date').value;
      const weight = parseFloat(document.getElementById('cb-weight').value) || 0;
      if (!courseId || !title) {
        showToast('âœ— Debes seleccionar un curso y escribir un tÃ­tulo', 'err');
        return;
      }

      const payload = {
        course_id: courseId,
        title,
        weight,
        due_date: dueDateRaw ? dueDateRaw : null,
      };

      try {
        const res = await apiFetch(`${API_BASE}/grades/buzones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— Error creando buzÃ³n', 'err');
          return;
        }
        showToast('âœ“ BuzÃ³n creado', 'ok');
        document.getElementById('modal-create-buzon').style.display = 'none';
        const filterSel = document.getElementById('buz-teacher-course');
        if (filterSel) filterSel.value = String(courseId);
        document.getElementById('cb-title').value = '';
        document.getElementById('cb-description').value = '';
        document.getElementById('cb-weight').value = '0';
        clearCalPicker('cb-due-date');
        loadTeacherBuzones();
      } catch {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function loadDefinitivas() {
      const courseId = document.getElementById('buz-teacher-course').value;
      if (!courseId) {
        showToast('âœ— Selecciona un curso primero', 'err');
        return;
      }
      const panel = document.getElementById('definitivas-panel');
      const tableWrap = document.getElementById('definitivas-table-wrap');
      const warning = document.getElementById('definitivas-weight-warning');
      panel.style.display = '';
      tableWrap.innerHTML = '<div class="empty-state"><div class="big">â—Œ</div>Cargando...</div>';
      warning.style.display = 'none';

      try {
        const res = await apiFetch(`${API_BASE}/grades/courses/${courseId}/definitivas`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          tableWrap.innerHTML = `<p style="color:#f87171;">${err?.detail || 'Error cargando definitivas'}</p>`;
          return;
        }
        const data = await res.json();

        if (!data.boxes || data.boxes.length === 0) {
          tableWrap.innerHTML = '<div class="empty-state"><div class="big">ðŸ“­</div>No hay buzones con peso > 0 en este curso.</div>';
          return;
        }

        // Advertencia si los pesos no suman 100
        if (Math.abs(data.total_weight - 100) > 0.5) {
          warning.style.display = '';
          warning.textContent = `âš  Los pesos suman ${data.total_weight}%, no 100%. La nota definitiva serÃ¡ proporcional al peso cubierto.`;
        }

        // Cabecera dinÃ¡mica
        const boxCols = data.boxes.map(b =>
          `<th style="color:#a78bfa;">${b.title}<br><small style="font-weight:normal;font-size:.7rem;">${b.weight}%</small></th>`
        ).join('');

        // Filas â€” necesitamos nombres de estudiantes
        const studentIds = [...new Set(data.students.map(s => s.student_id))];
        const nameMap = {};
        await Promise.all(studentIds.map(async id => {
          try {
            const st = await _fetchStudentById(id);
            nameMap[id] = st ? `${st.nombre} ${st.apellido}` : `ID ${id}`;
          } catch { nameMap[id] = `ID ${id}`; }
        }));

        const rows = data.students.map(s => {
          const scoreCells = data.boxes.map(b => {
            const det = s.detail.find(d => d.box_id === b.id);
            const nota = det?.score;
            const cell = nota !== null && nota !== undefined
              ? `<span style="color:${nota >= 3 ? '#4ade80' : '#f87171'};font-weight:600;">${parseFloat(nota).toFixed(1)}</span>`
              : '<span style="color:var(--muted);">â€”</span>';
            return `<td style="text-align:center;">${cell}</td>`;
          }).join('');

          const defColor = s.nota_final >= 3 ? '#4ade80' : '#f87171';
          const defCell = s.nota_final !== null && s.nota_final !== undefined
            ? `<span style="color:${defColor};font-weight:700;font-size:1.05rem;">${parseFloat(s.nota_final).toFixed(1)}</span>`
            : '<span style="color:var(--muted);">â€”</span>';

          const incomplete = !s.completo
            ? `<br><small style="color:#fbbf24;font-size:.7rem;">cubre ${s.covered_weight}%</small>`
            : '';

          return `<tr>
            <td>${nameMap[s.student_id]}</td>
            ${scoreCells}
            <td style="text-align:center;">${defCell}${incomplete}</td>
          </tr>`;
        }).join('');

        if (!rows) {
          tableWrap.innerHTML = '<div class="empty-state"><div class="big">ðŸ“­</div>AÃºn no hay calificaciones registradas.</div>';
          return;
        }

        tableWrap.innerHTML = `<table>
          <thead><tr>
            <th>Estudiante</th>
            ${boxCols}
            <th style="color:#f59e0b;">Definitiva</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      } catch (e) {
        tableWrap.innerHTML = `<p style="color:#f87171;">Error de conexiÃ³n</p>`;
      }
    }

    async function deleteBuzon(id) {
      if (!confirm('Â¿Eliminar este buzÃ³n y sus envÃ­os?')) return;
      try {
        const res = await apiFetch(`${API_BASE}/grades/buzones/${id}`, { method: 'DELETE' });
        if (res.ok || res.status === 204) {
          showToast('âœ“ BuzÃ³n eliminado', 'ok');
          loadTeacherBuzones();
          return;
        }
        const data = await res.json().catch(() => null);
        showToast(data?.detail || 'âœ— No se pudo eliminar', 'err');
      } catch {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    async function loadSubmissions(boxId, title) {
      currentBuzonId = boxId;
      currentBuzonTitle = title;
      document.getElementById('buzon-submissions-title').textContent = `EnvÃ­os â€” ${title}`;
      document.getElementById('buzon-submissions-panel').style.display = '';

      const tbody = document.getElementById('submissions-tbody');
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">â—Œ</div>Cargando...</div></td></tr>';
      try {
        const res = await apiFetch(`${API_BASE}/grades/buzones/${boxId}/submissions`);
        if (!res.ok) {
          tbody.innerHTML = '<tr><td colspan="7">Error cargando envÃ­os</td></tr>';
          return;
        }
        const rows = await res.json();
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="big">ðŸ“­</div>Sin envÃ­os.</div></td></tr>';
          return;
        }
        // Pre-cargar nombres de estudiantes en paralelo
        const studentNames = {};
        await Promise.all(rows.map(async s => {
          const st = await _fetchStudentById(s.student_id).catch(() => null);
          if (st) studentNames[s.student_id] = `${st.nombre || st.first_name || ''} ${st.apellido || st.last_name || ''}`.trim() || st.email || `#${s.student_id}`;
          else studentNames[s.student_id] = `#${s.student_id}`;
        }));
        tbody.innerHTML = rows.map(s => {
          const date = s.submitted_at ? new Date(s.submitted_at).toLocaleString('es-CO') : 'â€”';
          const fileLink = s.file_name
            ? `<a class="btn btn-secondary btn-sm" href="${API_BASE}/grades/submissions/${s.id}/file">â¬‡ ${s.file_name}</a>`
            : 'â€”';
          const score = s.score == null
            ? '<span style="color:var(--muted);font-style:italic;">Pendiente</span>'
            : `<span style="font-weight:700;font-size:1rem;color:var(--accent)">${parseFloat(s.score).toFixed(1)}</span>`;
          const comment = s.teacher_comment
            ? `<br><small style="color:var(--muted);">${s.teacher_comment}</small>`
            : '';
          const nombreEstudiante = studentNames[s.student_id] || `#${s.student_id}`;
          return `<tr>
            <td>${s.id}</td>
            <td>${nombreEstudiante}</td>
            <td>${date}</td>
            <td>${s.student_comment || 'â€”'}</td>
            <td>${fileLink}</td>
            <td>${score}${comment}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openGradeModal(${s.id}, ${s.score ?? ''})">Calificar</button></td>
          </tr>`;
        }).join('');
      } catch {
        tbody.innerHTML = '<tr><td colspan="7">Error de conexiÃ³n</td></tr>';
      }
    }

    function openGradeModal(submissionId, currentScore) {
      document.getElementById('grade-submission-id').value = submissionId;
      document.getElementById('grade-score').value = currentScore || '';
      document.getElementById('grade-comment').value = '';
      document.getElementById('modal-grade-submission').style.display = 'flex';
    }

    async function submitGrade() {
      const submissionId = document.getElementById('grade-submission-id').value;
      const score = parseFloat(document.getElementById('grade-score').value);
      const teacherComment = document.getElementById('grade-comment').value.trim() || null;
      if (Number.isNaN(score) || score < 0 || score > 5) {
        showToast('âœ— La nota debe estar entre 0.0 y 5.0', 'err');
        return;
      }

      try {
        const res = await apiFetch(`${API_BASE}/grades/submissions/${submissionId}/grade`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score, teacher_comment: teacherComment }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— No se pudo calificar', 'err');
          return;
        }
        showToast('âœ“ CalificaciÃ³n guardada', 'ok');
        document.getElementById('modal-grade-submission').style.display = 'none';
        if (currentBuzonId) loadSubmissions(currentBuzonId, currentBuzonTitle);
      } catch {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    function persistStudentActivityFilters() {
      const payload = {
        courseId: document.getElementById('buz-student-course')?.value || '',
        status: document.getElementById('buz-student-status')?.value || '',
        search: document.getElementById('buz-student-search')?.value || '',
        sort: document.getElementById('buz-student-sort')?.value || 'urgency',
      };
      localStorage.setItem('student_activity_filters', JSON.stringify(payload));
    }

    function restoreStudentActivityFilters() {
      try {
        const raw = localStorage.getItem('student_activity_filters');
        if (!raw) return;
        const payload = JSON.parse(raw);
        const courseEl = document.getElementById('buz-student-course');
        const statusEl = document.getElementById('buz-student-status');
        const searchEl = document.getElementById('buz-student-search');
        const sortEl = document.getElementById('buz-student-sort');
        if (courseEl && typeof payload.courseId === 'string') courseEl.value = payload.courseId;
        if (statusEl && typeof payload.status === 'string') statusEl.value = payload.status;
        if (searchEl && typeof payload.search === 'string') searchEl.value = payload.search;
        if (sortEl && typeof payload.sort === 'string') sortEl.value = payload.sort;
      } catch {}
    }

    function formatDateTimeEs(dateValue) {
      if (!dateValue) return 'Sin fecha lÃ­mite';
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return 'Sin fecha lÃ­mite';
      return date.toLocaleString('es-CO', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    }

    function getDeadlineTone(dueDate, submission) {
      if (submission?.score != null) return { key: 'graded', label: 'Calificada', rank: 5 };
      if (submission) return { key: 'submitted', label: 'Entregada', rank: 4 };
      if (!dueDate) return { key: 'pending', label: 'Pendiente', rank: 3 };

      const due = new Date(dueDate);
      const now = new Date();
      if (Number.isNaN(due.getTime())) return { key: 'pending', label: 'Pendiente', rank: 3 };

      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const diffDays = Math.floor((startDue - startToday) / 86400000);

      if (due.getTime() < now.getTime()) return { key: 'overdue', label: 'Vencida', rank: 0 };
      if (diffDays === 0) return { key: 'today', label: 'Vence hoy', rank: 1 };
      if (diffDays <= 3) return { key: 'upcoming', label: 'PrÃ³xima', rank: 2 };
      return { key: 'pending', label: 'Pendiente', rank: 3 };
    }

    function getRelativeDueText(dueDate, submission) {
      if (submission?.score != null) return `Calificada ${submission.graded_at ? formatDateTimeEs(submission.graded_at) : ''}`.trim();
      if (submission?.submitted_at) return `Entregada ${formatDateTimeEs(submission.submitted_at)}`;
      if (!dueDate) return 'Sin fecha lÃ­mite';

      const due = new Date(dueDate);
      const now = new Date();
      if (Number.isNaN(due.getTime())) return 'Sin fecha lÃ­mite';

      const diffMs = due.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / 86400000);
      const sameDay = due.toDateString() === now.toDateString();

      if (diffMs < 0) {
        const overdueDays = Math.max(1, Math.ceil(Math.abs(diffMs) / 86400000));
        return overdueDays === 1 ? 'VenciÃ³ hace 1 dÃ­a' : `VenciÃ³ hace ${overdueDays} dÃ­as`;
      }
      if (sameDay) return `Vence hoy a las ${formatTime(due.toTimeString().slice(0, 5))}`;
      if (diffDays <= 0) return 'Vence pronto';
      if (diffDays === 1) return 'Vence en 1 dÃ­a';
      return `Vence en ${diffDays} dÃ­as`;
    }

    function renderStudentActivityKpis(items) {
      const pending = items.filter(item => ['pending', 'upcoming', 'today'].includes(item.status.key)).length;
      const today = items.filter(item => item.status.key === 'today').length;
      const overdue = items.filter(item => item.status.key === 'overdue').length;
      const submitted = items.filter(item => ['submitted', 'graded'].includes(item.status.key)).length;
      setText('student-activities-kpi-pending', String(pending));
      setText('student-activities-kpi-today', String(today));
      setText('student-activities-kpi-overdue', String(overdue));
      setText('student-activities-kpi-submitted', String(submitted));
    }

    function renderStudentActivitySkeleton() {
      return '<div class="activity-skeleton"></div><div class="activity-skeleton"></div><div class="activity-skeleton"></div>';
    }

    function sortStudentActivities(items, sortMode) {
      const copy = [...items];
      if (sortMode === 'title') {
        return copy.sort((a, b) => a.title.localeCompare(b.title));
      }
      if (sortMode === 'course') {
        return copy.sort((a, b) => `${a.courseLabel} ${a.title}`.localeCompare(`${b.courseLabel} ${b.title}`));
      }
      if (sortMode === 'due_asc') {
        return copy.sort((a, b) => {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          return ad - bd;
        });
      }
      return copy.sort((a, b) => {
        if (a.status.rank !== b.status.rank) return a.status.rank - b.status.rank;
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        return ad - bd;
      });
    }

    function renderStudentActivityCards(items, hasFilters) {
      const container = document.getElementById('student-buzones-list');
      if (!container) return;
      if (!items.length) {
        container.innerHTML = hasFilters
          ? '<div class="empty-state"><div class="big">ðŸ”Ž</div>No hay resultados con los filtros actuales.</div>'
          : '<div class="empty-state"><div class="big">ðŸ“­</div>No tienes actividades activas en este momento.</div>';
        return;
      }

      container.innerHTML = items.map(item => {
        const safeTitle = String(item.title || '').replace(/'/g, '&apos;');
        const fileButton = item.submission?.file_name
          ? `<a class="btn btn-secondary btn-sm" href="${API_BASE}/grades/submissions/${item.submission.id}/file">â¬‡ ${escapeHtml(item.submission.file_name)}</a>`
          : '';
        const mainActionLabel = item.submission ? 'Reemplazar entrega' : 'Subir entrega';
        const feedback = item.submission
          ? `<div class="activity-card-feedback">
              <div><strong>Tu comentario:</strong> ${escapeHtml(item.submission.student_comment || 'â€”')}</div>
              <div><strong>RetroalimentaciÃ³n:</strong> ${escapeHtml(item.submission.teacher_comment || 'â€”')}</div>
              <div><strong>Nota:</strong> ${item.submission.score == null ? 'Pendiente' : escapeHtml(String(item.submission.score))}</div>
            </div>`
          : '';

        return `<div class="activity-card">
          <div class="activity-card-head">
            <div>
              <div class="activity-card-title">${escapeHtml(item.title)}</div>
              <div class="activity-card-course">${escapeHtml(item.courseLabel)}</div>
            </div>
            <span class="activity-chip ${item.status.key}">${item.status.label}</span>
          </div>
          <div class="activity-card-meta">
            <div class="activity-meta-block">
              <div class="activity-meta-label">Fecha lÃ­mite</div>
              <div class="activity-meta-value">${escapeHtml(item.dueLabel)}</div>
            </div>
            <div class="activity-meta-block">
              <div class="activity-meta-label">Prioridad</div>
              <div class="activity-meta-value">${escapeHtml(item.relativeDue)}</div>
            </div>
            <div class="activity-meta-block">
              <div class="activity-meta-label">Peso</div>
              <div class="activity-meta-value">${item.weight > 0 ? `${item.weight}% de la nota final` : 'Actividad sin peso'}</div>
            </div>
          </div>
          <div class="activity-card-note">${escapeHtml(item.summaryText)}</div>
          <div class="activity-card-actions">
            <button class="btn btn-primary btn-sm" onclick="openSubmitModal(${item.id}, '${safeTitle}')">${mainActionLabel}</button>
            ${fileButton}
          </div>
          ${feedback}
        </div>`;
      }).join('');
    }

    async function loadStudentBuzones() {
      const courseId = document.getElementById('buz-student-course')?.value || '';
      const statusFilter = document.getElementById('buz-student-status')?.value || '';
      const searchFilter = normalizeText(document.getElementById('buz-student-search')?.value || '');
      const sortMode = document.getElementById('buz-student-sort')?.value || 'urgency';
      const container = document.getElementById('student-buzones-list');
      if (!container) return;

      persistStudentActivityFilters();
      container.innerHTML = renderStudentActivitySkeleton();

      try {
        const endpoint = courseId
          ? `${API_BASE}/grades/buzones?course_id=${courseId}`
          : `${API_BASE}/grades/buzones`;
        const res = await apiFetch(endpoint);
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          container.innerHTML = `<div style="color:var(--danger)">${data?.detail || 'Error cargando actividades'}</div>`;
          return;
        }

        const boxes = await res.json();
        const currentCourses = await getMyCurrentCourses();
        const courseMap = new Map(currentCourses.map(course => [Number(course.id), course]));

        const submissionResults = await Promise.all(boxes.map(async (box) => {
          try {
            const subRes = await apiFetch(`${API_BASE}/grades/buzones/${box.id}/my-submission`);
            if (!subRes.ok) return [box.id, null];
            const sub = await subRes.json();
            return [box.id, sub];
          } catch {
            return [box.id, null];
          }
        }));
        const submissionMap = new Map(submissionResults);

        const enriched = boxes.map(box => {
          const course = courseMap.get(Number(box.course_id));
          const submission = submissionMap.get(box.id) || null;
          const status = getDeadlineTone(box.due_date, submission);
          const dueLabel = formatDateTimeEs(box.due_date);
          const relativeDue = getRelativeDueText(box.due_date, submission);
          const courseLabel = course ? `${course.code ? `${course.code} â€” ` : ''}${course.name}` : `Curso ${box.course_id}`;
          return {
            ...box,
            submission,
            dueDate: box.due_date,
            dueLabel,
            relativeDue,
            status,
            courseLabel,
            title: box.title || 'Actividad',
            summaryText: submission
              ? (submission.score == null ? 'Ya enviaste esta actividad. Puedes reemplazar el archivo o revisar la retroalimentaciÃ³n.' : 'Esta actividad ya fue calificada. Revisa la retroalimentaciÃ³n del docente.')
              : 'Actividad pendiente. Sube tu entrega antes de la fecha lÃ­mite para evitar retrasos.',
          };
        });

        renderStudentActivityKpis(enriched);

        let filtered = enriched;
        if (courseId) filtered = filtered.filter(item => String(item.course_id) === String(courseId));
        if (statusFilter) {
          filtered = filtered.filter(item => {
            if (statusFilter === 'pending') return ['pending', 'upcoming', 'today'].includes(item.status.key);
            if (statusFilter === 'submitted') return ['submitted', 'graded'].includes(item.status.key);
            return item.status.key === statusFilter;
          });
        }
        if (searchFilter) {
          filtered = filtered.filter(item => normalizeText(`${item.title} ${item.courseLabel}`).includes(searchFilter));
        }

        filtered = sortStudentActivities(filtered, sortMode);
        renderStudentActivityCards(filtered, Boolean(courseId || statusFilter || searchFilter));
      } catch {
        container.innerHTML = '<div style="color:var(--danger)">Error de conexiÃ³n</div>';
      }
    }

    function openSubmitModal(boxId, title) {
      document.getElementById('submit-assignment-id').value = boxId;
      document.getElementById('submit-work-title').textContent = title;
      document.getElementById('submit-file').value = '';
      document.getElementById('submit-comment').value = '';
      document.getElementById('modal-submit-work').style.display = 'flex';
    }

    async function submitWork() {
      const boxId = document.getElementById('submit-assignment-id').value;
      const fileInput = document.getElementById('submit-file');
      const comment = document.getElementById('submit-comment').value.trim();
      const formData = new FormData();
      if (fileInput.files[0]) formData.append('file', fileInput.files[0]);
      if (comment) formData.append('student_comment', comment);

      try {
        const res = await fetch(`${API_BASE}/grades/buzones/${boxId}/submit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}` },
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showToast(data?.detail || 'âœ— No se pudo enviar', 'err');
          return;
        }
        showToast('âœ“ EnvÃ­o guardado', 'ok');
        document.getElementById('modal-submit-work').style.display = 'none';
        loadStudentBuzones();
      } catch {
        showToast('âœ— Error de conexiÃ³n', 'err');
      }
    }

    function saveGatewayUrl() {
      const url = document.getElementById('gw-url-input').value;
      localStorage.setItem('gw_url', url);
      showToast('âœ“ URL guardada', 'ok');
    }

    function logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user_role');
      localStorage.removeItem('last_section');
      localStorage.removeItem('savedEmail');
      showToast('âœ“ SesiÃ³n cerrada', 'ok');
      setTimeout(() => {
        window.location.href = '/';
      }, 500);
    }

    function prioritizeComunicacionesNav() {
      const nav = document.querySelector('nav');
      const comunicaciones = document.getElementById('nav-comunicaciones');
      const myProfile = document.getElementById('nav-my-profile');
      if (!nav || !comunicaciones || !myProfile) return;
      myProfile.insertAdjacentElement('afterend', comunicaciones);
    }

    window.addEventListener('load', async () => {
      syncSessionState();

      // Verificar autenticaciÃ³n
      if (!TOKEN) {
        window.location.href = '/';
        return;
      }

      setDashboardRoleState();

      if (TOKEN) {
        document.getElementById('token-badge').classList.add('visible');
        setUserInfo();
      }

      if (USER_ROLE === 'estudiante') {
        const navList = document.getElementById('nav-students-list');
        const navCreate = document.getElementById('nav-create-student');
        const navMisCursos = document.getElementById('nav-mis-cursos');
        const navAdminUsers = document.getElementById('nav-admin-users');
        const navConfig = document.getElementById('nav-config');
        const navSectionStudents = document.getElementById('nav-section-students');
        const navSectionConfig = document.getElementById('nav-section-config');
        const statusBar = document.querySelector('.status-bar');

        if (navList) navList.style.display = 'none';
        if (navCreate) navCreate.style.display = 'none';
        if (navMisCursos) navMisCursos.style.display = 'none';
        if (navAdminUsers) navAdminUsers.style.display = 'none';
        if (navSectionStudents) navSectionStudents.style.display = 'none';
        if (navConfig) navConfig.style.display = 'none';
        if (navSectionConfig) navSectionConfig.style.display = 'none';
        if (statusBar) statusBar.style.display = 'none';

        const statsGrid = document.querySelector('.stats-grid');
        if (statsGrid) statsGrid.style.display = 'none';
        const checkButton = document.querySelector('button[onclick="checkHealth()"]');
        if (checkButton) checkButton.style.display = 'none';

        document.getElementById('sec-students').style.display = 'none';
        document.getElementById('sec-mis-cursos').style.display = 'none';
        document.getElementById('sec-create-student').style.display = 'none';
        document.getElementById('sec-admin-users').style.display = 'none';
        document.getElementById('sec-config').style.display = 'none';

        prioritizeComunicacionesNav();

        initGradesSection('estudiante');
        initBuzonesSection('estudiante');

        await loadMyEnrollments();

        // Restaurar Ãºltima secciÃ³n visitada
        const lastSection = localStorage.getItem('last_section');
        const validSections = ['my-enrollments','horario','grades','buzones','my-profile','comunicaciones','reports'];
        if (lastSection && validSections.includes(lastSection)) {
          const navBtn = document.querySelector(`.nav-btn[data-section="${lastSection}"]`);
          goTo(lastSection, navBtn);
        } else {
          goTo('comunicaciones', document.getElementById('nav-comunicaciones'));
        }
      }

      if (USER_ROLE === 'docente') {
        // Ocultar nav y secciÃ³n de matriculaciones de estudiante
        const navMyEnrollments = document.getElementById('nav-my-enrollments');
        const secMyEnrollments = document.getElementById('sec-my-enrollments');
        if (navMyEnrollments) navMyEnrollments.style.display = 'none';
        if (secMyEnrollments) secMyEnrollments.style.display = 'none';

        // Ocultar nav y secciones de estudiante
        const navStudentsList = document.getElementById('nav-students-list');
        const navSectionStudents = document.getElementById('nav-section-students');
        const navConfig = document.getElementById('nav-config');
        const navSectionConfig = document.getElementById('nav-section-config');
        const statusBar = document.querySelector('.status-bar');
        if (navStudentsList) navStudentsList.style.display = 'none';
        if (navSectionStudents) navSectionStudents.style.display = 'none';
        if (navConfig) navConfig.style.display = 'none';
        if (navSectionConfig) navSectionConfig.style.display = 'none';
        if (statusBar) statusBar.style.display = 'none';

        document.getElementById('sec-students').style.display = 'none';
        document.getElementById('sec-create-student').style.display = 'none';
        document.getElementById('sec-admin-users').style.display = 'none';
        document.getElementById('sec-config').style.display = 'none';

        // Ocultar Calificaciones (gradebooks) para docente â€” el flujo de notas va por Buzones
        const navGrades = document.getElementById('nav-grades');
        if (navGrades) navGrades.style.display = 'none';
        const secGrades = document.getElementById('sec-grades');
        if (secGrades) secGrades.style.display = 'none';

        // Ocultar Pagos para docente â€” no aplica
        const navPayment = document.getElementById('nav-payment');
        if (navPayment) navPayment.style.display = 'none';
        const secPayment = document.getElementById('sec-payment');
        if (secPayment) secPayment.style.display = 'none';

        // Ocultar Reportes para docente â€” solo admin y estudiante
        const navReports = document.getElementById('nav-reports');
        if (navReports) navReports.style.display = 'none';
        const secReports = document.getElementById('sec-reports');
        if (secReports) secReports.style.display = 'none';

        prioritizeComunicacionesNav();
        await initBuzonesSection('docente');

        setTeacherUserInfo();  // muestra nombre real del docente en el header

        await loadTeacherMisCursos();

        // Restaurar Ãºltima secciÃ³n visitada
        const lastSection = localStorage.getItem('last_section');
        const validSections = ['dashboard','mis-cursos','horario','buzones','my-profile','comunicaciones'];
        if (lastSection && validSections.includes(lastSection)) {
          const navBtn = document.querySelector(`.nav-btn[data-section="${lastSection}"]`);
          goTo(lastSection, navBtn);
        } else {
          goTo('dashboard', document.querySelector('.nav-btn[data-section="dashboard"]'));
        }
      }

      if (USER_ROLE !== 'admin') {
        const navCreate = document.getElementById('nav-create-student');
        const navAdminUsers = document.getElementById('nav-admin-users');
        if (navCreate) navCreate.style.display = 'none';
        if (navAdminUsers) navAdminUsers.style.display = 'none';
        const btnCreate = document.getElementById('btn-create-student');
        if (btnCreate) btnCreate.style.display = 'none';
        document.getElementById('sec-create-student').style.display = 'none';
        document.getElementById('sec-admin-users').style.display = 'none';

        const navTeachers = document.getElementById('nav-teachers');
        const navAssignments = document.getElementById('nav-assignments');
        const navCareers = document.getElementById('nav-careers');
        const navMaterias = document.getElementById('nav-materias');
        const navEnrollmentsAdmin = document.getElementById('nav-enrollments-admin');
        if (navTeachers) navTeachers.style.display = 'none';
        if (navAssignments) navAssignments.style.display = 'none';
        if (navCareers) navCareers.style.display = 'none';
        if (navMaterias) navMaterias.style.display = 'none';
        if (navEnrollmentsAdmin) navEnrollmentsAdmin.style.display = 'none';
        const secTeachers = document.getElementById('sec-teachers');
        const secAssignments = document.getElementById('sec-assignments');
        const secCareers = document.getElementById('sec-careers');
        const secMaterias = document.getElementById('sec-materias');
        const secEnrollmentsAdmin = document.getElementById('sec-enrollments-admin');
        if (secTeachers) secTeachers.style.display = 'none';
        if (secAssignments) secAssignments.style.display = 'none';
        if (secCareers) secCareers.style.display = 'none';
        if (secMaterias) secMaterias.style.display = 'none';
        if (secEnrollmentsAdmin) secEnrollmentsAdmin.style.display = 'none';
      }

      if (USER_ROLE === 'admin') {
        const navBuzones = document.getElementById('nav-buzones');
        const secBuzones = document.getElementById('sec-buzones');
        if (navBuzones) navBuzones.style.display = 'none';
        if (secBuzones) secBuzones.style.display = 'none';

        // Ocultar secciones de estudiante: Mis cursos, Materias inscritas, Calificaciones y Pagos
        const navMisCursos = document.getElementById('nav-mis-cursos');
        const secMisCursos = document.getElementById('sec-mis-cursos');
        const navMyEnrollments = document.getElementById('nav-my-enrollments');
        const secMyEnrollments = document.getElementById('sec-my-enrollments');
        const navGrades = document.getElementById('nav-grades');
        const secGrades = document.getElementById('sec-grades');
        const navPayment = document.getElementById('nav-payment');
        const secPayment = document.getElementById('sec-payment');
        if (navMisCursos) navMisCursos.style.display = 'none';
        if (secMisCursos) secMisCursos.style.display = 'none';
        if (navMyEnrollments) navMyEnrollments.style.display = 'none';
        if (secMyEnrollments) secMyEnrollments.style.display = 'none';
        if (navGrades) navGrades.style.display = 'none';
        if (secGrades) secGrades.style.display = 'none';
        if (navPayment) navPayment.style.display = 'none';
        if (secPayment) secPayment.style.display = 'none';
      }

      checkHealth();
      loadAdminDashboard();
      loadTeacherDashboard();
      loadStudentDashboard();
      loadStudents();
      populateClassroomSelect();
      await loadCareers();
      loadTeachers();
      loadAcademic();
      if (USER_ROLE === 'admin') {
        loadEnrollmentsData();
        initGradesSection('admin');
      }
    });

    // â”€â”€â”€ Horario Semanal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const DAYS = ['lunes','martes','miercoles','jueves','viernes','sabado'];
    const DAY_LABELS = { lunes:'Lunes', martes:'Martes', miercoles:'MiÃ©rcoles', jueves:'Jueves', viernes:'Viernes', sabado:'SÃ¡bado' };
    const HOUR_START = 6;   // 6:00 AM
    const HOUR_END   = 22;  // 10:00 PM
    let ACTIVE_SCHEDULE_SESSIONS = [];

    function timeToMinutes(t) {
      if (!t || !t.includes(':')) return null;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    }

    function getScheduleCourseShortName(name, fallbackCode = '') {
      const raw = (name || '').toString().trim();
      if (!raw) return fallbackCode || 'Clase';
      const words = raw.split(/\s+/).filter(Boolean);
      if (words.length <= 3 && raw.length <= 28) return raw;
      const short = words.slice(0, 3).join(' ');
      return short.length > 28 ? `${short.slice(0, 25)}...` : `${short}...`;
    }

    function getScheduleConflictSummary(session) {
      if (!Array.isArray(session?.conflicts) || session.conflicts.length === 0) return 'Sin conflicto';
      const overlap = session.conflicts.some(conflict => conflict.type === 'overlap');
      const room = session.conflicts.some(conflict => conflict.type === 'room');
      if (overlap && room) return 'Cruce de horario y aula compartida';
      if (overlap) return 'Cruce de horario con otra clase';
      if (room) return 'Aula compartida en el mismo horario';
      return 'Conflicto detectado';
    }

    function buildScheduleTooltip(session) {
      const lines = [
        session.course_code ? `${session.course_code} â€” ${session.course_name}` : session.course_name,
        `${DAY_LABELS[session.day_of_week] || session.day_of_week} Â· ${formatRange(session.start_time, session.end_time)}`,
        `Aula: ${session.classroomLabel || 'Por definir'}`,
        `Docente: ${session.teacherLabel || 'Por asignar'}`,
      ];
      if (session.sectionLabel && session.sectionLabel !== 'â€”') lines.push(`SecciÃ³n: ${session.sectionLabel}`);
      if (session.durationLabel) lines.push(`DuraciÃ³n: ${session.durationLabel}`);
      if (session.hasConflict) lines.push(`Conflicto: ${getScheduleConflictSummary(session)}`);
      return lines.join('\n');
    }

    function markScheduleConflicts(sessions) {
      return sessions.map((session, index) => {
        const sm = timeToMinutes(session.start_time);
        const em = timeToMinutes(session.end_time);
        const conflicts = [];

        sessions.forEach((other, otherIndex) => {
          if (index === otherIndex) return;
          if (session.day_of_week !== other.day_of_week) return;
          const osm = timeToMinutes(other.start_time);
          const oem = timeToMinutes(other.end_time);
          if (sm == null || em == null || osm == null || oem == null) return;
          const overlaps = sm < oem && osm < em;
          if (!overlaps) return;
          if (session.classroomLabel && other.classroomLabel && session.classroomLabel === other.classroomLabel) {
            conflicts.push({ type: 'room', withId: other.id });
          }
          conflicts.push({ type: 'overlap', withId: other.id });
        });

        const unique = [];
        const seen = new Set();
        conflicts.forEach(conflict => {
          const key = `${conflict.type}:${conflict.withId}`;
          if (seen.has(key)) return;
          seen.add(key);
          unique.push(conflict);
        });

        return {
          ...session,
          conflicts: unique,
          hasConflict: unique.length > 0,
        };
      });
    }

    function openScheduleDetail(sessionId) {
      const session = ACTIVE_SCHEDULE_SESSIONS.find(item => Number(item.id) === Number(sessionId));
      if (!session) return;

      setText('schedule-detail-subtitle', `${DAY_LABELS[session.day_of_week] || session.day_of_week} Â· ${session.relativeTimeLabel}`);
      setText('schedule-detail-code', session.course_code || 'â€”');
      setText('schedule-detail-name', session.course_name || 'â€”');
      setText('schedule-detail-time', session.relativeTimeLabel || 'â€”');
      setText('schedule-detail-room', session.classroomLabel || 'â€”');
      setText('schedule-detail-teacher', session.teacherLabel || 'Por asignar');
      setText('schedule-detail-duration', session.durationLabel || 'â€”');
      setText('schedule-detail-section', session.sectionLabel || 'â€”');
      setText('schedule-detail-conflict', getScheduleConflictSummary(session));

      const annBtn = document.getElementById('schedule-detail-announcements-btn');
      const actBtn = document.getElementById('schedule-detail-activities-btn');
      if (annBtn) annBtn.style.display = USER_ROLE === 'estudiante' ? 'inline-flex' : 'none';
      if (actBtn) actBtn.style.display = USER_ROLE === 'estudiante' ? 'inline-flex' : 'none';

      window.__activeScheduleCourseId = session.course_id;
      document.getElementById('modal-schedule-detail').style.display = 'flex';
    }

    function openScheduleCourseSection(section) {
      const courseId = window.__activeScheduleCourseId;
      document.getElementById('modal-schedule-detail').style.display = 'none';
      if (!courseId) {
        goTo(section, document.querySelector(`.nav-btn[data-section="${section}"]`));
        return;
      }

      goTo(section, document.querySelector(`.nav-btn[data-section="${section}"]`));

      setTimeout(() => {
        if (section === 'comunicaciones' && USER_ROLE === 'estudiante') {
          const select = document.getElementById('ann-student-course');
          if (select) select.value = String(courseId);
          loadStudentAnnouncements();
        }
        if (section === 'buzones' && USER_ROLE === 'estudiante') {
          const select = document.getElementById('buz-student-course');
          if (select) select.value = String(courseId);
          loadStudentBuzones();
        }
      }, 0);
    }

    function populateScheduleCareerSelects() {
      const careers = ACADEMIC_CAREERS;
      ['horario-career-filter', 'sch-career'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const first = id === 'horario-career-filter'
          ? '<option value="">Todas las carreras</option>'
          : '<option value="">Selecciona carrera</option>';
        sel.innerHTML = first + careers.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
      });
      // Si hay una carrera pre-seleccionada en el formulario de horario, cargar sus cursos
      const schCareer = document.getElementById('sch-career');
      if (schCareer && schCareer.value) loadScheduleCourses();
    }

    async function loadScheduleCourses() {
      const careerId = document.getElementById('sch-career').value;
      const sel = document.getElementById('sch-course');
      if (!careerId) {
        sel.innerHTML = '<option value="">â€” Selecciona una carrera primero â€”</option>';
        return;
      }
      sel.innerHTML = '<option value="">Cargando materias...</option>';
      sel.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/academic/api/courses/?career_id=${careerId}&limit=500`, { headers: getAuthHeaders() });
        if (!res.ok) { sel.innerHTML = '<option value="">Error al cargar materias</option>'; return; }
        const courses = await res.json();
        if (!Array.isArray(courses) || courses.length === 0) {
          sel.innerHTML = '<option value="">No hay materias para esta carrera</option>';
          return;
        }
        sel.innerHTML = '<option value="">â€” Selecciona materia â€”</option>' +
          courses.map(c => `<option value="${c.id}">${c.code} â€” ${c.name}</option>`).join('');
      } catch (e) {
        sel.innerHTML = '<option value="">Error de conexiÃ³n</option>';
      } finally {
        sel.disabled = false;
      }

      await loadScheduleTeachers();
    }

    async function loadScheduleTeachers() {
      const schTeacher = document.getElementById('sch-teacher');
      if (!schTeacher) return;

      const careerId = document.getElementById('sch-career')?.value || '';
      const courseId = document.getElementById('sch-course')?.value || '';

      if (!careerId) {
        schTeacher.innerHTML = '<option value="">Selecciona carrera primero</option>';
        return;
      }

      const selectedCareer = (ACADEMIC_CAREERS || []).find(c => String(c.id) === String(careerId));
      const params = new URLSearchParams();
      if (selectedCareer?.code) params.set('career_code', selectedCareer.code);
      if (courseId) params.set('course_id', String(courseId));

      schTeacher.innerHTML = '<option value="">Cargando docentes...</option>';
      try {
        const response = await fetch(`${API_BASE}/academic/api/teachers/?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) {
          schTeacher.innerHTML = '<option value="">Error cargando docentes</option>';
          return;
        }

        const teachers = await response.json();
        const list = Array.isArray(teachers) ? teachers : [];
        if (!list.length) {
          schTeacher.innerHTML = '<option value="">No hay docentes disponibles</option>';
          return;
        }

        schTeacher.innerHTML = '<option value="">Sin docente asignado</option>' + list.map(t => `
          <option value="${t.id}">${t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || t.email}</option>
        `).join('');
      } catch (error) {
        schTeacher.innerHTML = '<option value="">Error de conexiÃ³n</option>';
      }
    }

    async function loadSchedule() {
      if (USER_ROLE === 'docente' || USER_ROLE === 'estudiante') {
        loadPersonalSchedule();
        return;
      }
      const careerId = document.getElementById('horario-career-filter').value;
      const url = careerId
        ? `${API_BASE}/academic/api/schedules/?career_id=${careerId}`
        : `${API_BASE}/academic/api/schedules/`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      const container = document.getElementById('timetable-container');
      if (!res.ok) { container.innerHTML = '<div class="empty-state">Error al cargar el horario.</div>'; return; }
      const sessions = await res.json();
      renderTimetable(sessions, container);
    }

    // Paleta de colores para materias
    const COURSE_COLORS = [
      '#1e4d8c','#2d6a4f','#6b3fa0','#a0522d','#1a6b6b',
      '#7b2d00','#2d5016','#003153','#5c1a1a','#0d4f4f',
    ];

    async function loadPersonalSchedule() {
      const container = document.getElementById('personal-timetable-container');
      if (!container) return;
      container.innerHTML = '<div class="empty-state"><div class="big">â—Œ</div>Cargando...</div>';

      try {
        let courses = [];
        if (USER_ROLE === 'docente') {
          const res = await apiFetch(`${API_BASE}/academic/api/courses/`);
          if (!res.ok) throw new Error('Error cargando cursos del docente');
          courses = await res.json();
        } else if (USER_ROLE === 'estudiante') {
          courses = await getMyCurrentCourses();
        }

        if (!courses.length) {
          container.innerHTML = '<div class="empty-state"><div class="big">ðŸ“…</div>No tienes cursos asignados este perÃ­odo.</div>';
          return;
        }

        // Mapear cursos a formato de sesiones y filtrar los que tienen horario
        const sessionPromises = courses.map(async (c, i) => {
          const day = (c.day_of_week || '').toLowerCase().replace('Ã©','e').replace('Ã¡','a').replace('Ã³','o');
          if (!day || day === 'por definir') return null;
          const teachers = USER_ROLE === 'estudiante' ? await fetchCourseTeachers(c.id) : [];
          const teacherLabel = teachers.length > 0
            ? teachers.map(t => getTeacherDisplayName(t)).join(', ')
            : 'Sin docente asignado';
          const startMinutes = timeToMinutes(c.start_time || '00:00');
          const endMinutes = timeToMinutes(c.end_time || '00:00');
          const durationMinutes = startMinutes != null && endMinutes != null ? Math.max(endMinutes - startMinutes, 0) : 0;
          return {
            id: c.id,
            course_id: c.id,
            course_code: c.code,
            course_name: c.name,
            day_of_week: day,
            start_time: c.start_time || '00:00',
            end_time: c.end_time || '00:00',
            classroom: c.location || c.schedule || 'â€”',
            classroomLabel: c.location || 'Por definir',
            section: c.section || null,
            sectionLabel: c.section || 'â€”',
            modality: null,
            _colorIdx: i % COURSE_COLORS.length,
            teacherLabel,
            startMinutes,
            endMinutes,
            durationMinutes,
            durationLabel: durationMinutes > 0 ? `${Math.round(durationMinutes / 60 * 10) / 10} h` : 'â€”',
            relativeTimeLabel: c.end_time && c.end_time !== '00:00' ? formatRange(c.start_time, c.end_time) : formatTime(c.start_time),
            shortName: getScheduleCourseShortName(c.name, c.code),
          };
        });
        const sessions = (await Promise.all(sessionPromises)).filter(Boolean);

        // TambiÃ©n incluir sessions del endpoint si las hay
        if (!sessions.length) {
          container.innerHTML = '<div class="empty-state"><div class="big">ðŸ“…</div>Tus cursos no tienen horario registrado aÃºn.</div>';
          return;
        }

        ACTIVE_SCHEDULE_SESSIONS = markScheduleConflicts(sessions);
        renderPersonalTimetable(ACTIVE_SCHEDULE_SESSIONS, container);
      } catch(e) {
        container.innerHTML = `<div class="empty-state"><div class="big">âš </div>${e.message}</div>`;
      }
    }

    function renderPersonalTimetable(sessions, container) {
      // Determinar rango de horas real de los datos
      let minH = 24, maxH = 0;
      sessions.forEach(s => {
        const sm = timeToMinutes(s.start_time);
        const em = timeToMinutes(s.end_time);
        if (sm !== null) minH = Math.min(minH, Math.floor(sm / 60));
        if (em !== null) maxH = Math.max(maxH, Math.ceil(em / 60));
      });
      if (minH === 24) { minH = HOUR_START; maxH = HOUR_END; }
      minH = Math.max(minH - 1, 0);
      maxH = Math.min(maxH + 1, 24);

      // Detectar dÃ­as que tienen clases
      const activeDays = DAYS.filter(d => sessions.some(s => s.day_of_week === d));
      if (!activeDays.length) {
        container.innerHTML = '<div class="empty-state"><div class="big">ðŸ“…</div>Sin clases programadas.</div>';
        return;
      }

      // Construir cabecera
      let html = '<div class="timetable-wrap"><table class="timetable personal-timetable"><thead><tr><th style="min-width:60px;">Hora</th>';
      activeDays.forEach(d => { html += `<th>${DAY_LABELS[d]}</th>`; });
      html += '</tr></thead><tbody>';

      for (let h = minH; h < maxH; h++) {
        const label = h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h-12}:00 PM`;
        html += `<tr><td class="time-col">${label}</td>`;
        activeDays.forEach(day => {
          const blocks = sessions.filter(s => {
            if (s.day_of_week !== day) return false;
            const sm = timeToMinutes(s.start_time);
            return sm !== null && sm >= h * 60 && sm < (h + 1) * 60;
          });
          if (!blocks.length) {
            html += '<td style="height:48px;"></td>';
          } else {
            html += '<td>';
            blocks.forEach(s => {
              const sm = timeToMinutes(s.start_time);
              const em = timeToMinutes(s.end_time);
              const duration = em && sm ? em - sm : 60;
              const heightPx = Math.max(duration * (48 / 60), 40);
              const bg = COURSE_COLORS[s._colorIdx ?? 0];
              const label = s.relativeTimeLabel;
              const tooltip = escapeHtml(buildScheduleTooltip(s));
              html += `<div class="tt-block ${s.hasConflict ? 'conflict' : ''}" title="${tooltip}" onclick="openScheduleDetail(${s.id})" style="min-height:${heightPx}px;height:auto;background:${bg};border-left:3px solid ${bg}cc;">
                ${s.hasConflict ? '<span class="tt-conflict-flag">Conflicto</span>' : ''}
                ${s.course_code ? `<span class="tt-code">${escapeHtml(s.course_code)}</span>` : ''}
                <strong>${escapeHtml(s.shortName)}</strong>
                <span class="tt-meta">${escapeHtml(label)} Â· ${escapeHtml(s.classroomLabel || 'Por definir')}</span>
                <span class="tt-meta-secondary">${escapeHtml(s.teacherLabel || 'Sin docente asignado')}</span>
              </div>`;
            });
            html += '</td>';
          }
        });
        html += '</tr>';
      }
      html += '</tbody></table></div>';
      container.innerHTML = html;
    }

    function renderTimetable(sessions, container) {
      if (!sessions.length) {
        container.innerHTML = '<div class="empty-state"><div class="big">ðŸ“…</div>No hay bloques de clase registrados aÃºn.</div>';
        return;
      }

      // Agrupar sesiones por dÃ­a y hora base (hora entera)
      // Para cada celda (dÃ­a, hora) puede haber mÃºltiples bloques que empiezan en ese rango
      const PX_PER_MIN = 48 / 60; // 48px de alto por hora

      let html = '<table class="timetable"><thead><tr><th>Hora</th>';
      DAYS.forEach(d => { html += `<th>${DAY_LABELS[d]}</th>`; });
      html += '</tr></thead><tbody>';

      for (let h = HOUR_START; h < HOUR_END; h++) {
        const label = h < 12 ? `${h}:00AM` : h === 12 ? '12:00PM' : `${h-12}:00PM`;
        html += `<tr><td class="time-col">${label}</td>`;
        DAYS.forEach(day => {
          // Bloques que EMPIEZAN dentro de esta hora
          const blocks = sessions.filter(s => {
            if (s.day_of_week !== day) return false;
            const sm = timeToMinutes(s.start_time);
            return sm !== null && sm >= h * 60 && sm < (h + 1) * 60;
          });
          if (blocks.length === 0) {
            html += '<td></td>';
          } else {
            html += '<td>';
            blocks.forEach(s => {
              const sm = timeToMinutes(s.start_time);
              const em = timeToMinutes(s.end_time);
              const duration = em && sm ? em - sm : 60;
              const heightPx = Math.max(duration * PX_PER_MIN, 28);
              html += `<div class="tt-block" style="height:${heightPx}px;" title="${s.course_name || ''} â€” ${s.classroom}">
                <button class="tt-del" onclick="deleteScheduleBlock(${s.id})" title="Eliminar">âœ•</button>
                <strong>${s.course_code || 'N/A'}</strong>
                <span class="tt-sub">${formatRange(s.start_time, s.end_time)}</span>
                <span class="tt-sub">${s.modality || ''}</span>
                <span class="tt-sub">${s.classroom}</span>
                ${s.teacher_name ? `<span class="tt-sub">ðŸ‘¤ ${s.teacher_name}</span>` : ''}
              </div>`;
            });
            html += '</td>';
          }
        });
        html += '</tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    }

    async function createScheduleBlock() {
      if (USER_ROLE !== 'admin') {
        showToast('Debes iniciar sesiÃ³n como admin para crear horarios.', 'err');
        return;
      }

      const course_id = document.getElementById('sch-course').value;
      const day_of_week = document.getElementById('sch-day').value;
      const start_time  = document.getElementById('sch-start').value.trim();
      const end_time    = document.getElementById('sch-end').value.trim();
      const classroomRaw = document.getElementById('sch-classroom').value.trim();
      const section     = document.getElementById('sch-section').value.trim() || null;
      const modality    = document.getElementById('sch-modality').value.trim() || null;
      const teacherVal  = document.getElementById('sch-teacher').value;
      const teacher_id  = teacherVal ? parseInt(teacherVal) : null;
      const classroomDigits = (classroomRaw.match(/\d+/) || [])[0] || '';
      const classroom = classroomDigits || classroomRaw;

      if (!course_id || !day_of_week || !start_time || !end_time || !classroom) {
        showToast('Completa todos los campos obligatorios.', 'err'); return;
      }
      if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
        showToast('Usa formato HH:MM para las horas (ej: 06:00).', 'err'); return;
      }
      if (timeToMinutes(start_time) >= timeToMinutes(end_time)) {
        showToast('La hora de inicio debe ser anterior a la hora de fin.', 'err'); return;
      }

      const res = await fetch(`${API_BASE}/academic/api/schedules/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ course_id: parseInt(course_id), day_of_week, start_time, end_time, classroom, section, modality, teacher_id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.detail || 'Error al crear bloque.', 'err'); return;
      }
      showToast('Bloque agregado correctamente.', 'ok');
      loadSchedule();
    }

    async function deleteScheduleBlock(id) {
      const res = await fetch(`${API_BASE}/academic/api/schedules/${id}`, {
        method: 'DELETE', headers: getAuthHeaders(),
      });
      if (!res.ok) { showToast('No se pudo eliminar.', 'err'); return; }
      showToast('Bloque eliminado.', 'ok');
      loadSchedule();
    }
  
