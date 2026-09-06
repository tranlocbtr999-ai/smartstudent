# ExamAI

>Nền tảng quản lý lớp học, điểm danh, bài tập và kiểm tra trực tuyến.

## Chạy local

```bash
npm install
npm run dev
```

Mở `http://localhost:5173` trong trình duyệt.

Frontend mặc định gọi API tại `http://localhost:4000/api`. Khi deploy, tạo biến môi trường `VITE_API_URL` theo mẫu trong [.env.example](.env.example) và đặt thành URL backend production.

## Chạy backend

Mở terminal thứ hai và chạy:

```bash
npm run server
```

API chạy tại `http://localhost:4000/api`. Danh sách endpoint và ví dụ request nằm trong [server/README.md](server/README.md).

## Kiểm tra production

```bash
npm run build
npm run preview
```

## Deploy online

Project hiện là frontend Vite static, có thể deploy trực tiếp lên Vercel hoặc Netlify.

### Vercel

1. Đẩy repository lên GitHub.
2. Vào Vercel, chọn **Add New Project** và import repository.
3. Vercel sẽ nhận diện Vite tự động. Nếu cần, dùng:
	- Build command: `npm run build`
	- Output directory: `dist`
4. Nhấn **Deploy**.

File `vercel.json` đã cấu hình fallback SPA để các route frontend không bị lỗi 404 khi refresh.

### Netlify

Import repository trên Netlify với:

- Build command: `npm run build`
- Publish directory: `dist`

File `netlify.toml` đã cấu hình redirect về `index.html`.

### Deploy backend

Backend Express có thể deploy riêng trên Render bằng file `render.yaml`:

1. Tạo **New Web Service** trên Render và chọn repository.
2. Render sẽ đọc `render.yaml`, chạy `npm install` và `npm start`.
3. Sau khi deploy, API có dạng `https://ten-service.onrender.com/api`.
4. Frontend cần dùng URL API này thay cho `http://localhost:4000/api` khi kết nối thật.

Lưu ý: `server/data.json` phù hợp cho demo và development. Production nên thay bằng PostgreSQL, Firebase hoặc Supabase vì filesystem của hosting có thể bị reset khi service restart.

### Checklist deploy Vercel + Render

1. Deploy repository trên Render dưới dạng **Web Service**. Render sẽ dùng `render.yaml`; đặt các secret `JWT_SECRET`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY` và `MAIL_FROM` trong Environment.
2. Copy URL Render, ví dụ `https://exam-ai-api.onrender.com`, sau đó trên Vercel tạo biến `VITE_API_URL=https://exam-ai-api.onrender.com/api`.
3. Trên Render đặt `FRONTEND_URL` bằng domain Vercel production và cập nhật `ALLOWED_ORIGINS` nếu dùng thêm preview domain. Redeploy backend sau khi đổi biến môi trường.
4. Nếu dùng Google, đặt cùng một Web Client ID vào `GOOGLE_CLIENT_ID` trên Render và `VITE_GOOGLE_CLIENT_ID` trên Vercel; thêm domain Vercel vào **Authorized JavaScript origins**.
5. Vercel dùng `npm run build` và thư mục `dist` theo `vercel.json`. Sau khi deploy, kiểm tra `https://<render-service>.onrender.com/api/health` trước khi đăng nhập trên frontend.

Đăng ký hiện có hai loại tài khoản: **Học sinh** và **Giáo viên**. Tài khoản giáo viên được đưa vào trang quản lý lớp, điểm danh, bài tập và tạo đề; tài khoản học sinh được đưa vào không gian học tập riêng để xem lớp, bài tập và bài kiểm tra được giao.

## Phạm vi hiện tại

Backend hiện cung cấp API REST và lưu file JSON. Khi Render restart, file JSON có thể bị reset; production nên chuyển sang PostgreSQL, Firebase hoặc Supabase. Backend đã giới hạn CORS bằng biến `ALLOWED_ORIGINS`; nếu đổi domain Vercel, cập nhật biến này trên Render rồi redeploy.

AI tạo đề hiện có hai luồng: chuyển file Word/PDF hoặc nội dung trắc nghiệm có sẵn thành bài online; hệ thống không tự thêm câu hỏi và không đoán đáp án nếu tài liệu không đánh dấu rõ.

Hệ thống đã có đăng nhập JWT và ba vai trò `admin`, `teacher`, `student`. Giáo viên/admin có thể lưu và giao đề vào lớp; học sinh chỉ có thể làm bài và nộp bài. Tài khoản demo và API auth được ghi trong [server/README.md](server/README.md).

Đăng ký email tạo tài khoản học sinh. Đăng nhập Google dùng Google Identity Services; cần cấu hình `GOOGLE_CLIENT_ID` trên Render và `VITE_GOOGLE_CLIENT_ID` trên Vercel với cùng một Web Client ID.

Để bật Google: tạo OAuth 2.0 Client ID loại Web trong Google Cloud Console, thêm domain Vercel vào **Authorized JavaScript origins**, đặt cùng Client ID ở Render (`GOOGLE_CLIENT_ID`) và Vercel (`VITE_GOOGLE_CLIENT_ID`), sau đó redeploy cả hai service.
