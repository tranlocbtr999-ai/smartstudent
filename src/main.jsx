import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bell, BookOpen, CalendarDays, Check, ChevronDown, ClipboardCheck,
  Clock3, GraduationCap, LayoutDashboard, LogOut, Menu, Pencil, Plus, QrCode, Search, Settings,
  Trash2,
  Users, X, Zap,
} from 'lucide-react'
import QRCode from 'qrcode'
import './styles.css'
import { api } from './api'

const initialClasses = []
const students = []

const statusLabels = { present: 'Có mặt', late: 'Đi muộn', absent: 'Vắng', excused: 'Có phép' }
const tabs = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'students', label: 'Học sinh' },
  { id: 'attendance', label: 'Điểm danh' },
  { id: 'assignments', label: 'Bài tập' },
]

function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('examai_user') || 'null') } catch { return null } })
  const [classes, setClasses] = useState(initialClasses)
  const [selectedCode, setSelectedCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [showClassModal, setShowClassModal] = useState(false)
  const [showNotice, setShowNotice] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const selectedClass = classes.find((item) => item.code === selectedCode) ?? classes[0]

  useEffect(() => {
    if (!user) return
    setLoading(true)
    api.getClasses()
      .then((items) => {
        setClasses(items.map((item, index) => ({ ...item, students: item.studentCount, sessions: item.sessionCount, accent: ['sage', 'peach', 'blue'][index % 3], active: index === 0 })))
        if (items[0]) setSelectedCode(items[0].code)
      })
      .catch((error) => setApiError(error.message))
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => {
    if (!user) return
    api.getNotifications().then(setNotifications).catch(() => setNotifications([]))
  }, [user])

  const completeLogin = (session) => {
    localStorage.setItem('examai_token', session.token)
    localStorage.setItem('examai_user', JSON.stringify(session.user))
    setUser(session.user)
  }

  if (!user) return <Login onLogin={completeLogin} />
  if (user.role === 'student') return <StudentPortal user={user} onLogout={() => { localStorage.removeItem('examai_token'); localStorage.removeItem('examai_user'); setUser(null) }} />

  if (loading && !selectedClass) return <div className="boot-state">Đang tải dữ liệu từ máy chủ...</div>
  if (!selectedClass) return <div className="boot-state error-state">{apiError || 'Chưa có lớp học nào trong hệ thống.'}<button className="primary-button" onClick={() => setShowClassModal(true)}><Plus size={17} /> Tạo lớp học</button>  {showClassModal && <div className="modal-backdrop" onMouseDown={() => setShowClassModal(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="modal-icon"><Users size={18} /></span><h2>Tạo lớp học mới</h2><p>Nhập thứ và giờ học để tự động tạo 12 buổi vào thời khóa biểu.</p></div><button className="icon-button" onClick={() => setShowClassModal(false)} aria-label="Đóng"><X size={19} /></button></div><form onSubmit={createClass}><label>Tên lớp học<input name="name" placeholder="Ví dụ: Kinh tế vi mô K60" required /></label><label>Mã lớp<input name="code" placeholder="Ví dụ: KTVM-K60" required /></label><div className="form-row"><label>Môn học<input name="subject" placeholder="Kinh tế vi mô" /></label><label>Phòng học<input name="room" placeholder="A302" /></label></div><label>Lịch học<input name="schedule" placeholder="Thứ 2, 18:00 - 20:00" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowClassModal(false)}>Hủy</button><button className="primary-button" type="submit"><Plus size={17} /> Tạo lớp</button></div></form></div></div>}</div>

  function createClass(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = form.get('name')?.trim()
    const code = form.get('code')?.trim().toUpperCase()
    if (!name || !code) return
    api.createClass({ code, name, subject: form.get('subject')?.trim(), room: form.get('room')?.trim(), schedule: form.get('schedule')?.trim() })
      .then((created) => {
        setClasses((current) => [...current, { ...created, students: 0, sessions: 0, accent: 'blue', active: false }])
        setSelectedCode(created.code)
        setActiveTab('overview')
        setShowClassModal(false)
      })
      .catch((error) => setApiError(error.message))
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Đóng menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><GraduationCap size={20} /></span><span>Exam<span>AI</span></span></div>
        <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav className="main-nav" aria-label="Điều hướng chính">
          <NavItem icon={<LayoutDashboard size={18} />} label="Tổng quan" onClick={() => { setActiveTab('overview'); setMobileMenuOpen(false) }} active={activeTab === 'overview'} />
          <NavItem icon={<Users size={18} />} label="Lớp học" onClick={() => { setActiveTab('overview'); setMobileMenuOpen(false) }} active={activeTab === 'overview'} />
          <NavItem icon={<BookOpen size={18} />} label="Đề thi" onClick={() => { setActiveTab('exams'); setMobileMenuOpen(false) }} active={activeTab === 'exams'} />
          <NavItem icon={<ClipboardCheck size={18} />} label="Bài tập" onClick={() => { setActiveTab('assignments'); setMobileMenuOpen(false) }} active={activeTab === 'assignments'} />
          <NavItem icon={<CalendarDays size={18} />} label="Điểm danh" onClick={() => { setActiveTab('attendance'); setMobileMenuOpen(false) }} active={activeTab === 'attendance'} />
          <NavItem icon={<Clock3 size={18} />} label="Thời khóa biểu" onClick={() => { setActiveTab('timetable'); setMobileMenuOpen(false) }} active={activeTab === 'timetable'} />
          <NavItem icon={<GraduationCap size={18} />} label="Học sinh" onClick={() => { setActiveTab('students'); setMobileMenuOpen(false) }} active={activeTab === 'students'} />
          <NavItem icon={<Zap size={18} />} label="Kết quả" onClick={() => setActiveTab('exams')} active={false} />
          {user.role === 'admin' && <NavItem icon={<Settings size={18} />} label="Quản trị user" onClick={() => setActiveTab('admin')} active={activeTab === 'admin'} />}
          <NavItem icon={<Bell size={18} />} label="Thông báo" onClick={() => setShowNotice(true)} active={showNotice} />
          {user.role !== 'student' && <NavItem icon={<Zap size={18} />} label="Nhập đề online" onClick={() => setActiveTab('ai')} active={activeTab === 'ai'} />}
        </nav>
        <div className="sidebar-bottom">
          <NavItem icon={<Settings size={18} />} label="Cài đặt" onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false) }} active={activeTab === 'settings'} />
          <div className="profile-card"><div className="avatar avatar-dark">{user.name.split(' ').map((part) => part[0]).slice(-2).join('')}</div><div><strong>{user.name}</strong><small>{user.role}</small></div><button className="logout-button" onClick={() => { localStorage.removeItem('examai_token'); localStorage.removeItem('examai_user'); setUser(null) }} title="Đăng xuất"><LogOut size={16} /><span>Đăng xuất</span></button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu'} onClick={() => setMobileMenuOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Không gian giảng dạy</span><span>/</span><strong>Lớp học</strong></div>
          <div className="top-actions"><div className="search-box"><Search size={17} /><input aria-label="Tìm kiếm lớp học" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Tìm kiếm lớp..." /></div><button className="icon-button notification-button" aria-label="Thông báo" onClick={() => setShowNotice(!showNotice)}><Bell size={19} />{notifications.length > 0 && <i>{notifications.length}</i>}</button><button className="avatar avatar-small avatar-button" aria-label="Mở quản lý tài khoản" onClick={() => setActiveTab('settings')}>{user.name.split(' ').map((part) => part[0]).slice(-2).join('')}</button></div>
          {showNotice && <div className="notification-popover"><strong>Thông báo mới</strong>{notifications.length ? notifications.slice(0, 4).map((notification) => <p key={notification.id}>{notification.message}</p>) : <p>Chưa có thông báo mới.</p>}</div>}
        </header>

        <div className="content-wrap">
          {apiError && <div className="api-alert">API chưa kết nối: {apiError}. Hãy kiểm tra backend production.</div>}
          {loading && <div className="loading-bar" aria-label="Đang tải dữ liệu" />}
          <section className="page-heading"><div><p className="eyebrow">THỨ HAI, 06 THÁNG 09, 2026</p><h1>Lớp học</h1><p className="muted">Theo dõi lớp, điểm danh và giao bài tập trong một nơi.</p></div>{user.role !== 'student' && <button className="primary-button" onClick={() => setShowClassModal(true)}><Plus size={18} /> Tạo lớp học</button>}</section>

          <section className="class-strip" aria-label="Danh sách lớp học">
            <div className="class-strip-title"><span className="section-kicker">LỚP CỦA TÔI</span>{user.role !== 'student' && <button className="round-add" aria-label="Tạo lớp học" onClick={() => setShowClassModal(true)}><Plus size={16} /></button>}</div>
            <div className="class-cards">{classes.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(searchTerm.toLowerCase())).map((item) => <button key={item.code} className={`class-card ${item.code === selectedCode ? 'selected' : ''}`} onClick={() => { setSelectedCode(item.code); setActiveTab('overview') }}><span className={`class-dot ${item.accent}`} /><span className="class-info"><strong>{item.code}</strong><small>{item.name}</small></span><span className="class-count">{item.students} <small>HS</small></span></button>)}{!classes.some((item) => `${item.code} ${item.name}`.toLowerCase().includes(searchTerm.toLowerCase())) && <p className="interaction-hint">Không tìm thấy lớp phù hợp.</p>}</div>
          </section>

          <section className="class-header"><div><div className="title-line"><h2>{selectedClass.code}</h2><span className="live-badge"><span /> Đang hoạt động</span></div><p>{selectedClass.name} <span className="divider">·</span> {selectedClass.schedule || 'Chưa có lịch học'} <span className="divider">·</span> {selectedClass.room || 'Chưa có phòng'}</p></div>{user.role !== 'student' && <button className="secondary-button"><Settings size={16} /> Quản lý lớp</button>}</section>

          <div className="tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.id === 'assignments' && <span className="tab-count">4</span>}</button>)}</div>

          {activeTab === 'overview' && <Overview classId={selectedClass.id} selectedClass={selectedClass} onAttendance={() => setActiveTab('attendance')} />}
          {activeTab === 'students' && <Students classId={selectedClass.id} />}
          {activeTab === 'attendance' && <Attendance classId={selectedClass.id} />}
          {activeTab === 'timetable' && <Timetable classes={classes} />}
          {activeTab === 'assignments' && <Assignments classId={selectedClass.id} />}
          {activeTab === 'exams' && <ExamRunner />}
          {activeTab === 'admin' && user.role === 'admin' && <AdminUsers />}
          {activeTab === 'settings' && <AccountSettings user={user} onUserUpdated={(updated) => { localStorage.setItem('examai_user', JSON.stringify(updated)); setUser(updated) }} />}
          {activeTab === 'ai' && <AIGeneratorV2 classId={selectedClass.id} />}
        </div>
      </main>

      {showClassModal && <div className="modal-backdrop" onMouseDown={() => setShowClassModal(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="modal-icon"><Users size={18} /></span><h2>Tạo lớp học mới</h2><p>Thiết lập thông tin lớp để bắt đầu quản lý.</p></div><button className="icon-button" onClick={() => setShowClassModal(false)} aria-label="Đóng"><X size={19} /></button></div><form onSubmit={createClass}><label>Tên lớp học<input name="name" placeholder="Ví dụ: Kinh tế vi mô K60" required /></label><label>Mã lớp<input name="code" placeholder="Ví dụ: KTVM-K60" required /></label><div className="form-row"><label>Môn học<input name="subject" placeholder="Kinh tế vi mô" /></label><label>Phòng học<input name="room" placeholder="A302" /></label></div><label>Lịch học<input name="schedule" placeholder="Thứ 2, 18:00 - 20:00" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowClassModal(false)}>Hủy</button><button className="primary-button" type="submit"><Plus size={17} /> Tạo lớp</button></div></form></div></div>}
    </div>
  )
}

function NavItem({ icon, label, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{label === 'Bài kiểm tra' && <span className="nav-count">4</span>}</button> }

function Overview({ onAttendance, classId, selectedClass }) {
  const [classStudents, setClassStudents] = useState([])
  const [assignments, setAssignments] = useState([])
  const [attendance, setAttendance] = useState({ sessions: [], records: [] })
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([api.getStudents(classId), api.getAssignments(classId), api.getAttendance(classId)])
      .then(([nextStudents, nextAssignments, nextAttendance]) => { setClassStudents(nextStudents); setAssignments(nextAssignments); setAttendance(nextAttendance) })
      .catch((requestError) => setError(requestError.message))
  }, [classId])
  const latestSession = attendance.sessions.at(-1)
  const latestRecords = latestSession ? attendance.records.filter((record) => record.sessionId === latestSession.id) : []
  const presentCount = latestRecords.filter((record) => record.status === 'present').length
  const lateCount = latestRecords.filter((record) => record.status === 'late').length
  const absentCount = latestRecords.filter((record) => record.status === 'absent').length
  const attendanceTotal = latestRecords.length || classStudents.length
  const attendanceRate = attendanceTotal ? Math.round(((presentCount + lateCount) / attendanceTotal) * 100) : 0
  const studentStatus = (student) => latestRecords.find((record) => record.studentId === student.id)?.status || student.status || 'absent'
  return <>
    {error && <p className="interaction-hint">{error}</p>}
    <section className="stat-grid"><StatCard icon={<Users />} label="Học sinh" value={classStudents.length} note="Đang trong lớp" tone="green" /><StatCard icon={<CalendarDays />} label="Buổi học" value={selectedClass.sessionCount || 0} note="Đã tạo trên hệ thống" tone="blue" /><StatCard icon={<ClipboardCheck />} label="Bài kiểm tra" value={assignments.length} note="Đã giao cho lớp" tone="orange" /><StatCard icon={<Zap />} label="Tỷ lệ tham dự" value={`${attendanceRate}%`} note="Theo phiên gần nhất" tone="violet" /></section>
    <div className="dashboard-grid"><section className="panel attendance-panel"><div className="panel-head"><div><span className="section-kicker">ĐIỂM DANH GẦN NHẤT</span><h3>{latestSession ? `Mã ${latestSession.code}` : 'Chưa có phiên điểm danh'}</h3></div><button className="text-button" onClick={onAttendance}>Xem chi tiết <span>→</span></button></div><div className="attendance-summary"><div className="attendance-total"><strong>{attendanceTotal}</strong><span>học sinh</span><div className="progress"><span style={{ width: `${attendanceRate}%` }} /></div><small>{presentCount + lateCount} đã điểm danh</small></div><div className="attendance-legend"><Legend color="green" label="Có mặt" value={presentCount} /><Legend color="yellow" label="Đi muộn" value={lateCount} /><Legend color="red" label="Vắng" value={absentCount} /></div></div><button className="attendance-cta" onClick={onAttendance}><ClipboardCheck size={18} /> Mở điểm danh <span>→</span></button></section><section className="panel upcoming-panel"><div className="panel-head"><div><span className="section-kicker">SẮP TỚI</span><h3>Lịch hoạt động</h3></div><button className="icon-button"><CalendarDays size={18} /></button></div>{assignments.slice(0, 3).map((assignment) => <Upcoming key={assignment.id} icon={<ClipboardCheck />} date={new Date(assignment.dueAt).toLocaleDateString('vi-VN', { day: '2-digit', month: 'short' })} title={assignment.title} meta={`Hạn nộp · ${new Date(assignment.dueAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`} tone="orange" />)}{!assignments.length && <p className="interaction-hint">Chưa có bài tập nào.</p>}</section></div>
    <section className="panel recent-panel"><div className="panel-head"><div><span className="section-kicker">HOẠT ĐỘNG GẦN ĐÂY</span><h3>Học sinh trong lớp</h3></div><button className="text-button" onClick={() => onAttendance()}>Xem tất cả <span>→</span></button></div><div className="student-table"><div className="table-row table-head"><span>HỌC SINH</span><span>TRẠNG THÁI HÔM NAY</span><span>ĐIỂM TB</span><span /></div>{classStudents.slice(0, 4).map((student) => <div className="table-row" key={student.id}><div className="student-cell"><div className="avatar avatar-table">{student.name.split(' ').map((part) => part[0]).slice(-2).join('')}</div><div><strong>{student.name}</strong><small>{student.id}</small></div></div><span className={`status ${studentStatus(student)}`}><span /> {statusLabels[studentStatus(student)]}</span><strong>{student.score ?? '--'}</strong><button className="row-arrow" aria-label={`Xem ${student.name}`}>→</button></div>)}</div></section>
  </>
}

function StatCard({ icon, label, value, note, tone }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small className={tone === 'green' ? 'positive' : ''}>{note}</small></div> }
function Legend({ color, label, value }) { return <div><span className={`legend-dot ${color}`} /><span>{label}</span><strong>{value}</strong></div> }
function Upcoming({ icon, date, title, meta, tone }) { return <div className="upcoming-item"><div className={`upcoming-icon ${tone}`}>{icon}</div><div className="upcoming-date">{date}</div><div className="upcoming-copy"><strong>{title}</strong><small>{meta}</small></div><span className="row-arrow">→</span></div> }
function Students({ classId }) {
  const [classStudents, setClassStudents] = useState(students.concat([{ name: 'Vũ Hải Nam', id: 'HS00159', status: 'present', score: '8.4', initials: 'VN' }]))
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!classId) return
    api.getStudents(classId)
      .then((items) => setClassStudents(items.map((student) => ({ ...student, initials: student.name.split(' ').map((part) => part[0]).slice(-2).join(''), score: student.score ?? '--' }))))
      .catch((requestError) => setError(requestError.message))
  }, [classId])
  function addStudent(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = form.get('name')?.trim()
    const id = form.get('id')?.trim().toUpperCase()
    if (!name || !id) return
    api.addStudent(classId, { name, id, phone: form.get('phone'), zalo: form.get('zalo') })
      .then((created) => {
        setClassStudents((current) => [...current, { ...created, score: '--', initials: name.split(' ').map((part) => part[0]).slice(-2).join('') }])
        event.currentTarget.reset()
        setShowForm(false)
      })
      .catch((requestError) => setError(requestError.message))
  }
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">DANH SÁCH LỚP</span><h3>{classStudents.length} học sinh</h3></div><button className="secondary-button" onClick={() => setShowForm(!showForm)}><Plus size={16} /> Thêm học sinh</button></div>{error && <p className="interaction-hint">{error}</p>}{showForm && <form className="inline-form" onSubmit={addStudent}><input name="name" placeholder="Họ và tên học sinh" required /><input name="id" placeholder="Mã học sinh" required /><input name="phone" placeholder="Số điện thoại" /><input name="zalo" placeholder="Số Zalo" /><button className="primary-button" type="submit">Thêm</button></form>}<div className="student-table">{classStudents.map((student) => <div className="table-row" key={student.id}><div className="student-cell"><div className="avatar avatar-table">{student.initials}</div><div><strong>{student.name}</strong><small>{student.id}</small><div className="student-contact">{student.phone && <a href={`tel:${student.phone}`}>Gọi {student.phone}</a>}{student.zalo && <a href={`https://zalo.me/${student.zalo}`} target="_blank" rel="noreferrer">Zalo</a>}</div></div></div><span className={`status ${student.status}`}><span /> {statusLabels[student.status]}</span><strong>{student.score}</strong><button className="row-arrow">→</button></div>)}</div></section>
}

function localDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

function Timetable({ classes }) {
  const emptyForm = { classId: classes[0]?.id || '', title: '', subject: '', room: '', startsAt: '', endsAt: '', notes: '' }
  const [items, setItems] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function load() { try { setItems(await api.getTimetable()) } catch (requestError) { setError(requestError.message) } }
  useEffect(() => { load() }, [])
  useEffect(() => { if (!form.classId && classes[0]) setForm((current) => ({ ...current, classId: classes[0].id })) }, [classes, form.classId])
  function startEdit(item) {
    setEditingId(item.id)
    setForm({ classId: item.classId, title: item.title, subject: item.subject || '', room: item.room || '', startsAt: localDateTime(item.startsAt), endsAt: localDateTime(item.endsAt), notes: item.notes || '' })
    setShowForm(true)
  }
  async function save(event) {
    event.preventDefault(); setError('')
    try {
      const payload = { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }
      if (editingId) await api.updateTimetableSession(editingId, payload)
      else await api.createTimetableSession(payload)
      setForm({ ...emptyForm, classId: classes[0]?.id || '' }); setEditingId(''); setShowForm(false); await load()
    } catch (requestError) { setError(requestError.message) }
  }
  async function remove(item) {
    if (!window.confirm(`Xóa buổi học ${item.title}?`)) return
    try { await api.deleteTimetableSession(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)) } catch (requestError) { setError(requestError.message) }
  }
  async function openAttendance(item) {
    try { const session = await api.createTimetableAttendance(item.id, { expiresInMinutes: 90 }); setNotice(`Đã mở điểm danh ${item.classCode} · mã ${session.code}`); await load() } catch (requestError) { setError(requestError.message) }
  }
  return <section className="panel full-panel timetable-panel">
    <div className="panel-head"><div><span className="section-kicker">LỊCH DẠY TOÀN TRƯỜNG</span><h3>{items.length} buổi học</h3></div><button className="primary-button" onClick={() => { setEditingId(''); setForm({ ...emptyForm, classId: classes[0]?.id || '' }); setShowForm(!showForm) }}><Plus size={17} /> Thêm buổi học</button></div>
    <p className="muted">Quản lý lịch học của tất cả lớp và mở điểm danh theo từng buổi.</p>
    {error && <p className="interaction-hint">{error}</p>}{notice && <p className="success-alert">{notice}</p>}
    {showForm && <form className="timetable-form" onSubmit={save}><label>Lớp học<select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })} disabled={Boolean(editingId)} required>{classes.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label><label>Tên buổi học<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ví dụ: Kinh tế vi mô - Tuần 3" required /></label><div className="form-row"><label>Bắt đầu<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label><label>Kết thúc<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></label></div><div className="form-row"><label>Môn học<input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label><label>Phòng học<input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label></div><label>Ghi chú<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); setEditingId('') }}>Hủy</button><button className="primary-button">{editingId ? 'Lưu thay đổi' : 'Tạo buổi học'}</button></div></form>}
    <div className="timetable-list">{items.map((item) => <article className="timetable-row" key={item.id}><div className="timetable-date"><strong>{new Date(item.startsAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong><small>{new Date(item.startsAt).toLocaleDateString('vi-VN', { weekday: 'short' })}</small></div><div className="timetable-copy"><strong>{item.title}</strong><small>{item.classCode} · {new Date(item.startsAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.endsAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {item.room || 'Chưa có phòng'}</small></div><div className="timetable-actions">{item.attendanceSession?.status === 'active' ? <span className="live-badge"><span /> Mã {item.attendanceSession.code}</span> : <button className="secondary-button" onClick={() => openAttendance(item)}><QrCode size={15} /> Mở điểm danh</button>}<button className="icon-button" title="Sửa" onClick={() => startEdit(item)}><Pencil size={16} /></button><button className="icon-button" title="Xóa" onClick={() => remove(item)}><Trash2 size={16} /></button></div></article>)}</div>
    {!items.length && <p className="interaction-hint">Chưa có buổi học nào trong thời khóa biểu.</p>}
  </section>
}

function Attendance({ classId }) {
  const [records, setRecords] = useState([])
  const [session, setSession] = useState(null)
  const [timetableItems, setTimetableItems] = useState([])
  const [selectedTimetableId, setSelectedTimetableId] = useState('')
  const [qrData, setQrData] = useState('')
  const [error, setError] = useState('')
  const order = ['present', 'late', 'absent', 'excused']
  async function loadAttendance() {
    try {
      const [classStudents, attendance, timetable] = await Promise.all([api.getStudents(classId), api.getAttendance(classId), api.getTimetable()])
      const classTimetable = timetable.filter((item) => item.classId === classId)
      setTimetableItems(classTimetable)
      const timetableId = selectedTimetableId && classTimetable.some((item) => item.id === selectedTimetableId) ? selectedTimetableId : classTimetable.at(-1)?.id || ''
      if (selectedTimetableId !== timetableId) setSelectedTimetableId(timetableId)
      const latest = timetableId ? attendance.sessions.filter((item) => item.timetableSessionId === timetableId).at(-1) : attendance.sessions.at(-1)
      setSession(latest || null)
      const sessionRecords = latest ? attendance.records.filter((record) => record.sessionId === latest.id) : []
      setRecords(classStudents.map((student) => {
        const record = sessionRecords.find((item) => item.studentId === student.id)
        return { ...student, recordId: record?.id, status: record?.status || student.status || 'absent', initials: student.name.split(' ').map((part) => part[0]).slice(-2).join('') }
      }))
    } catch (requestError) {
      setError(requestError.message)
    }
  }
  useEffect(() => { loadAttendance()   }, [classId, selectedTimetableId])
  async function createSession() {
    try {
      const createdSession = selectedTimetableId
        ? await api.createTimetableAttendance(selectedTimetableId, { expiresInMinutes: 90 })
        : await api.createAttendanceSession(classId, { expiresInMinutes: 2 })
      const payload = JSON.stringify({ type: 'attendance', sessionId: createdSession.id, code: createdSession.code, expiresAt: createdSession.expiresAt })
      setQrData(await QRCode.toDataURL(payload, { width: 220, margin: 2, errorCorrectionLevel: 'M' }))
      await loadAttendance()
    } catch (requestError) { setError(requestError.message) }
  }
  async function cycleStatus(record) {
    const nextStatus = order[(order.indexOf(record.status) + 1) % order.length]
    if (!record.recordId) return
    try { await api.updateAttendance(record.recordId, nextStatus); setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: nextStatus } : item)) } catch (requestError) { setError(requestError.message) }
  }
  function exportAttendance() {
    if (!records.length) return
    const rows = [['Mã học sinh', 'Họ tên', 'Trạng thái', 'Thời gian cập nhật'], ...records.map((record) => [record.id, record.name, statusLabels[record.status], record.checkedAt ? new Date(record.checkedAt).toLocaleString('vi-VN') : ''])]
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `diem-danh-${session?.code || 'lop-hoc'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">ĐIỂM DANH THEO BUỔI</span><h3>{timetableItems.find((item) => item.id === selectedTimetableId)?.title || 'Buổi học hiện tại'}</h3></div><button className="primary-button" onClick={createSession}><QrCode size={17} /> Mở điểm danh</button></div>{timetableItems.length > 0 && <label className="attendance-session-picker">Buổi học<select value={selectedTimetableId} onChange={(event) => setSelectedTimetableId(event.target.value)}>{timetableItems.map((item) => <option key={item.id} value={item.id}>{new Date(item.startsAt).toLocaleDateString('vi-VN')} · {item.title}</option>)}</select></label>}{error && <p className="interaction-hint">{error}</p>}{qrData && session && <div className="qr-panel"><img src={qrData} alt={`QR điểm danh ${session.code}`} /><div><span className="section-kicker">ĐIỂM DANH BẰNG QR</span><strong>Mã {session.code}</strong><small>Hết hạn lúc {new Date(session.expiresAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small><button className="secondary-button" onClick={() => setQrData('')}>Ẩn QR</button></div></div>}<div className="attendance-toolbar"><span><Clock3 size={16} /> {session ? <>Mã phiên <strong>{session.code}</strong></> : 'Chưa có phiên điểm danh'}</span><button className="secondary-button" onClick={exportAttendance} disabled={!records.length}>Xuất lịch sử</button></div><p className="interaction-hint">{session ? 'Bấm vào trạng thái để cập nhật và lưu điểm danh.' : 'Chọn một buổi học rồi mở điểm danh cho học sinh.'}</p><div className="student-table">{records.map((student, index) => <div className="table-row" key={student.id}><div className="student-cell"><div className="avatar avatar-table">{student.initials}</div><div><strong>{student.name}</strong><small>{student.id}</small></div></div><button className={`status-select ${student.status}`} onClick={() => cycleStatus(student)}>{statusLabels[student.status]} <ChevronDown size={14} /></button><span className="attendance-time">18:0{index + 1}</span><button className="row-arrow">→</button></div>)}</div></section>
}
function Assignments({ classId }) {
  const [items, setItems] = useState([])
  const [classStudents, setClassStudents] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [targetMode, setTargetMode] = useState('class')
  const [error, setError] = useState('')
  useEffect(() => { Promise.all([api.getAssignments(classId), api.getStudents(classId)]).then(([data, nextStudents]) => { setItems(data.map((item) => ({ ...item, type: item.type === 'exam' ? 'Bài kiểm tra' : 'Bài tập', due: `Hạn nộp ${new Date(item.dueAt).toLocaleDateString('vi-VN')}`, progress: item.submitted ? `${item.submitted}/${item.total} đã nộp` : `${item.total} người nhận`, tone: item.type === 'exam' ? 'orange' : 'blue' }))); setClassStudents(nextStudents) }).catch((requestError) => setError(requestError.message)) }, [classId])
  async function addAssignment(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const studentIds = targetMode === 'individual' ? form.getAll('studentIds') : []
    try {
      const payload = new FormData()
      payload.append('title', form.get('title'))
      payload.append('type', form.get('type'))
      payload.append('dueAt', new Date(`${form.get('due')}T23:59:00`).toISOString())
      payload.append('studentIds', JSON.stringify(studentIds))
      if (form.get('file')?.size) payload.append('file', form.get('file'))
      const item = await api.createAssignment(classId, payload)
      setItems((current) => [...current, { ...item, type: item.type === 'exam' ? 'Bài kiểm tra' : 'Bài tập', due: `Hạn nộp ${new Date(item.dueAt).toLocaleDateString('vi-VN')}`, progress: `${item.total} người nhận`, tone: item.type === 'exam' ? 'orange' : 'blue' }])
      event.currentTarget.reset(); setTargetMode('class'); setShowForm(false)
    } catch (requestError) { setError(requestError.message) }
  }
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">BÀI TẬP VÀ KIỂM TRA</span><h3>{items.length} hoạt động</h3></div><button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus size={17} /> Giao bài tập / kiểm tra</button></div>{error && <p className="interaction-hint">{error}</p>}{showForm && <form className="assignment-form" onSubmit={addAssignment}><div className="form-row"><label>Tên hoạt động<input name="title" placeholder="Tên bài tập hoặc bài kiểm tra" required /></label><label>Loại<select name="type" defaultValue="homework"><option value="homework">Bài tập</option><option value="exam">Bài kiểm tra</option></select></label></div><label>Hạn nộp<input name="due" type="date" required /></label><label>Đính kèm đề hoặc tài liệu<input name="file" type="file" accept="image/*,.pdf,.doc,.docx" /></label><label>Đối tượng<select value={targetMode} onChange={(event) => setTargetMode(event.target.value)}><option value="class">Cả lớp</option><option value="individual">Chọn học sinh</option></select></label>{targetMode === 'individual' && <select name="studentIds" multiple required size={Math.min(5, Math.max(2, classStudents.length))}>{classStudents.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.id}</option>)}</select>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Hủy</button><button className="primary-button" type="submit">Giao hoạt động</button></div></form>}<div className="assignment-list">{items.map((item) => <Assignment key={item.id} {...item} />)}</div></section>
}
function AIGenerator() {
  const [exam, setExam] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function generate(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setExam(null)
    const form = new FormData(event.currentTarget)
    try { setExam(await api.generateExam({ topic: form.get('topic'), questionCount: Number(form.get('questionCount')), difficulty: form.get('difficulty'), instructions: form.get('instructions') })) } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }
  return <section className="ai-layout"><section className="panel ai-form-panel"><div className="panel-head"><div><span className="section-kicker">EXAMAI AI</span><h3>Tạo đề kiểm tra</h3></div><span className="ai-badge"><Zap size={13} /> Gemini</span></div><p className="muted ai-description">Nhập chủ đề để AI tạo bản nháp. Giáo viên luôn kiểm duyệt trước khi giao cho lớp.</p><form className="ai-form" onSubmit={generate}><label>Chủ đề<input name="topic" placeholder="Ví dụ: Kinh tế vi mô - cung cầu" required /></label><div className="form-row"><label>Số câu<select name="questionCount" defaultValue="10"><option value="5">5 câu</option><option value="10">10 câu</option><option value="20">20 câu</option></select></label><label>Độ khó<select name="difficulty" defaultValue="medium"><option value="easy">Cơ bản</option><option value="medium">Trung bình</option><option value="hard">Nâng cao</option></select></label></div><label>Yêu cầu thêm<textarea name="instructions" rows="4" placeholder="Ví dụ: Tập trung vào ví dụ thực tế, phù hợp sinh viên năm nhất..." /></label>{error && <p className="api-alert">{error}</p>}<button className="primary-button ai-submit" disabled={busy}>{busy ? 'AI đang tạo đề...' : <><Zap size={17} /> Tạo đề bằng AI</>}</button></form></section><section className="panel exam-preview">{exam ? <><div className="panel-head"><div><span className="section-kicker">BẢN NHÁP CẦN KIỂM DUYỆT</span><h3>{exam.title}</h3></div><span className="question-count">{exam.questions.length} câu</span></div><div className="question-list">{exam.questions.map((question, index) => <article className="question-card" key={`${question.question}-${index}`}><strong>Câu {index + 1}. {question.question}</strong><ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol><small>Đáp án AI chọn: {String.fromCharCode(65 + question.correctAnswer)} · {question.explanation}</small></article>)}</div></> : <div className="empty-preview"><Zap size={26} /><strong>Bản xem trước đề thi</strong><p>Đề thi AI sẽ xuất hiện ở đây để bạn kiểm tra trước khi xuất bản.</p></div>}</section></section>
}
function Assignment({ id, title, type, due, progress, tone, attachment }) {
  const [submissions, setSubmissions] = useState([])
  useEffect(() => { api.getSubmissions(id).then(setSubmissions).catch(() => setSubmissions([])) }, [id])
  return <div className="assignment-row"><div className={`assignment-icon ${tone}`}><BookOpen size={19} /></div><div><strong>{title}</strong><small>{type} <span>·</span> {due}{attachment ? ` · Tệp: ${attachment.name}` : ''}</small>{submissions.map((submission) => <a key={submission.id} className="submission-link" href={`data:${submission.file.mimeType};base64,${submission.file.data}`} download={`${submission.studentName}-${submission.file.name}`}>Bài của {submission.studentName} · tải xuống</a>)}</div><span className={`assignment-progress ${tone}`}>{submissions.length ? `${submissions.length} đã nộp` : progress}</span><span className="row-arrow">→</span></div>
}

function StudentPortal({ user, onLogout }) {
  const [classes, setClasses] = useState([])
  const [assignments, setAssignments] = useState([])
  const [exams, setExams] = useState([])
  const [timetableItems, setTimetableItems] = useState([])
  const [attendanceSessions, setAttendanceSessions] = useState([])
  const [attendanceCode, setAttendanceCode] = useState('')
  const [attendanceMessage, setAttendanceMessage] = useState('')
  const [notifications, setNotifications] = useState([])
  const [selectedAssignment, setSelectedAssignment] = useState(null)
  const [view, setView] = useState('home')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [nextClasses, nextExams, nextTimetable] = await Promise.all([api.getClasses(), api.getExams(), api.getTimetable()])
        const nextAssignments = (await Promise.all(nextClasses.map((classItem) => api.getAssignments(classItem.id)))).flat()
        const attendanceItems = (await Promise.all(nextClasses.map((classItem) => api.getAttendance(classItem.id)))).flatMap((item) => item.sessions)
        setClasses(nextClasses)
        setExams(nextExams)
        setTimetableItems(nextTimetable)
        setAssignments(nextAssignments)
        setAttendanceSessions(attendanceItems.filter((session) => session.status === 'active' && new Date(session.expiresAt).getTime() > Date.now()))
        setNotifications(await api.getNotifications())
      } catch (requestError) {
        setError(requestError.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function checkIn() {
    try {
      const result = await api.checkInAttendance(attendanceCode.trim())
      setAttendanceMessage(`Đã điểm danh có mặt tại lớp ${result.classItem.code}.`)
      setAttendanceCode('')
      setAttendanceSessions((current) => current.filter((session) => session.id !== result.session.id))
    } catch (requestError) {
      setAttendanceMessage(requestError.message)
    }
  }

  if (view === 'exam') return <main className="auth-screen student-portal-screen"><section className="student-portal"><ExamRunner user={user} onBack={() => setView('home')} /></section></main>
  if (view === 'submission' && selectedAssignment) return <main className="auth-screen student-portal-screen"><section className="student-portal"><SubmissionForm assignment={selectedAssignment} onBack={() => setView('home')} /></section></main>
  if (view === 'settings') return <main className="auth-screen student-portal-screen"><section className="student-portal"><AccountSettings user={user} onUserUpdated={(updated) => { localStorage.setItem('examai_user', JSON.stringify(updated)); setView('home') }} /><button className="secondary-button portal-back-button" onClick={() => setView('home')}>← Về trang học tập</button></section></main>

  return <main className="auth-screen student-portal-screen"><section className="student-portal">
    <header className="student-portal-head"><div><div className="brand"><span className="brand-mark"><GraduationCap size={20} /></span><span>Exam<span>AI</span></span></div><span className="section-kicker">KHÔNG GIAN HỌC TẬP</span><h1>Xin chào, {user.name}</h1><p className="muted">Theo dõi lớp học, bài tập và bài kiểm tra của bạn.</p></div><div className="portal-actions"><button className="secondary-button" onClick={() => setView('settings')}><Settings size={16} /> Tài khoản</button><button className="secondary-button" onClick={onLogout}><LogOut size={16} /> Đăng xuất</button></div></header>
    {error && <p className="api-alert">{error}</p>}
    {loading ? <div className="boot-state">Đang tải không gian học tập...</div> : <div className="student-portal-grid">
      <section className="panel"><div className="panel-head"><div><span className="section-kicker">LỚP HỌC CỦA TÔI</span><h3>{classes.length} lớp</h3></div><Users size={20} /></div>{classes.length ? classes.map((classItem) => <div className="assignment-row" key={classItem.id}><div className="assignment-icon blue"><BookOpen size={19} /></div><div><strong>{classItem.code}</strong><small>{classItem.name} · {classItem.schedule || 'Chưa có lịch học'}</small></div><span className="assignment-progress blue">{classItem.studentCount} HS</span></div>) : <p className="interaction-hint">Bạn chưa được thêm vào lớp nào.</p>}</section>
      <section className="panel"><div className="panel-head"><div><span className="section-kicker">BÀI KIỂM TRA</span><h3>{exams.length} bài có thể làm</h3></div><ClipboardCheck size={20} /></div>{exams.length ? exams.map((exam) => <button className="exam-list-item exam-list-button" key={exam.id} onClick={() => setView('exam')}><div className="assignment-icon orange"><ClipboardCheck size={18} /></div><span><strong>{exam.title}</strong><small>{exam.questionCount} câu · {exam.durationMinutes} phút</small></span><span className="row-arrow">→</span></button>) : <p className="interaction-hint">Chưa có bài kiểm tra được giao.</p>}</section>
      <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">ĐIỂM DANH THEO BUỔI</span><h3>{attendanceSessions.length ? 'Có buổi đang mở' : 'Chưa có buổi đang mở'}</h3></div><CalendarDays size={20} /></div><p className="muted">Nhập mã 6 chữ số do giáo viên cung cấp để xác nhận có mặt.</p><div className="inline-form"><input value={attendanceCode} onChange={(event) => setAttendanceCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Mã điểm danh" aria-label="Mã điểm danh" /><button className="primary-button" onClick={checkIn} disabled={attendanceCode.length !== 6}>Xác nhận có mặt</button></div>{attendanceSessions.map((session) => <div className="assignment-row" key={session.id}><div className="assignment-icon blue"><Clock3 size={19} /></div><div><strong>Buổi học đang mở</strong><small>Hết hạn lúc {new Date(session.expiresAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></div><span className="assignment-progress blue">Mã 6 số</span></div>)}{attendanceMessage && <p className={attendanceMessage.startsWith('Đã ') ? 'success-alert' : 'api-alert'}>{attendanceMessage}</p>}</section>
      <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">THỜI KHÓA BIỂU</span><h3>{timetableItems.length} buổi học</h3></div><Clock3 size={20} /></div>{timetableItems.length ? <div className="timetable-list">{timetableItems.map((item) => <div className="timetable-row" key={item.id}><div className="timetable-date"><strong>{new Date(item.startsAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong><small>{new Date(item.startsAt).toLocaleDateString('vi-VN', { weekday: 'short' })}</small></div><div className="timetable-copy"><strong>{item.title}</strong><small>{item.classCode} · {new Date(item.startsAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.endsAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {item.room || 'Chưa có phòng'}</small></div>{item.attendanceSession?.status === 'active' && <span className="live-badge"><span /> Đang mở</span>}</div>)}</div> : <p className="interaction-hint">Chưa có lịch học được công bố.</p>}</section>
      <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">BÀI TẬP SẮP TỚI</span><h3>{assignments.length} hoạt động</h3></div><CalendarDays size={20} /></div>{assignments.length ? <div className="assignment-list">{assignments.map((assignment) => <button className="assignment-row assignment-button" key={assignment.id} onClick={() => assignment.examId ? setView('exam') : (setSelectedAssignment(assignment), setView('submission'))}><div className={`assignment-icon ${assignment.type === 'exam' ? 'orange' : 'blue'}`}><BookOpen size={19} /></div><div><strong>{assignment.title}</strong><small>{assignment.type === 'exam' ? 'Bài kiểm tra online' : 'Tài liệu'} · Hạn nộp {new Date(assignment.dueAt).toLocaleDateString('vi-VN')}</small></div><span className="assignment-progress blue">{assignment.examId ? 'Làm bài →' : 'Nộp bài →'}</span></button>)}</div> : <p className="interaction-hint">Chưa có bài tập nào.</p>}</section>
      <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">THÔNG BÁO</span><h3>{notifications.length ? `${notifications.length} thông báo mới` : 'Không có thông báo mới'}</h3></div><Bell size={20} /></div>{notifications.length ? notifications.slice(0, 5).map((notification) => <div className="assignment-row" key={notification.id}><div className="assignment-icon blue"><Bell size={18} /></div><div><strong>{notification.title}</strong><small>{notification.message} · {new Date(notification.createdAt).toLocaleString('vi-VN')}</small></div></div>) : <p className="interaction-hint">Lịch học và hoạt động mới sẽ xuất hiện tại đây.</p>}</section>
    </div>}
  </section></main>
}

function SubmissionForm({ assignment, onBack }) {
  const [file, setFile] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      await api.submitAssignment(assignment.id, form)
      setMessage('Đã gửi bài làm cho giáo viên.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">NỘP BÀI TẬP</span><h3>{assignment.title}</h3><p className="muted">Hạn nộp {new Date(assignment.dueAt).toLocaleString('vi-VN')}</p></div></div>{assignment.attachment && <a className="secondary-button" href={`data:${assignment.attachment.mimeType};base64,${assignment.attachment.data}`} download={assignment.attachment.name}>Tải tài liệu giáo viên: {assignment.attachment.name}</a>}<form className="assignment-form" onSubmit={submit}><label>Chụp hoặc tải bài làm<input type="file" accept="image/*,.pdf,.doc,.docx" capture="environment" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>{file && <p className="interaction-hint">Đã chọn: {file.name}</p>}{message && <p className={message.startsWith('Đã ') ? 'success-alert' : 'api-alert'}>{message}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onBack}>Quay lại</button><button className="primary-button" disabled={busy || !file}>{busy ? 'Đang gửi...' : 'Gửi bài làm'}</button></div></form></section>
}

function Login({ onLogin }) {
  const googleButtonRef = useRef(null)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '')
  const [mode, setMode] = useState(() => new URLSearchParams(window.location.search).get('resetToken') ? 'reset' : 'login')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [role, setRole] = useState('student')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (mode === 'forgot' || mode === 'reset') return
    if (!clientId || !googleButtonRef.current) return
    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return
      window.google.accounts.id.initialize({ client_id: clientId, callback: async ({ credential }) => { setBusy(true); setError(''); try { onLogin(await api.googleLogin(credential)) } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } } })
      googleButtonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'large', width: 340, text: 'continue_with' })
    }
    if (window.google?.accounts?.id) renderGoogleButton()
    else { const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.onload = renderGoogleButton; document.head.appendChild(script) }
  }, [onLogin, mode])
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { if (mode === 'forgot') { setError((await api.forgotPassword(email)).message); return } if (mode === 'reset') { if (password !== confirmPassword) throw new Error('Mật khẩu xác nhận không khớp.'); setError((await api.resetPassword({ token: resetToken, password })).message); setPassword(''); setConfirmPassword(''); window.history.replaceState({}, '', window.location.pathname); setMode('login'); return } onLogin(await (mode === 'login' ? api.login({ identifier: username, password, role }) : api.register({ name, username, email, phone, studentCode, password, role }))) } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } }
  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setBusy(false)
    if (nextMode === 'register') {
      setUsername('')
      setRole('student')
    }
    if (nextMode === 'login') { setUsername(''); setPassword(''); setRole('student') }
  }
  return <main className="auth-screen"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark"><GraduationCap size={20} /></span><span>Exam<span>AI</span></span></div><span className="section-kicker">KHÔNG GIAN HỌC TẬP</span><h1>{mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : mode === 'reset' ? 'Đặt lại mật khẩu' : 'Quên mật khẩu'}</h1><p>{mode === 'login' ? 'Chọn đúng loại tài khoản để vào đúng không gian làm việc.' : mode === 'register' ? 'Chọn loại tài khoản phù hợp để bắt đầu.' : mode === 'reset' ? 'Tạo mật khẩu mới cho tài khoản của bạn.' : 'Nhập email để nhận hướng dẫn đặt lại mật khẩu.'}</p>{mode !== 'forgot' && mode !== 'reset' && <div className="auth-switch"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Đăng nhập</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Đăng ký</button></div>}{(mode === 'register' || mode === 'login') && <div className="role-picker"><button type="button" className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>Học sinh</button><button type="button" className={role === 'teacher' ? 'active' : ''} onClick={() => setRole('teacher')}>Giáo viên</button></div>}<form className="auth-form" onSubmit={submit}>{mode === 'register' && <><label>Họ và tên<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Tên tài khoản<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="vd: nguyenvana"   required /></label></>}{mode === 'forgot' && <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}{mode === 'login' && <label>Email hoặc tên tài khoản<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>}{mode === 'register' && <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}{mode === 'register' && <label>Số điện thoại<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Không bắt buộc" /></label>}{mode === 'register' && role === 'student' && <label>Mã học sinh<input value={studentCode} onChange={(event) => setStudentCode(event.target.value)} placeholder="Ví dụ: HS00128" /></label>}{mode !== 'forgot' && <label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>}{mode === 'reset' && <label>Xác nhận mật khẩu<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required /></label>}{error && <p className={mode === 'forgot' || mode === 'reset' ? 'success-alert' : 'api-alert'}>{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? `Tạo tài khoản ${role === 'teacher' ? 'giáo viên' : 'học sinh'}` : mode === 'reset' ? 'Đặt lại mật khẩu' : 'Gửi hướng dẫn'}</button></form>{mode === 'login' && <button className="link-button" onClick={() => switchMode('forgot')}>Quên mật khẩu?</button>}{(mode === 'forgot' || mode === 'reset') && <button className="link-button" onClick={() => switchMode('login')}>← Quay lại đăng nhập</button>}{mode !== 'forgot' && mode !== 'reset' && <><div className="auth-divider"><span>hoặc</span></div><span className="google-label">{mode === 'login' ? 'Đăng nhập bằng Google' : 'Đăng ký bằng Google'}</span><div ref={googleButtonRef} className="google-button" /></>}</section></main>
}

function AdminUsers() {
  const [users, setUsers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.getAdminUsers().then(setUsers).catch((requestError) => setError(requestError.message)) }, [])
  async function createUser(event) { event.preventDefault(); const form = new FormData(event.currentTarget); try { const user = await api.createAdminUser({ name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') }); setUsers((current) => [...current, user]); event.currentTarget.reset(); setShowForm(false) } catch (requestError) { setError(requestError.message) } }
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">QUẢN TRỊ HỆ THỐNG</span><h3>Người dùng</h3></div><button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus size={17} /> Tạo tài khoản</button></div>{error && <p className="interaction-hint">{error}</p>}{showForm && <form className="inline-form" onSubmit={createUser}><input name="name" placeholder="Họ tên" required /><input name="email" type="email" placeholder="Email" required /><input name="password" type="password" placeholder="Mật khẩu" required /><select name="role" defaultValue="student"><option value="student">Học sinh</option><option value="teacher">Giáo viên</option><option value="admin">Admin</option></select><button className="primary-button">Tạo</button></form>}<div className="student-table">{users.map((user) => <div className="table-row" key={user.id}><div className="student-cell"><div className="avatar avatar-table">{user.name.split(' ').map((part) => part[0]).slice(-2).join('')}</div><div><strong>{user.name}</strong><small>{user.email}</small></div></div><span className="assignment-progress blue">{user.role}</span><span className="attendance-time">{new Date(user.createdAt).toLocaleDateString('vi-VN')}</span><span /></div>)}</div></section>
}

function AccountSettings({ user, onUserUpdated }) {
  const [profile, setProfile] = useState({ name: user.name || '', phone: user.phone || '', studentCode: user.studentCode || '' })
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function saveProfile(event) { event.preventDefault(); setError(''); setMessage(''); try { const updated = await api.updateProfile(profile); onUserUpdated(updated); setMessage('Thông tin cá nhân đã được cập nhật.') } catch (requestError) { setError(requestError.message) } }
  async function changePassword(event) { event.preventDefault(); setError(''); setMessage(''); try { setMessage((await api.changePassword(passwords)).message); setPasswords({ currentPassword: '', newPassword: '' }) } catch (requestError) { setError(requestError.message) } }
  return <section className="settings-grid"><section className="panel"><span className="section-kicker">TÀI KHOẢN</span><h3>Thông tin cá nhân</h3><form className="auth-form settings-form" onSubmit={saveProfile}><label>Họ và tên<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label><label>Email<input value={user.email} disabled /></label><label>Số điện thoại<input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label><label>Mã học sinh<input value={profile.studentCode} onChange={(event) => setProfile({ ...profile, studentCode: event.target.value })} /></label><button className="primary-button">Lưu thông tin</button></form></section><section className="panel"><span className="section-kicker">BẢO MẬT</span><h3>Thay đổi mật khẩu</h3><form className="auth-form settings-form" onSubmit={changePassword}><label>Mật khẩu hiện tại<input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required /></label><label>Mật khẩu mới<input type="password" minLength={8} value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required /></label><button className="primary-button">Đổi mật khẩu</button></form>{message && <p className="success-alert">{message}</p>}{error && <p className="api-alert">{error}</p>}</section></section>
}

function ExamRunner({ user, onBack }) {
  const [exams, setExams] = useState([])
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [studentId, setStudentId] = useState(user?.studentCode || '')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.getExams().then(setExams).catch((requestError) => setError(requestError.message)) }, [])
  async function openExam(examId) { try { setSelected(await api.getExam(examId)); setAnswers([]); setResult(null) } catch (requestError) { setError(requestError.message) } }
  async function submitExam() { try { setResult(await api.submitAttempt(selected.id, { studentId: studentId.trim().toUpperCase(), answers })) } catch (requestError) { setError(requestError.message) } }
  if (result) return <section className="panel exam-result"><span className="section-kicker">KẾT QUẢ BÀI LÀM</span><strong>{result.score}/10</strong><p>Đúng {result.correctCount}/{result.totalQuestions} câu hỏi.</p><button className="secondary-button" onClick={() => setResult(null)}>Xem lại bài</button></section>
  if (selected) return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">BÀI KIỂM TRA ONLINE</span><h3>{selected.title}</h3></div><button className="secondary-button" onClick={() => { setSelected(null); onBack?.() }}>← Danh sách đề</button></div>{user ? <p className="student-id-field">Mã học sinh: <strong>{studentId || 'Chưa cập nhật'}</strong></p> : <label className="student-id-field">Mã học sinh<input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Ví dụ: HS00128" /></label>}<div className="student-exam-list">{selected.questions.map((question, index) => <article className="student-question" key={`${question.question}-${index}`}><strong>Câu {index + 1}. {question.question}</strong>{question.options.map((option, optionIndex) => <label key={option}><input type="radio" name={`question-${index}`} checked={answers[index] === optionIndex} onChange={() => setAnswers((current) => { const next = [...current]; next[index] = optionIndex; return next })} /> {option}</label>)}</article>)}</div><button className="primary-button submit-exam" onClick={submitExam} disabled={!studentId.trim() || answers.length !== selected.questions.length}>Nộp bài</button></section>
  return <section className="panel full-panel"><div className="panel-head"><div><span className="section-kicker">DÀNH CHO HỌC SINH</span><h3>Bài kiểm tra trực tuyến</h3></div></div>{error && <p className="interaction-hint">{error}</p>}{exams.length ? <div className="exam-list">{exams.map((exam) => <button className="exam-list-item" key={exam.id} onClick={() => openExam(exam.id)}><div className="assignment-icon orange"><ClipboardCheck size={18} /></div><span><strong>{exam.title}</strong><small>{exam.questionCount} câu · {exam.durationMinutes} phút</small></span><span className="row-arrow">→</span></button>)}</div> : <div className="empty-preview"><ClipboardCheck size={26} /><strong>Chưa có bài kiểm tra</strong><p>Đề thi giáo viên lưu sẽ xuất hiện ở đây.</p></div>}</section>
}

function parseManualExam(text) {
  const blocks = text.split(/\n(?=\s*(?:Câu|Question)\s*\d+[.:])/i).map((block) => block.trim()).filter(Boolean)
  const questions = blocks.map((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const questionLine = lines[0].replace(/^(?:Câu|Question)\s*\d+\s*[.:]\s*/i, '')
    const options = []
    let correctAnswer = null
    lines.slice(1).forEach((line) => {
      const option = line.match(/^([A-D])[\s.)]+(.+)$/i)
      const answer = line.match(/^(?:Đáp án|ĐA|Answer)\s*[:.]?\s*([A-D])/i)
      if (option) options.push(option[2].trim())
      if (answer) correctAnswer = answer[1].toUpperCase().charCodeAt(0) - 65
    })
    return { question: questionLine, options, correctAnswer, explanation: '' }
  }).filter((question) => question.question && question.options.length >= 2)
  if (!questions.length) throw new Error('Không nhận diện được câu hỏi. Hãy dùng định dạng: Câu 1: ... rồi các dòng A. ..., B. ... và Đáp án: A.')
  return { title: 'Bài kiểm tra nhập trực tiếp', subject: '', questions }
}

function AIGeneratorV2({ classId }) {
  const [mode, setMode] = useState('file')
  const [exam, setExam] = useState(null)
  const [classStudents, setClassStudents] = useState([])
  const [targetMode, setTargetMode] = useState('class')
  const [selectedStudentIds, setSelectedStudentIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState('')
  const [published, setPublished] = useState(false)
  useEffect(() => { api.getStudents(classId).then(setClassStudents).catch(() => setClassStudents([])) }, [classId])
  async function generate(event) {
    event.preventDefault(); setBusy(true); setError(''); setExam(null); setSavedId(''); setPublished(false); setTargetMode('class'); setSelectedStudentIds([])
    const form = new FormData(event.currentTarget)
    try {
      const result = mode === 'file' ? await api.generateExamFromFile(form) : parseManualExam(form.get('topic'))
      setExam(result)
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }
  async function saveExam() {
    try { const saved = await api.saveExam({ title: exam.title, subject: exam.subject, questions: exam.questions, classId }); setSavedId(saved.id) } catch (requestError) { setError(requestError.message) }
  }
  async function publishExam() { try { await api.publishExam(classId, savedId, { studentIds: targetMode === 'individual' ? selectedStudentIds : [] }); setPublished(true) } catch (requestError) { setError(requestError.message) } }
  return <section className="ai-layout"><section className="panel ai-form-panel"><div className="panel-head"><div><span className="section-kicker">EXAMAI CONVERTER</span><h3>Chuyển đề thành bài online</h3></div><span className="ai-badge"><Zap size={13} /> Chuẩn hóa</span></div><div className="mode-switch"><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Tải Word/PDF</button><button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Nhập thủ công</button></div><p className="muted ai-description">File của giáo viên đã có sẵn câu hỏi. Hệ thống chỉ đọc, giữ nguyên và chuyển thành bài kiểm tra online.</p><form className="ai-form" onSubmit={generate}>{mode === 'file' ? <label>File đề trắc nghiệm<input name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label> : <label>Nội dung đề trắc nghiệm<textarea name="topic" rows="8" placeholder="Ví dụ: Câu 1. ...\nA. ...\nB. ...\nĐáp án: B" required /></label>}<label>Ghi chú cho hệ thống<textarea name="instructions" rows="3" placeholder="Ví dụ: đáp án nằm ở cuối tài liệu, giữ nguyên số câu..." /></label>{error && <p className="api-alert">{error}</p>}<button className="primary-button ai-submit" disabled={busy}>{busy ? 'Đang chuyển đổi...' : <><Zap size={17} /> Chuyển thành bài online</>}</button></form></section><section className="panel exam-preview">{exam ? <><div className="panel-head"><div><span className="section-kicker">BẢN NHÁP CẦN KIỂM DUYỆT</span><h3>{exam.title}</h3></div><div className="preview-actions"><span className="question-count">{exam.questions.length} câu</span><button className="primary-button" onClick={saveExam} disabled={Boolean(savedId)}>{savedId ? 'Đã lưu đề' : 'Lưu đề thi'}</button>{savedId && <button className="secondary-button" onClick={publishExam} disabled={published}>{published ? 'Đã giao vào lớp' : 'Giao vào lớp'}</button>}</div></div>{savedId && <div className="exam-publish-target"><label>Đối tượng giao<select value={targetMode} onChange={(event) => setTargetMode(event.target.value)}><option value="class">Cả lớp</option><option value="individual">Chọn học sinh</option></select></label>{targetMode === 'individual' && <select multiple size={4} value={selectedStudentIds} onChange={(event) => setSelectedStudentIds([...event.target.selectedOptions].map((option) => option.value))}>{classStudents.map((student) => <option value={student.id} key={student.id}>{student.name} · {student.id}</option>)}</select>}</div>}<div className="question-list">{exam.questions.map((question, index) => <article className="question-card" key={`${question.question}-${index}`}><strong>Câu {index + 1}. {question.question}</strong><ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol><small>{question.correctAnswer === null || question.correctAnswer === undefined ? 'Chưa nhận diện đáp án, cần giáo viên kiểm tra.' : `Đáp án: ${String.fromCharCode(65 + question.correctAnswer)}`} {question.explanation && `· ${question.explanation}`}</small></article>)}</div></> : <div className="empty-preview"><Zap size={26} /><strong>Bản xem trước bài online</strong><p>Tải file hoặc nhập đề có sẵn để chuyển đổi, không tạo thêm câu hỏi.</p></div>}</section></section>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
