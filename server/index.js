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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = join(__dirname, 'data.json')
const app = express()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || 'exam-ai-development-secret-change-me'
const googleClientId = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = new OAuth2Client(googleClientId)
const appUrl = process.env.APP_URL || 'http://localhost:5173'
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL.trim())
const isExamAiVercelOrigin = (origin) => /^https:\/\/smartstudent(?:-[a-z0-9-]+)?(?:-tranlocbtr99)?\.vercel\.app$/.test(origin)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isExamAiVercelOrigin(origin)) return callback(null, true)
    return callback(null, false)
  },
}))
app.use(express.json())
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

function readData() {
  return JSON.parse(readFileSync(dataPath, 'utf8'))
}

function writeData(data) {
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`)
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'exam-ai-api', timestamp: new Date().toISOString() })
})

app.post('/api/auth/login', async (req, res) => {
  const { identifier, email, password } = req.body
  const data = readData()
  const loginIdentifier = String(identifier || email || '').trim().toLowerCase()
  const user = (data.users || []).find((item) => item.email.toLowerCase() === loginIdentifier || item.username?.toLowerCase() === loginIdentifier)
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' })
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
  if (data.users.some((user) => user.email.toLowerCase() === email.trim().toLowerCase())) return res.status(409).json({ error: 'Email đã được sử dụng.' })
  if (data.users.some((user) => user.username?.toLowerCase() === normalizedUsername)) return res.status(409).json({ error: 'Tên tài khoản đã được sử dụng.' })
  const user = { id: `student-${randomUUID()}`, username: normalizedUsername, email: email.trim().toLowerCase(), name: name.trim(), phone: phone.trim(), studentCode: studentCode.trim(), role: 'student', passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() }
  data.users.push(user)
  writeData(data)
  res.status(201).json({ data: { token: issueToken(user), user: publicUser(user) } })
})

app.post('/api/auth/forgot-password', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const data = readData()
  const user = data.users?.find((item) => item.email.toLowerCase() === email)
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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
    })
    const payload = await response.json()
    if (!response.ok) return res.status(502).json({ error: payload.error?.message || 'Gemini không thể tạo đề.' })
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
      sourceText = (await mammoth.extractRawText({ buffer: req.file.buffer })).value
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
  const { dueAt, durationMinutes = exam.durationMinutes || 30 } = req.body
  const assignment = { id: `assignment-${randomUUID()}`, classId: result.classItem.id, examId: exam.id, title: exam.title, type: 'exam', dueAt: dueAt || new Date(Date.now() + 7 * 86400000).toISOString(), status: 'published', submitted: 0, total: result.data.students.filter((student) => student.classId === result.classItem.id).length, durationMinutes: Number(durationMinutes), createdAt: new Date().toISOString() }
  result.data.assignments.push(assignment)
  result.data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'class', classId: result.classItem.id, type: 'assignment', title: 'Đề thi mới', message: `${exam.title} đã được giao vào lớp ${result.classItem.code}.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.status(201).json({ data: assignment })
})

app.get('/api/exams', (_req, res) => {
  const data = readData()
  res.json({ data: (data.exams || []).filter((exam) => exam.status === 'published').map(({ questions, ...exam }) => ({ ...exam, questionCount: questions.length })) })
})

app.get('/api/exams/:examId', (req, res) => {
  const data = readData()
  const exam = (data.exams || []).find((item) => item.id === req.params.examId)
  if (!exam) return res.status(404).json({ error: 'Không tìm thấy đề thi.' })
  if (exam.status !== 'published' && !['admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Đề thi chưa được giao vào lớp.' })
  res.json({ data: { ...exam, questions: exam.questions.map(({ correctAnswer, explanation, ...question }) => question) } })
})

app.post('/api/exams/:examId/attempts', (req, res) => {
  const data = readData()
  const exam = (data.exams || []).find((item) => item.id === req.params.examId)
  if (!exam) return res.status(404).json({ error: 'Không tìm thấy đề thi.' })
  const { studentId, answers = [] } = req.body
  if (!studentId) return res.status(400).json({ error: 'studentId là bắt buộc.' })
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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }) })
    const payload = await response.json()
    if (!response.ok) return res.status(502).json({ error: payload.error?.message || 'Gemini không thể tạo đề.' })
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
- Nếu câu không đủ 4 lựa chọn hoặc không phải trắc nghiệm, vẫn giữ câu đó nhưng dùng các lựa chọn đang có.
${instructions ? `Yêu cầu định dạng thêm: ${instructions}` : ''}
Chỉ trả về JSON hợp lệ, không markdown, theo schema:
{"title":"string","subject":"string","questions":[{"question":"string","options":["string"],"correctAnswer":0,"explanation":"string"}]}
NỘI DUNG ĐỀ THI:
${sourceText.slice(0, 50000)}`
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) })
    const payload = await response.json()
    if (!response.ok) return res.status(502).json({ error: payload.error?.message || 'Gemini không thể chuyển đổi đề.' })
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(502).json({ error: 'Gemini trả về dữ liệu rỗng.' })
    const exam = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (!exam.title || !Array.isArray(exam.questions) || !exam.questions.length) return res.status(502).json({ error: 'Không nhận diện được câu hỏi trắc nghiệm trong tài liệu.' })
    res.json({ data: exam })
  } catch (error) { console.error('Exam conversion error:', error); res.status(502).json({ error: 'Không thể chuyển đổi đề thi từ tài liệu.' }) }
}

app.get('/api/classes', (req, res) => {
  const data = readData()
  const currentUser = data.users.find((user) => user.id === req.user.sub)
  const visibleClasses = req.user.role === 'student'
    ? data.classes.filter((classItem) => data.students.some((student) => student.classId === classItem.id && (student.email === currentUser?.email || student.id === currentUser?.studentCode)))
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
  writeData(data)
  res.status(201).json({ data: classItem })
})

app.get('/api/classes/:classId', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  const { data, classItem } = result
  res.json({ data: { ...classItem, studentCount: data.students.filter((student) => student.classId === classItem.id).length, assignmentCount: data.assignments.filter((assignment) => assignment.classId === classItem.id).length, sessionCount: data.attendanceSessions.filter((session) => session.classId === classItem.id).length } })
})

app.get('/api/classes/:classId/students', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  res.json({ data: result.data.students.filter((student) => student.classId === result.classItem.id) })
})

app.post('/api/classes/:classId/students', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const { name, email = '' } = req.body
  if (!name) return res.status(400).json({ error: 'name là bắt buộc.' })
  const studentId = req.body.id?.trim().toUpperCase() || `HS${String(result.data.students.length + 1).padStart(5, '0')}`
  if (result.data.students.some((student) => student.id === studentId)) return res.status(409).json({ error: 'Mã học sinh đã tồn tại.' })
  const student = { id: studentId, name: name.trim(), email, classId: result.classItem.id, status: 'present', score: null }
  result.data.students.push(student)
  writeData(result.data)
  res.status(201).json({ data: student })
})

app.get('/api/classes/:classId/attendance', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  const sessions = result.data.attendanceSessions.filter((session) => session.classId === result.classItem.id)
  const records = result.data.attendanceRecords.filter((record) => sessions.some((session) => session.id === record.sessionId))
  res.json({ data: { sessions, records } })
})

app.post('/api/classes/:classId/attendance/sessions', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const expiresInMinutes = Math.max(1, Number(req.body.expiresInMinutes || 2))
  const now = new Date()
  const session = { id: `attendance-${randomUUID()}`, classId: result.classItem.id, code: String(Math.floor(100000 + Math.random() * 900000)), startsAt: now.toISOString(), expiresAt: new Date(now.getTime() + expiresInMinutes * 60000).toISOString(), status: 'active' }
  result.data.attendanceSessions.push(session)
  result.data.students.filter((student) => student.classId === result.classItem.id).forEach((student) => result.data.attendanceRecords.push({ id: `record-${randomUUID()}`, sessionId: session.id, studentId: student.id, status: 'absent', checkedAt: null }))
  writeData(result.data)
  res.status(201).json({ data: session })
})

app.patch('/api/attendance/:recordId', allowRoles('admin', 'teacher'), (req, res) => {
  const data = readData()
  const record = data.attendanceRecords.find((item) => item.id === req.params.recordId)
  if (!record) return res.status(404).json({ error: 'Không tìm thấy bản ghi điểm danh.' })
  if (!['present', 'late', 'absent', 'excused'].includes(req.body.status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  record.status = req.body.status
  record.checkedAt = new Date().toISOString()
  writeData(data)
  res.json({ data: record })
})

app.get('/api/classes/:classId/assignments', (req, res) => {
  const result = requireClass(req, res)
  if (!result) return
  res.json({ data: result.data.assignments.filter((assignment) => assignment.classId === result.classItem.id) })
})

app.post('/api/classes/:classId/assignments', allowRoles('admin', 'teacher'), (req, res) => {
  const result = requireClassManager(req, res)
  if (!result) return
  const { title, type = 'exam', dueAt } = req.body
  if (!title || !dueAt) return res.status(400).json({ error: 'title và dueAt là bắt buộc.' })
  const assignment = { id: `assignment-${randomUUID()}`, classId: result.classItem.id, title: title.trim(), type, dueAt, status: 'published', submitted: 0, total: result.data.students.filter((student) => student.classId === result.classItem.id).length }
  result.data.assignments.push(assignment)
  result.data.notifications.push({ id: `notification-${randomUUID()}`, recipientType: 'class', classId: result.classItem.id, type: 'assignment', title: 'Bài tập mới', message: `${assignment.title} đã được giao.`, isRead: false, createdAt: new Date().toISOString() })
  writeData(result.data)
  res.status(201).json({ data: assignment })
})

app.get('/api/notifications', (_req, res) => {
  const data = readData()
  res.json({ data: data.notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
})

app.use((_req, res) => res.status(404).json({ error: 'API route không tồn tại.' }))
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'Lỗi máy chủ.' })
})

if (!existsSync(dataPath)) writeData({ classes: [], students: [], attendanceSessions: [], attendanceRecords: [], assignments: [], notifications: [] })
app.listen(port, () => console.log(`ExamAI API đang chạy tại http://localhost:${port}`))
