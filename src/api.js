const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
const productionApiUrl = 'https://smart-4ge3.onrender.com/api'
const API_URL = import.meta.env.PROD
  ? (configuredApiUrl && !configuredApiUrl.includes('exam-ai-api-7t0d.onrender.com') ? configuredApiUrl : productionApiUrl)
  : (configuredApiUrl || 'http://localhost:4000/api')

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const token = localStorage.getItem('examai_token')
  const headers = { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_URL}${path}`, {
    headers,
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Không thể kết nối máy chủ.')
  return payload.data
}

export const api = {
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (body) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (body) => request('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body) => request('/auth/password', { method: 'PATCH', body: JSON.stringify(body) }),
  googleLogin: (credential) => request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  me: () => request('/auth/me'),
  getAdminUsers: () => request('/admin/users'),
  createAdminUser: (body) => request('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  getClasses: () => request('/classes'),
  createClass: (body) => request('/classes', { method: 'POST', body: JSON.stringify(body) }),
  getStudents: (classId) => request(`/classes/${classId}/students`),
  getClass: (classId) => request(`/classes/${classId}`),
  addStudent: (classId, body) => request(`/classes/${classId}/students`, { method: 'POST', body: JSON.stringify(body) }),
  getAttendance: (classId) => request(`/classes/${classId}/attendance`),
  createAttendanceSession: (classId, body = {}) => request(`/classes/${classId}/attendance/sessions`, { method: 'POST', body: JSON.stringify(body) }),
  updateAttendance: (recordId, status) => request(`/attendance/${recordId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  checkInAttendance: (code) => request('/attendance/check-in', { method: 'POST', body: JSON.stringify({ code }) }),
  getAssignments: (classId) => request(`/classes/${classId}/assignments`),
  createAssignment: (classId, body) => request(`/classes/${classId}/assignments`, { method: 'POST', body: JSON.stringify(body) }),
  getNotifications: () => request('/notifications'),
  generateExam: (body) => request('/ai/generate-exam', { method: 'POST', body: JSON.stringify(body) }),
  generateExamFromFile: (formData) => request('/ai/generate-exam-from-file', { method: 'POST', body: formData }),
  convertExamText: (body) => request('/ai/convert-exam-text', { method: 'POST', body: JSON.stringify(body) }),
  saveExam: (body) => request('/exams', { method: 'POST', body: JSON.stringify(body) }),
  getExam: (examId) => request(`/exams/${examId}`),
  getExams: () => request('/exams'),
  submitAttempt: (examId, body) => request(`/exams/${examId}/attempts`, { method: 'POST', body: JSON.stringify(body) }),
  publishExam: (classId, examId, body) => request(`/classes/${classId}/exams/${examId}/publish`, { method: 'POST', body: JSON.stringify(body) }),
}
