# ExamAI API

API dùng Express và lưu dữ liệu trong `data.json`. Khi chạy trên Render, `DATA_DIR=/var/data` trỏ tới persistent disk; backend tự migration các trường mới, ghi nguyên tử và giữ `data.json.bak` để khôi phục khi file chính hỏng.

## Chạy

```bash
npm run server
```

Base URL: `http://localhost:4000/api`

Để dùng AI chuyển đề, đặt `GEMINI_API_KEY` và `GEMINI_MODEL=gemini-3.6-flash` trên Render hoặc terminal backend local. Không đặt key này ở Vercel/frontend.

Tài khoản demo sau khi seed dữ liệu: `admin@examai.vn / Admin@123`, `teacher@examai.vn / Teacher@123`, `student@examai.vn / Student@123`. Hãy đổi mật khẩu và `JWT_SECRET` trước khi dùng production.

Quên mật khẩu production cần cấu hình `RESEND_API_KEY`, `MAIL_FROM` và `APP_URL`. Nếu chưa cấu hình email, backend chỉ trả token reset trong môi trường development, không trả token khi production.

## Endpoint chính

- `POST /auth/login`
- `POST /auth/register` (đăng ký học sinh hoặc giáo viên)
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `PATCH /auth/profile` (đã đăng nhập)
- `PATCH /auth/password` (đã đăng nhập)
- `POST /auth/google` (xác minh Google ID token)
- `GET /auth/me`
- `GET, POST /admin/users` (admin only)
- `GET /health`
- `GET, POST /classes`
- `GET /classes/:classId`
- `GET, POST /classes/:classId/students`
- `GET, POST /timetable` (lịch dạy toàn trường; teacher chỉ quản lý lớp của mình)
- `PATCH, DELETE /timetable/:timetableId`
- `GET /timetable/:timetableId/attendance`
- `POST /timetable/:timetableId/attendance/sessions` (mở điểm danh theo buổi học)
- `GET /classes/:classId/attendance`
- `POST /classes/:classId/attendance/sessions`
- `PATCH /attendance/:recordId`
- `GET, POST /classes/:classId/assignments`
- `GET /notifications`
- `POST /ai/generate-exam-from-file` (multipart Word/PDF, chuyển đổi đề có sẵn)
- `POST /ai/convert-exam-text` (chuyển đổi nội dung đề nhập thủ công)
- `POST /exams`
- `GET /exams/:examId` (học sinh chỉ thấy đề đã publish)
- `POST /exams/:examId/attempts`
- `POST /classes/:classId/exams/:examId/publish` (teacher/admin)

Các endpoint cần đăng nhập nhận header `Authorization: Bearer <token>`.

Google login cần tạo OAuth 2.0 Web Client ID trong Google Cloud Console. Thêm cùng Client ID vào `GOOGLE_CLIENT_ID` trên Render và `VITE_GOOGLE_CLIENT_ID` trên Vercel; thêm domain Vercel vào Authorized JavaScript origins.
- `POST /ai/generate-exam`

Khi tạo assignment, gửi `studentIds: []` để giao cả lớp hoặc `studentIds: ["HS00128"]` để giao cho học sinh được chọn. Hệ thống kiểm tra các mã học sinh phải thuộc lớp và chỉ trả assignment/đề thi cho đúng đối tượng.
