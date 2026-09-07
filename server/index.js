import cors from 'cors'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import multer from 'multer'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDirectory = process.env.DATA_DIR || __dirname
mkdirSync(dataDirectory, { recursive: true })
const dataPath = join(dataDirectory, 'data.json')
const seedDataPath = join(__dirname, 'data.json')
const backupDataPath = join(dataDirectory, 'data.json.bak')
const app = express()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || 'exam-ai-development-secret-change-me'
const googleClientId = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = new OAuth2Client(googleClientId)
const appUrl = process.env.APP_URL || 'http://localhost:5173'
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const geminiFallbackModels = [geminiModel, 'gemini-3.6-flash', 'gemini-flash-latest'].filter((model, index, models) => models.indexOf(model) === index)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL.trim())
const isExamAiVercelOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isExamAiVercelOrigin(origin)) return callback(null, true)
    return callback(null, false)
  },
}))
app.use(express.json())
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const emptyData = () => ({ users: [], classes: [], students: [], classJoinRequests: [], timetableSessions: [], attendanceSessions: [], attendanceRecords: [], assignments: [], submissions: [], notifications: [], exams: [], attempts: [], passwordResetTokens: [] })

function normalizeData(data) {
  const defaults = emptyData()
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, Array.isArray(data?.[key]) ? data[key] : fallback]))
}

function readData() {
  if (!existsSync(dataPath)) {
    if (existsSync(backupDataPath)) copyFileSync(backupDataPath, dataPath)
    else if (dataDirectory !== __dirname && existsSync(seedDataPath)) copyFileSync(seedDataPath, dataPath)
    else writeFileSync(dataPath, `${JSON.stringify(emptyData(), null, 2)}\n`)
  }
  try {
    return normalizeData(JSON.parse(readFileSync(dataPath, 'utf8')))
  } catch (error) {
    if (existsSync(backupDataPath)) return normalizeData(JSON.parse(readFileSync(backupDataPath, 'utf8')))
    throw error
  }
}

function writeData(data) {
  const serialized = `${JSON.stringify(normalizeData(data), null, 2)}\n`
  const tempPath = `${dataPath}.tmp`
  if (existsSync(dataPath)) copyFileSync(dataPath, backupDataPath)
  writeFileSync(tempPath, serialized)
  renameSync(tempPath, dataPath)
}

function findClass(data, classId) {
  return data.classes.find((item) => item.id === classId || item.code === classId)
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' })
}

function publicUser(user) {
  const { passwordHash, ...safeUser } = user
  return safeUser
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Vui lòng đăng nhập.' })
  try {
    req.user = jwt.verify(header.slice(7), jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' })
  }
}

function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' })
}

function requireClass(req, res) {
  const data = readData()
  const classItem = findClass(data, req.params.classId)
  if (!classItem) {
    res.status(404).json({ error: 'Không tìm thấy lớp học.' })
    return null
  }
  return { data, classItem }
}

function requireClassManager(req, res) {
  const result = requireClass(req, res)
  if (!result) return null
  if (req.user.role !== 'admin' && result.classItem.teacherId !== req.user.sub) {
    res.status(403).json({ error: 'Bạn không quản lý lớp học này.' })
    return null
  }
  return result
}

function getStudentForUser(data, user) {
  const account = data.users?.find((item) => item.id === user?.sub) || user
  return data.students.find((student) => student.id === account?.studentCode || student.userId === user?.sub || student.email?.toLowerCase() === account?.email?.toLowerCase())
}

function canViewClass(data, classItem, user) {
  if (!classItem || !user) return false
  if (user.role === 'admin') return true
  if (user.role === 'teacher') return classItem.teacherId === user.sub
  return getStudentForUser(data, user)?.classId === classItem.id
}

function canViewAssignment(data, assignment, user) {
  if (!assignment || !user) return false
  const classItem = findClass(data, assignment.classId)
  if (!canViewClass(data, classItem, user)) return false
  if (user.role !== 'student') return true
  const student = getStudentForUser(data, user)
  const targetStudentIds = Array.isArray(assignment.targetStudentIds) ? assignment.targetStudentIds : []
  return assignment.targetType !== 'individual' || targetStudentIds.includes(student?.id)
}

function findTimetableSession(data, timetableId) {
  return (data.timetableSessions || []).find((item) => item.id === timetableId)
}

function requireTimetableManager(req, res) {
  const data = readData()
  const timetableSession = findTimetableSession(data, req.params.timetableId)
  if (!timetableSession) {
    res.status(404).json({ error: 'Không tìm thấy buổi học trong thời khóa biểu.' })
    return null
  }
  const classItem = findClass(data, timetableSession.classId)
  if (!classItem || (req.user.role !== 'admin' && classItem.teacherId !== req.user.sub)) {
    res.status(403).json({ error: 'Bạn không quản lý buổi học này.' })
    return null
  }
  return { data, timetableSession, classItem }
}

function createAttendanceSession(data, classItem, timetableSession, expiresInMinutes) {
  const now = new Date()
  data.attendanceSessions ||= []
  data.attendanceSessions
    .filter((item) => item.classId === classItem.id && item.status === 'active')
    .forEach((item) => { item.status = 'closed' })
  const session = {
    id: `attendance-${randomUUID()}`,
    classId: classItem.id,
    timetableSessionId: timetableSession?.id || null,
    code: String(Math.floor(100000 + Math.random() * 900000)),
    startsAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMinutes * 60000).toISOString(),
    status: 'active',
  }
  data.attendanceSessions.push(session)
  data.attendanceRecords ||= []
  data.students
    .filter((student) => student.classId === classItem.id)
    .forEach((student) => data.attendanceRecords.push({
      id: `record-${randomUUID()}`,
      sessionId: session.id,
      studentId: student.id,
      status: 'absent',
      checkedAt: null,
    }))
  return session
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'exam-ai-api', version: 'student-summary-v1', timestamp: new Date().toISOString() })
})

app.post('/api/auth/login', async (req, res) => {
  const { identifier, email, password, role } = req.body
  const data = readData()
  const loginIdentifier = String(identifier || email || '').trim().toLowerCase()
  const user = (data.users || []).find((item) => item.email?.toLowerCase() === loginIdentifier || item.username?.toLowerCase() === loginIdentifier)
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' })
  if (role && user.role !== role) return res.status(403).json({ error: `Tài khoản này là ${user.role === 'teacher' ? 'giáo viên' : user.role === 'student' ? 'học sinh' : 'quản trị viên'}, không phải loại tài khoản đã chọn.` })
  res.json({ data: { token: issueToken(user), user: publicUser(user) } })
})

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, username, phone = '', studentCode = '', role = 'student' } = req.body
  const normalizedUsername = normalizeUsername(username)
  if (!email?.trim() || !password || !name?.trim() || !normalizedUsername) return res.status(400).json({ error: 'Họ tên, tên tài khoản, email và mật khẩu là bắt buộc.' })
  if (!/^[a-z0-9._-]{3,30}$/.test(normalizedUsername)) return res.status(400).json({ error: 'Tên tài khoản dùng 3-30 ký tự: chữ thường, số, ., _ hoặc -.' })
  if (password.length < 8) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' })
  if (!['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Vai trò đăng ký không hợp lệ.' })
  const data = readData()
  data.users ||= []
  if (data.users.some((user) => user.email?.toLowerCase() === email.trim().toLowerCase())) return res.status(409).json({ error: 'Email đã được sử dụng.' })
  if (data.users.some((user) => user.username?.toLowerCase() === normalizedUsername)) return res.status(409).json({ error: 'Tên tài khoản đã được sử dụng.' })
  const user = { id: `${role}-${randomUUID()}`, username: normalizedUsername, email: email.trim().toLowerCase(), name: name.trim(), phone: phone.trim(), studentCode: role === 'student' ? studentCode.trim() : '', role, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() }
  data.users.push(user)
  writeData(data)
  res.status(201).json({ data: { token: issueToken(user), user: publicUser(user) } })
})

app.post('/api/auth/forgot-password', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const data = readData()
  const user = data.users?.find((item) => item.email?.toLowerCase() === email)
  const response = { message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư.' }
  if (user) {
    const rawToken = randomUUID().replaceAll('-', '')
    data.passwordResetTokens ||= []
    data.passwordResetTokens.push({ tokenHash: createHash('sha256').update(rawToken).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
    writeData(data)
    if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
      fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [user.email], subject: 'Đặt lại mật khẩu ExamAI', html: `<p>Xin chào ${user.name},</p><p>Nhấn vào liên kết sau để đặt lại mật khẩu:</p><p><a href="${appUrl}/?resetToken=${rawToken}">${appUrl}/?resetToken=${rawToken}</a></p><p>Liên kết có hiệu lực trong 15 phút.</p>` }) }).catch((error) => console.error('Reset email error:', error))
    } else if (process.env.NODE_ENV !== 'production') response.resetToken = rawToken
  }
  res.json({ data: response })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Token và mật khẩu mới tối thiểu 8 ký tự là bắt buộc.' })
  const data = readData()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const reset = (data.passwordResetTokens || []).find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date())
  if (!reset) return res.status(400).json({ error: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' })
  const user = data.users.find((item) => item.id === reset.userId)
  user.passwordHash = await bcrypt.hash(password, 12)
  data.passwordResetTokens = data.passwordResetTokens.filter((item) => item !== reset)
  writeData(data)
  res.json({ data: { message: 'Mật khẩu đã được thay đổi.' } })
})

app.post('/api/auth/google', async (req, res) => {
  if (!googleClientId) return res.status(503).json({ error: 'Backend chưa cấu hình GOOGLE_CLIENT_ID.' })
  const { credential } = req.body
  if (!credential) return res.status(400).json({ error: 'Google credential là bắt buộc.' })
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId })
    const profile = ticket.getPayload()
    if (!profile?.sub || !profile.email || !profile.email_verified) return res.status(401).json({ error: 'Tài khoản Google chưa được xác minh.' })
    const data = readData()
    data.users ||= []
    let user = data.users.find((item) => item.googleSub === profile.sub || item.email.toLowerCase() === profile.email.toLowerCase())
    if (!user) {
      const baseUsername = normalizeUsername(profile.email.split('@')[0]).replace(/[^a-z0-9._-]/g, '').slice(0, 24) || `student${Date.now()}`
      user = { id: `student-${randomUUID()}`, username: `${baseUsername}-${randomUUID().slice(0, 4)}`, email: profile.email.toLowerCase(), name: profile.name || profile.email.split('@')[0], phone: '', studentCode: '', role: 'student', googleSub: profile.sub, avatarUrl: profile.picture || '', createdAt: new Date().toISOString() }
      data.users.push(user)
    } else if (!user.googleSub) {
      user.googleSub = profile.sub
      user.avatarUrl = profile.picture || user.avatarUrl || ''
      writeData(data)
    }
    const { passwordHash, ...publicUser } = user
    res.json({ data: { token: issueToken(user), user: publicUser } })
  } catch (error) {
    console.error('Google auth error:', error)
    res.status(401).json({ error: 'Không thể xác minh tài khoản Google.' })
  }
})

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = readData().users.find((item) => item.id === req.user.sub)
  if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại.' })
  res.json({ data: publicUser(user) })
})

app.patch('/api/auth/profile', authenticate, (req, res) => {
  const data = readData()
  const user = data.users.find((item) => item.id === req.user.sub)
  if (!user) return res.status(404).json({ error: 'Tài khoản không tồn tại.' })
  const { name, phone, studentCode } = req.body
  if (name?.trim()) user.name = name.trim()
  if (phone !== undefined) user.phone = String(phone).trim()
  if (studentCode !== undefined) user.studentCode = String(studentCode).trim()
  writeData(data)
  res.json({ data: publicUser(user) })
})

app.patch('/api/auth/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' })
  const data = readData()
  const user = data.users.find((item) => item.id === req.user.sub)
  if (!user || !(await bcrypt.compare(currentPassword || '', user.passwordHash || ''))) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' })
  user.passwordHash = await bcrypt.hash(newPassword, 12)
  writeData(data)
  res.json({ data: { message: 'Mật khẩu đã được thay đổi.' } })
})

app.get('/api/admin/users', authenticate, allowRoles('admin'), (_req, res) => {
  const users = readData().users.map(({ passwordHash, ...user }) => user)
  res.json({ data: users })
})

app.post('/api/admin/users', authenticate, allowRoles('admin'), async (req, res) => {
  const { email, name, role = 'student', password } = req.body
  if (!email || !name || !password || !['admin', 'teacher', 'student'].includes(role)) return res.status(400).json({ error: 'email, name, password và role là bắt buộc.' })
  const data = readData()
  if (data.users.some((user) => user.email.toLowerCase() === email.trim().toLowerCase())) return res.status(409).json({ error: 'Email đã tồn tại.' })
  const user = { id: `${role}-${randomUUID()}`, email: email.trim().toLowerCase(), name: name.trim(), role, passwordHash: await bcrypt.hash(password, 10), createdAt: new Date().toISOString() }
  data.users.push(user)
  writeData(data)
  const { passwordHash, ...publicUser } = user
  res.status(201).json({ data: publicUser })
})

app.use('/api', authenticate)

async function requestGemini(apiKey, prompt, generationConfig) {
  let lastError = 'Gemini không thể xử lý yêu cầu.'
  for (const model of geminiFallbackModels) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) return payload
        lastError = payload.error?.message || lastError
        const retryable = response.status === 429 || response.status >= 500 || /high demand|temporar|overload/i.test(lastError)
        if (!retryable) break
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700))
      } catch (error) {
        lastError = error.message || lastError
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700))
      }
    }
  }
  const error = new Error(lastError)
  error.status = 502
  throw error
}

app.post('/api/ai/generate-exam', async (req, res) => {
  const { topic, questionCount = 10, difficulty = 'medium', language = 'Vietnamese', instructions = '' } = req.body
  const apiKey = process.env.GEMINI_API_KEY
  const count = Number(questionCount)
  if (!apiKey) return res.status(503).json({ error: 'Backend chưa được cấu hình GEMINI_API_KEY.' })
  if (!topic?.trim()) return res.status(400).json({ error: 'Chủ đề tạo đề là bắt buộc.' })
  if (!Number.isInteger(count) || count < 1 || count > 50) return res.status(400).json({ error: 'Số câu phải từ 1 đến 50.' })

  const prompt = `Bạn là trợ lý tạo đề thi cho giáo viên. Hãy tạo ${count} câu hỏi trắc nghiệm về chủ đề "${topic.trim()}".
Độ khó: ${difficulty}. Ngôn ngữ: ${language}. Yêu cầu thêm: ${instructions || 'Không có'}.
Chỉ trả về JSON hợp lệ, không markdown, theo schema:
{"title":"string","subject":"string","questions":[{"question":"string","options":["string","string","string","string"],"correctAnswer":0,"explanation":"string"}]}
correctAnswer là index từ 0 đến 3. Mỗi câu phải có đúng 4 lựa chọn và chỉ một đáp án đúng.`
  try {
    const payload = await requestGemini(apiKey, prompt, { responseMimeType: 'application/json', temperature: 0.4 })
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(502).json({ error: 'Gemini trả về dữ liệu rỗng.' })
    const exam = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (!exam.title || !Array.isArray(exam.questions)) return res.status(502).json({ error: 'Định dạng đề thi từ AI không hợp lệ.' })
    res.json({ data: exam })
  } catch (error) {
    console.error('AI generation error:', error)
    res.status(502).json({ error: 'Không thể kết nối dịch vụ AI.' })
  }
})

app.post('/api/ai/generate-exam-from-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng tải lên file Word hoặc PDF.' })
  let sourceText = ''
  try {
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      const parser = new PDFParse({ data: req.file.buffer })
      const result = await parser.getText()
      sourceText = result.text
      await parser.destroy()
    } else if (req.file.mimetype.includes('word') || req.file.originalname.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.convertToHtml({
        buffer: req.file.buffer,
        convertImage: mammoth.images.imgElement((image) => image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` }))),
      })
      sourceText = result.value
    } else return res.status(415).json({ error: 'Chỉ hỗ trợ file .docx hoặc .pdf.' })
  } catch (error) {
    console.error('Document parsing error:', error)
    return res.status(422).json({ error: 'Không thể đọc nội dung file. Hãy thử file Word hoặc PDF khác.' })
  }
  if (!sourceText.trim()) return res.status(422).json({ error: 'File không có nội dung văn bản có thể đọc.' })
  const { instructions = '' } = req.body
  return convertExamText(sourceText, instructions, res)
})

app.post('/api/ai/convert-exam-text', async (req, res) => {
  const { text, instructions = '' } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'Nội dung đề thi là bắt buộc.' })
  return convertExamText(text, instructions, res)
})

app.post('/api/exams', allowRoles('admin', 'teacher'), (req, res) => {
  const { title, subject = '', questions, classId = null, durationMinutes = 30 } = req.body
  if (!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({ error: 'Đề thi cần có tiêu đề và ít nhất một câu hỏi.' })
  const data = readData()
  if (classId && !canViewClass(data, findClass(data, classId), req.user)) return res.status(403).json({ error: 'Bạn không quản lý lớp học này.' })
  data.exams ||= []
  const exam = { id: `exam-${randomUUID()}`, title: title.trim(), subject, questions, classId, durationMinutes: Number(durationMinutes), status: 'draft', createdAt: new Date().toISOString() }
  data.exams.push(exam)
  writeData(data)
  res.status(201).json({ data: exam })
})

app.post('/api/classes/:classId/exams/:examId/publish', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const exam = (result.data.exams || []).find((item) => item.id === req.params.examId)
  if (!exam) return res.status(404).json({ error: 'Không tìm thấy đề thi.' })
  exam.classId = result.classItem.id
  exam.status = 'published'
  const { dueAt, durationMinutes = exam.durationMinutes || 30, studentIds = [] } = req.body
  if (!Array.isArray(studentIds)) return res.status(400).json({ error: 'studentIds phải là một mảng.' })
  const classStudents = result.data.students.filter((student) => student.classId === result.classItem.id)
  const requestedStudentIds = [...new Set(studentIds.map((id) => String(id).trim()))]
  if (requestedStudentIds.some((id) => !classStudents.some((student) => student.id === id))) return res.status(400).json({ error: 'Có học sinh không thuộc lớp học này.' })
  const targetStudentIds = requestedStudentIds.length ? requestedStudentIds : classStudents.map((student) => student.id)
  const assignment = { id: `assignment-${randomUUID()}`, classId: result.classItem.id, examId: exam.id, title: exam.title, type: 'exam', dueAt: dueAt || new Date(Date.now() + 7 * 86400000).toISOString(), status: 'published', targetType: requestedStudentIds.length ? 'individual' : 'class', targetStudentIds, submitted: 0, total: targetStudentIds.length, durationMinutes: Number(durationMinutes), createdAt: new Date().toISOString(), createdBy: req.user.sub }
  result.data.assignments.push(assignment)
  result.data.notifications ||= []
  result.data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: assignment.targetType, classId: result.classItem.id, studentIds: targetStudentIds, type: 'assignment', title: 'Đề thi mới', message: `${exam.title} đã được giao vào lớp ${result.classItem.code}.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.status(201).json({ data: assignment })
})

app.get('/api/exams', (req, res) => {
  const data = readData()
  const visibleExams = (data.exams || []).filter((exam) => exam.status === 'published' && (
    req.user.role === 'admin'
    || (req.user.role === 'teacher' && (!exam.classId || canViewClass(data, findClass(data, exam.classId), req.user)))
    || (req.user.role === 'student' && (data.assignments || []).some((assignment) => assignment.examId === exam.id && canViewAssignment(data, assignment, req.user)))
  ))
  res.json({ data: visibleExams.map(({ questions, ...exam }) => ({ ...exam, questionCount: questions.length })) })
})

app.get('/api/exams/:examId', (req, res) => {
  const data = readData()
  const exam = (data.exams || []).find((item) => item.id === req.params.examId)
  if (!exam) return res.status(404).json({ error: 'Không tìm thấy đề thi.' })
  const assignment = (data.assignments || []).find((item) => item.examId === exam.id && canViewAssignment(data, item, req.user))
  if (req.user.role === 'student' && (!assignment || exam.status !== 'published')) return res.status(403).json({ error: 'Đề thi chưa được giao cho bạn.' })
  if (req.user.role === 'teacher' && exam.classId && !canViewClass(data, findClass(data, exam.classId), req.user)) return res.status(403).json({ error: 'Bạn không quản lý đề thi này.' })
  res.json({ data: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) } })
})

app.post('/api/exams/:examId/attempts', (req, res) => {
  const data = readData()
  const exam = (data.exams || []).find((item) => item.id === req.params.examId)
  if (!exam) return res.status(404).json({ error: 'Không tìm thấy đề thi.' })
  const { studentId, answers = [] } = req.body
  if (!studentId) return res.status(400).json({ error: 'studentId là bắt buộc.' })
  const student = data.students.find((item) => item.id === String(studentId).trim().toUpperCase())
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' })
  if (req.user.role === 'student' && (!getStudentForUser(data, req.user) || getStudentForUser(data, req.user).id !== student.id)) return res.status(403).json({ error: 'Bạn chỉ có thể nộp bài cho tài khoản của mình.' })
  if (req.user.role === 'student' && !(data.assignments || []).some((item) => item.examId === exam.id && canViewAssignment(data, item, req.user))) return res.status(403).json({ error: 'Bạn chưa được giao đề thi này.' })
  const score = exam.questions.reduce((total, question, index) => total + (answers[index] === question.correctAnswer ? 1 : 0), 0)
  data.attempts ||= []
  const attempt = { id: `attempt-${randomUUID()}`, examId: exam.id, studentId, answers, correctCount: score, totalQuestions: exam.questions.length, score: Math.round((score / exam.questions.length) * 10 * 100) / 100, submittedAt: new Date().toISOString() }
  data.attempts.push(attempt)
  writeData(data)
  res.status(201).json({ data: { ...attempt, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) } })
})

async function generateExamFromGemini(req, res) {
  const { topic, questionCount = 10, difficulty = 'medium', language = 'Vietnamese', instructions = '' } = req.body
  const apiKey = process.env.GEMINI_API_KEY
  const count = Number(questionCount)
  if (!apiKey) return res.status(503).json({ error: 'Backend chưa được cấu hình GEMINI_API_KEY.' })
  const prompt = `Bạn là trợ lý tạo đề thi. Dựa trên nội dung tài liệu dưới đây, tạo ${count} câu hỏi trắc nghiệm. Độ khó: ${difficulty}. Ngôn ngữ: ${language}. ${instructions}
Chỉ trả về JSON hợp lệ theo schema: {"title":"string","subject":"string","questions":[{"question":"string","options":["string","string","string","string"],"correctAnswer":0,"explanation":"string"}]}. correctAnswer là index 0-3. Mỗi câu đúng 4 lựa chọn và chỉ một đáp án đúng.
NỘI DUNG TÀI LIỆU:
${topic}`
  try {
    const payload = await requestGemini(apiKey, prompt, { responseMimeType: 'application/json', temperature: 0.4 })
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    const exam = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (!exam.title || !Array.isArray(exam.questions)) return res.status(502).json({ error: 'Định dạng đề thi từ AI không hợp lệ.' })
    res.json({ data: exam })
  } catch (error) { console.error('AI generation error:', error); res.status(502).json({ error: 'Không thể tạo đề từ nội dung tài liệu.' }) }
}

async function convertExamText(sourceText, instructions, res) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'Backend chưa được cấu hình GEMINI_API_KEY.' })
  const prompt = `Bạn là bộ chuyển đổi đề thi, không phải người sáng tác đề. Nội dung đầu vào bên dưới đã là một đề trắc nghiệm hoàn chỉnh. Hãy chuyển nguyên trạng thành JSON để chạy online.
Quy tắc bắt buộc:
- Không tạo thêm câu hỏi.
- Không đổi ý nghĩa câu hỏi hoặc lựa chọn.
- Giữ nguyên thứ tự câu hỏi và các lựa chọn.
- Chỉ nhận diện đáp án đúng nếu tài liệu đánh dấu rõ bằng đáp án, ký hiệu, hoặc phần đáp án cuối tài liệu. Nếu không nhận diện được, đặt correctAnswer là null.
- Không tự đoán đáp án.
- Giữ giải thích nếu tài liệu có; nếu không có, để chuỗi rỗng.
- Giữ nguyên nội dung ảnh, MathType, MathML và LaTeX trong câu hỏi/lựa chọn; không thay thế, diễn giải hoặc làm mất chúng. Nếu ảnh xuất hiện, giữ nguyên bằng chuỗi data URL hoặc thẻ HTML trong trường tương ứng.
- Nếu câu không đủ 4 lựa chọn hoặc không phải trắc nghiệm, vẫn giữ câu đó nhưng dùng các lựa chọn đang có.
${instructions ? `Yêu cầu định dạng thêm: ${instructions}` : ''}
Chỉ trả về JSON hợp lệ, không markdown, theo schema:
{"title":"string","subject":"string","questions":[{"question":"string","options":["string"],"correctAnswer":0,"explanation":"string"}]}
NỘI DUNG ĐỀ THI (có thể chứa HTML, ảnh data URL, MathML, LaTeX hoặc MathType):
${sourceText.slice(0, 50000)}`
  try {
    const payload = await requestGemini(apiKey, prompt, { responseMimeType: 'application/json', temperature: 0 })
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(502).json({ error: 'Gemini trả về dữ liệu rỗng.' })
    const exam = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (!exam.title || !Array.isArray(exam.questions) || !exam.questions.length) return res.status(502).json({ error: 'Không nhận diện được câu hỏi trắc nghiệm trong tài liệu.' })
    res.json({ data: exam })
  } catch (error) { console.error('Exam conversion error:', error); res.status(502).json({ error: 'Không thể chuyển đổi đề thi từ tài liệu.' }) }
}

app.get('/api/timetable', (req, res) => {
  const data = readData()
  const currentUser = data.users.find((user) => user.id === req.user.sub)
  const sessions = (data.timetableSessions || [])
    .map((session) => ({ ...session, classItem: findClass(data, session.classId) }))
    .filter((session) => canViewClass(data, session.classItem, currentUser || req.user))
    .map(({ classItem, ...session }) => ({
      ...session,
      classCode: classItem.code,
      className: classItem.name,
      teacherId: classItem.teacherId,
      attendanceSession: (data.attendanceSessions || [])
        .filter((attendance) => attendance.timetableSessionId === session.id)
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
        .map((attendance) => ({ ...attendance, status: attendance.status === 'active' && new Date(attendance.expiresAt).getTime() <= Date.now() ? 'expired' : attendance.status }))[0] || null,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  res.json({ data: sessions })
})

app.post('/api/timetable', allowRoles('admin', 'teacher'), (req, res) => {
  const { classId, title = '', subject = '', room = '', startsAt, endsAt, notes = '' } = req.body
  if (!classId || !startsAt || !endsAt) return res.status(400).json({ error: 'classId, startsAt và endsAt là bắt buộc.' })
  const data = readData()
  const classItem = findClass(data, classId)
  if (!classItem) return res.status(404).json({ error: 'Không tìm thấy lớp học.' })
  if (req.user.role !== 'admin' && classItem.teacherId !== req.user.sub) return res.status(403).json({ error: 'Bạn không quản lý lớp học này.' })
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return res.status(400).json({ error: 'Thời gian buổi học không hợp lệ.' })
  data.timetableSessions ||= []
  const timetableSession = {
    id: `timetable-${randomUUID()}`,
    classId: classItem.id,
    title: String(title || classItem.subject || classItem.name).trim(),
    subject: String(subject || classItem.subject || '').trim(),
    room: String(room || classItem.room || '').trim(),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    notes: String(notes || '').trim(),
    createdBy: req.user.sub,
    createdAt: new Date().toISOString(),
  }
  data.timetableSessions.push(timetableSession)
  writeData(data)
  res.status(201).json({ data: { ...timetableSession, classCode: classItem.code, className: classItem.name, attendanceSession: null } })
})

app.patch('/api/timetable/:timetableId', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireTimetableManager(req, res)
  if (!result) return
  const { title, subject, room, startsAt, endsAt, notes } = req.body
  const nextStart = startsAt === undefined ? new Date(result.timetableSession.startsAt) : new Date(startsAt)
  const nextEnd = endsAt === undefined ? new Date(result.timetableSession.endsAt) : new Date(endsAt)
  if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime()) || nextEnd <= nextStart) return res.status(400).json({ error: 'Thời gian buổi học không hợp lệ.' })
  if (title !== undefined) result.timetableSession.title = String(title).trim()
  if (subject !== undefined) result.timetableSession.subject = String(subject).trim()
  if (room !== undefined) result.timetableSession.room = String(room).trim()
  if (notes !== undefined) result.timetableSession.notes = String(notes).trim()
  result.timetableSession.startsAt = nextStart.toISOString()
  result.timetableSession.endsAt = nextEnd.toISOString()
  writeData(result.data)
  res.json({ data: result.timetableSession })
})

app.delete('/api/timetable/:timetableId', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireTimetableManager(req, res)
  if (!result) return
  result.data.timetableSessions = result.data.timetableSessions.filter((item) => item.id !== result.timetableSession.id)
  writeData(result.data)
  res.json({ data: { id: result.timetableSession.id } })
})

app.post('/api/timetable/:timetableId/attendance/sessions', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireTimetableManager(req, res)
  if (!result) return
  const expiresInMinutes = Math.max(1, Math.min(240, Number(req.body.expiresInMinutes || 90)))
  const session = createAttendanceSession(result.data, result.classItem, result.timetableSession, expiresInMinutes)
  result.data.notifications ||= []
  result.data.notifications.push({
    id: `notification-${randomUUID()}`,
    recipientType: 'class',
    classId: result.classItem.id,
    type: 'attendance',
    title: 'Mở điểm danh',
    message: `Điểm danh đã mở cho ${result.timetableSession.title}.`,
    isRead: false,
    createdAt: new Date().toISOString(),
  })
  writeData(result.data)
  res.status(201).json({ data: session })
})

app.get('/api/timetable/:timetableId/attendance', (req, res) => {
  const data = readData()
  const timetableSession = findTimetableSession(data, req.params.timetableId)
  const classItem = timetableSession && findClass(data, timetableSession.classId)
  const currentUser = data.users.find((user) => user.id === req.user.sub)
  if (!timetableSession || !canViewClass(data, classItem, currentUser || req.user)) return res.status(404).json({ error: 'Không tìm thấy buổi học.' })
  const sessions = (data.attendanceSessions || []).filter((session) => session.timetableSessionId === timetableSession.id)
  const records = (data.attendanceRecords || []).filter((record) => sessions.some((session) => session.id === record.sessionId))
  res.json({ data: { timetableSession, sessions, records } })
})

app.get('/api/classes', (req, res) => {
  const data = readData()
  const currentUser = data.users.find((user) => user.id === req.user.sub)
  const visibleClasses = req.user.role === 'student'
    ? data.classes.filter((classItem) => data.students.some((student) => student.classId === classItem.id && (student.userId === req.user.sub || student.email === currentUser?.email || student.id === currentUser?.studentCode)))
    : req.user.role === 'teacher'
      ? data.classes.filter((classItem) => classItem.teacherId === req.user.sub)
      : data.classes
  const classes = visibleClasses.map((classItem) => ({
    ...classItem,
    studentCount: data.students.filter((student) => student.classId === classItem.id).length,
    assignmentCount: data.assignments.filter((assignment) => assignment.classId === classItem.id).length,
    sessionCount: data.attendanceSessions.filter((session) => session.classId === classItem.id).length,
  }))
  res.json({ data: classes })
})

app.post('/api/classes', allowRoles('admin', 'teacher'), (req, res) => {
  const { code, name, subject = '', room = '', schedule = '' } = req.body
  if (!code || !name) return res.status(400).json({ error: 'code và name là bắt buộc.' })
  const data = readData()
  if (data.classes.some((item) => item.code.toLowerCase() === code.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Mã lớp đã tồn tại.' })
  }
  const classItem = { id: `class-${randomUUID()}`, code: code.trim().toUpperCase(), name: name.trim(), subject, room, schedule, teacherId: req.user.role === 'admin' ? (req.body.teacherId || req.user.sub) : req.user.sub, createdAt: new Date().toISOString() }
  data.classes.push(classItem)
  const scheduleMatch = schedule.match(/(?:thứ\s*)?([2-7]|chủ\s*nhật)[^\d]*(\d{1,2})[:h](\d{2})\s*(?:-|đến|–)\s*(\d{1,2})[:h](\d{2})/i)
  if (scheduleMatch) {
    const day = scheduleMatch[1].toLowerCase().includes('chủ') ? 0 : Number(scheduleMatch[1]) - 1
    const startHour = Number(scheduleMatch[2])
    const startMinute = Number(scheduleMatch[3])
    const endHour = Number(scheduleMatch[4])
    const endMinute = Number(scheduleMatch[5])
    const first = new Date()
    first.setHours(startHour, startMinute, 0, 0)
    first.setDate(first.getDate() + ((day - first.getDay() + 7) % 7))
    if (first <= new Date()) first.setDate(first.getDate() + 7)
    data.timetableSessions ||= []
    for (let week = 0; week < 12; week += 1) {
      const startsAt = new Date(first)
      startsAt.setDate(first.getDate() + week * 7)
      const endsAt = new Date(startsAt)
      endsAt.setHours(endHour, endMinute, 0, 0)
      data.timetableSessions.push({ id: `timetable-${randomUUID()}`, classId: classItem.id, title: `${classItem.name} - Tuần ${week + 1}`, subject: classItem.subject, room: classItem.room, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), notes: 'Tạo tự động từ lịch học của lớp.', createdBy: classItem.teacherId, createdAt: new Date().toISOString() })
    }
    data.notifications ||= []
    data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'class', classId: classItem.id, type: 'timetable', title: 'Lịch học mới', message: `Đã tạo tự động 12 buổi học cho lớp ${classItem.code}.`, isRead: false, createdAt: new Date().toISOString() })
  }
  writeData(data)
  res.status(201).json({ data: classItem })
})

app.get('/api/classes/:classId', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  const { data, classItem } = result
  if (!canViewClass(data, classItem, req.user)) return res.status(403).json({ error: 'Bạn không thuộc lớp học này.' })
  res.json({ data: { ...classItem, studentCount: data.students.filter((student) => student.classId === classItem.id).length, assignmentCount: data.assignments.filter((assignment) => assignment.classId === classItem.id).length, sessionCount: data.attendanceSessions.filter((session) => session.classId === classItem.id).length } })
})

app.patch('/api/classes/:classId', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const { code, name, subject, room, schedule } = req.body
  if (!name?.trim() || !code?.trim()) return res.status(400).json({ error: 'Tên lớp và mã lớp là bắt buộc.' })
  const normalizedCode = code.trim().toUpperCase()
  if (result.data.classes.some((item) => item.id !== result.classItem.id && item.code === normalizedCode)) return res.status(409).json({ error: 'Mã lớp đã tồn tại.' })
  Object.assign(result.classItem, { code: normalizedCode, name: name.trim(), subject: String(subject || '').trim(), room: String(room || '').trim(), schedule: String(schedule || '').trim(), updatedAt: new Date().toISOString() })
  result.data.notifications ||= []
  result.data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'class', classId: result.classItem.id, type: 'class-update', title: 'Lớp học được cập nhật', message: `Thông tin lớp ${result.classItem.code} đã được cập nhật.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.json({ data: result.classItem })
})

app.get('/api/classes/:classId/join-requests', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  res.json({ data: (result.data.classJoinRequests || []).filter((item) => item.classId === result.classItem.id && item.status === 'pending') })
})

app.post('/api/classes/:classId/join-requests', allowRoles('student'), (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  const data = result.data
  const existing = (data.classJoinRequests || []).find((item) => item.classId === result.classItem.id && item.userId === req.user.sub && item.status === 'pending')
  if (existing) return res.status(409).json({ error: 'Bạn đã gửi yêu cầu vào lớp này.' })
  if (data.students.some((item) => item.classId === result.classItem.id && item.userId === req.user.sub)) return res.status(409).json({ error: 'Bạn đã ở trong lớp này.' })
  const account = data.users.find((item) => item.id === req.user.sub)
  data.classJoinRequests ||= []
  const request = { id: `join-${randomUUID()}`, classId: result.classItem.id, userId: req.user.sub, studentCode: account?.studentCode || '', studentName: account?.name || req.user.name, status: 'pending', createdAt: new Date().toISOString() }
  data.classJoinRequests.push(request)
  data.notifications ||= []
  data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'teacher', classId: result.classItem.id, type: 'join-request', title: 'Yêu cầu vào lớp mới', message: `${request.studentName} muốn tham gia lớp ${result.classItem.code}.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(data)
  res.status(201).json({ data: request })
})

app.post('/api/classes/join-by-code', allowRoles('student'), (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase()
  const data = readData()
  const classItem = data.classes.find((item) => item.code === code)
  if (!classItem) return res.status(404).json({ error: 'Mã lớp không tồn tại.' })
  req.params.classId = classItem.id
  const existing = (data.classJoinRequests || []).find((item) => item.classId === classItem.id && item.userId === req.user.sub && item.status === 'pending')
  if (existing) return res.status(409).json({ error: 'Bạn đã gửi yêu cầu vào lớp này.' })
  if (data.students.some((item) => item.classId === classItem.id && item.userId === req.user.sub)) return res.status(409).json({ error: 'Bạn đã ở trong lớp này.' })
  const account = data.users.find((item) => item.id === req.user.sub)
  data.classJoinRequests ||= []
  const request = { id: `join-${randomUUID()}`, classId: classItem.id, userId: req.user.sub, studentCode: account?.studentCode || '', studentName: account?.name || req.user.name, status: 'pending', createdAt: new Date().toISOString() }
  data.classJoinRequests.push(request)
  data.notifications ||= []
  data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'teacher', classId: classItem.id, type: 'join-request', title: 'Yêu cầu vào lớp mới', message: `${request.studentName} muốn tham gia lớp ${classItem.code}.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(data)
  res.status(201).json({ data: { request, class: classItem } })
})

app.patch('/api/classes/:classId/join-requests/:requestId', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const request = (result.data.classJoinRequests || []).find((item) => item.id === req.params.requestId && item.classId === result.classItem.id)
  if (!request) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' })
  if (!['approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Trạng thái phê duyệt không hợp lệ.' })
  request.status = req.body.status
  request.reviewedAt = new Date().toISOString()
  if (request.status === 'approved') {
    const account = result.data.users.find((item) => item.id === request.userId)
    if (!result.data.students.some((item) => item.userId === request.userId || (request.studentCode && item.id === request.studentCode))) result.data.students.push({ id: request.studentCode || `HS${String(result.data.students.length + 1).padStart(5, '0')}`, userId: request.userId, name: account?.name || request.studentName, email: account?.email || '', phone: account?.phone || '', classId: result.classItem.id, status: 'absent', score: null })
  }
  result.data.notifications ||= []
  result.  data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'individual', userIds: [request.userId], studentIds: [request.studentCode], type: 'join-request', title: request.status === 'approved' ? 'Đã được duyệt vào lớp' : 'Yêu cầu vào lớp bị từ chối', message: `Yêu cầu vào lớp ${result.classItem.code} đã được ${request.status === 'approved' ? 'chấp thuận' : 'từ chối'}.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.json({ data: request })
})

app.get('/api/classes/:classId/students', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  if (!canViewClass(result.data, result.classItem, req.user)) return res.status(403).json({ error: 'Bạn không thuộc lớp học này.' })
  res.json({ data: result.data.students.filter((student) => student.classId === result.classItem.id) })
})

app.get('/api/classes/:classId/students/:studentId/summary', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  if (!canViewClass(result.data, result.classItem, req.user)) return res.status(403).json({ error: 'Bạn không quản lý lớp học này.' })
  const student = result.data.students.find((item) => item.classId === result.classItem.id && item.id === req.params.studentId)
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' })
  const assignments = (result.data.assignments || []).filter((item) => item.classId === result.classItem.id && (item.targetType !== 'individual' || item.targetStudentIds?.includes(student.id)))
  const submissions = (result.data.submissions || []).filter((item) => item.studentId === student.id && assignments.some((assignment) => assignment.id === item.assignmentId))
  const attempts = (result.data.attempts || []).filter((item) => item.studentId === student.id && assignments.some((assignment) => assignment.examId === item.examId))
  const completedIds = new Set([...submissions.map((item) => item.assignmentId), ...attempts.map((item) => assignments.find((assignment) => assignment.examId === item.examId)?.id)])
  const scores = attempts.map((item) => ({ examId: item.examId, score: item.score, correctCount: item.correctCount, totalQuestions: item.totalQuestions, submittedAt: item.submittedAt }))
  res.json({ data: { student, assignmentCount: assignments.length, completedCount: completedIds.size, incompleteCount: Math.max(0, assignments.length - completedIds.size), averageScore: scores.length ? Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length * 100) / 100 : null, scoreHistory: scores, submissions: submissions.map(({ file, ...item }) => item) } })
})

app.post('/api/classes/:classId/students', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const { name, email = '', phone = '', zalo = '' } = req.body
  if (!name) return res.status(400).json({ error: 'name là bắt buộc.' })
  const studentId = req.body.id?.trim().toUpperCase() || `HS${String(result.data.students.length + 1).padStart(5, '0')}`
  if (result.data.students.some((student) => student.id === studentId)) return res.status(409).json({ error: 'Mã học sinh đã tồn tại.' })
  const student = { id: studentId, name: name.trim(), email, phone: phone.trim(), zalo: zalo.trim(), classId: result.classItem.id, status: 'present', score: null }
  result.data.students.push(student)
  writeData(result.data)
  res.status(201).json({ data: student })
})

app.get('/api/classes/:classId/attendance', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  if (!canViewClass(result.data, result.classItem, req.user)) return res.status(403).json({ error: 'Bạn không thuộc lớp học này.' })
  const now = Date.now()
  const sessions = result.data.attendanceSessions.filter((session) => session.classId === result.classItem.id).map((session) => ({
    ...session,
    status: session.status === 'active' && new Date(session.expiresAt).getTime() <= now ? 'expired' : session.status,
  }))
  const records = result.data.attendanceRecords.filter((record) => sessions.some((session) => session.id === record.sessionId))
  res.json({ data: { sessions, records } })
})

app.post('/api/classes/:classId/attendance/sessions', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const timetableSession = req.body.timetableSessionId ? findTimetableSession(result.data, req.body.timetableSessionId) : null
  if (req.body.timetableSessionId && (!timetableSession || timetableSession.classId !== result.classItem.id)) return res.status(400).json({ error: 'Buổi học không thuộc lớp này.' })
  const expiresInMinutes = Math.max(1, Math.min(240, Number(req.body.expiresInMinutes || 2)))
  const session = createAttendanceSession(result.data, result.classItem, timetableSession, expiresInMinutes)
  writeData(result.data)
  res.status(201).json({ data: session })
})

app.patch('/api/attendance/:recordId', allowRoles('admin', 'teacher'), (req, res) => {
  const data = readData()
  const record = data.attendanceRecords.find((item) => item.id === req.params.recordId)
  if (!record) return res.status(404).json({ error: 'Không tìm thấy bản ghi điểm danh.' })
  const session = data.attendanceSessions.find((item) => item.id === record.sessionId)
  const classItem = session && findClass(data, session.classId)
  if (!session || !classItem || (req.user.role !== 'admin' && classItem.teacherId !== req.user.sub)) return res.status(403).json({ error: 'Bạn không quản lý bản ghi điểm danh này.' })
  if (!['present', 'late', 'absent', 'excused'].includes(req.body.status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  record.status = req.body.status
  record.checkedAt = new Date().toISOString()
  writeData(data)
  res.json({ data: record })
})

app.post('/api/attendance/check-in', authenticate, allowRoles('student'), (req, res) => {
  const code = String(req.body.code || '').trim()
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Mã điểm danh phải gồm 6 chữ số.' })
  const data = readData()
  const now = Date.now()
  const session = data.attendanceSessions.find((item) => item.code === code && item.status === 'active' && new Date(item.expiresAt).getTime() > now)
  if (!session) return res.status(404).json({ error: 'Mã điểm danh không tồn tại hoặc đã hết hạn.' })
  const classItem = findClass(data, session.classId)
  const user = data.users.find((item) => item.id === req.user.sub)
  const student = data.students.find((item) => item.id === user?.studentCode || item.email?.toLowerCase() === user?.email?.toLowerCase())
  if (!student || student.classId !== classItem?.id) return res.status(403).json({ error: 'Bạn chưa được xếp vào lớp của buổi học này.' })
  const record = data.attendanceRecords.find((item) => item.sessionId === session.id && item.studentId === student.id)
  if (!record) return res.status(404).json({ error: 'Không tìm thấy bản ghi điểm danh của bạn.' })
  record.status = 'present'
  record.checkedAt = new Date().toISOString()
  writeData(data)
  res.json({ data: { record, session, classItem } })
})

app.get('/api/classes/:classId/assignments', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  if (!canViewClass(result.data, result.classItem, req.user)) return res.status(403).json({ error: 'Bạn không thuộc lớp học này.' })
  res.json({ data: result.data.assignments.filter((assignment) => assignment.classId === result.classItem.id && canViewAssignment(result.data, assignment, req.user)) })
})

app.post('/api/classes/:classId/assignments', allowRoles('admin', 'teacher'), upload.single('file'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const { title, type = 'homework', dueAt } = req.body
  let studentIds = req.body.studentIds || []
  if (typeof studentIds === 'string') {
    try { studentIds = JSON.parse(studentIds) } catch { studentIds = studentIds.split(',').filter(Boolean) }
  }
  if (!title || !dueAt) return res.status(400).json({ error: 'title và dueAt là bắt buộc.' })
  if (!['homework', 'exam', 'document'].includes(type)) return res.status(400).json({ error: 'Loại hoạt động không hợp lệ.' })
  if (!Array.isArray(studentIds)) return res.status(400).json({ error: 'studentIds phải là một mảng.' })
  const classStudents = result.data.students.filter((student) => student.classId === result.classItem.id)
  const requestedStudentIds = [...new Set(studentIds.map((id) => String(id).trim()))]
  if (requestedStudentIds.some((id) => !classStudents.some((student) => student.id === id))) return res.status(400).json({ error: 'Có học sinh không thuộc lớp học này.' })
  const targetType = requestedStudentIds.length ? 'individual' : 'class'
  const targetStudentIds = requestedStudentIds.length ? requestedStudentIds : classStudents.map((student) => student.id)
  const assignment = {
    id: `assignment-${randomUUID()}`,
    classId: result.classItem.id,
    title: title.trim(),
    type,
    dueAt,
    status: 'published',
    targetType,
    targetStudentIds,
    submitted: 0,
    total: targetStudentIds.length,
    createdBy: req.user.sub,
    createdAt: new Date().toISOString(),
    attachment: req.file ? { name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, data: req.file.buffer.toString('base64') } : null,
  }
  result.data.assignments.push(assignment)
  result.data.notifications ||= []
  result.data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: targetType, classId: result.classItem.id, studentIds: targetStudentIds, type: 'assignment', title: type === 'exam' ? 'Đề thi mới' : 'Bài tập mới', message: `${assignment.title} đã được giao.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.status(201).json({ data: assignment })
})

app.get('/api/assignments/:assignmentId/submissions', allowRoles('admin', 'teacher'), (req, res) => {
  const data = readData()
  const assignment = (data.assignments || []).find((item) => item.id === req.params.assignmentId)
  if (!assignment) return res.status(404).json({ error: 'Không tìm thấy bài tập.' })
  const classItem = findClass(data, assignment.classId)
  if (!classItem || (req.user.role !== 'admin' && classItem.teacherId !== req.user.sub)) return res.status(403).json({ error: 'Bạn không có quyền xem bài nộp.' })
  res.json({ data: (data.submissions || []).filter((item) => item.assignmentId === assignment.id).map(({ file, ...item }) => ({ ...item, file: file ? { name: file.name, mimeType: file.mimeType, size: file.size, data: file.data } : null })) })
})

app.post('/api/assignments/:assignmentId/submissions', allowRoles('student'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chụp hoặc tải lên bài làm.' })
  const data = readData()
  const assignment = (data.assignments || []).find((item) => item.id === req.params.assignmentId)
  if (!assignment || !canViewAssignment(data, assignment, req.user)) return res.status(404).json({ error: 'Bài tập không tồn tại hoặc không dành cho bạn.' })
  if (new Date(assignment.dueAt).getTime() < Date.now()) return res.status(400).json({ error: 'Bài tập đã quá hạn nộp.' })
  const user = data.users.find((item) => item.id === req.user.sub)
  const student = data.students.find((item) => item.id === user?.studentCode || item.email?.toLowerCase() === user?.email?.toLowerCase())
  if (!student) return res.status(403).json({ error: 'Không tìm thấy hồ sơ học sinh.' })
  data.submissions ||= []
  const submission = { id: `submission-${randomUUID()}`, assignmentId: assignment.id, studentId: student.id, studentName: student.name, file: { name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, data: req.file.buffer.toString('base64') }, submittedAt: new Date().toISOString() }
  data.submissions = data.submissions.filter((item) => !(item.assignmentId === assignment.id && item.studentId === student.id))
  data.submissions.push(submission)
  assignment.submitted = data.submissions.filter((item) => item.assignmentId === assignment.id).length
  writeData(data)
  res.status(201).json({ data: { ...submission, file: { name: submission.file.name, mimeType: submission.file.mimeType, size: submission.file.size } } })
})

app.get('/api/notifications', (req, res) => {
  const data = readData()
  const student = req.user.role === 'student' ? getStudentForUser(data, req.user) : null
  const notifications = (data.notifications || []).filter((notification) => {
    if (req.user.role === 'admin') return true
    if (req.user.role === 'teacher') {
      const classItem = notification.classId && findClass(data, notification.classId)
      return !classItem || classItem.teacherId === req.user.sub
    }
    if (notification.recipientType === 'individual') return notification.userIds?.includes(req.user.sub) || notification.studentIds?.includes(student?.id)
    return notification.classId === student?.classId
  })
  res.json({ data: notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
})

app.use((_req, res) => res.status(404).json({ error: 'API route không tồn tại.' }))
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'Lỗi máy chủ.' })
})

if (!existsSync(dataPath)) writeData(emptyData())
app.listen(port, () => console.log(`ExamAI API đang chạy tại http://localhost:${port}`))
