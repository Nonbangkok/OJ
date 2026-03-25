# API Schema — WOI Grader Backend (50 APIs)

เอกสารนี้สรุป API ของ backend ตาม controller ทั้งหมด **ครบ 50 APIs** ตามรายการด้านล่าง
- `adminController.ts` = 10 APIs
- `authController.ts` = 5 APIs
- `contestController.ts` = 15 APIs
- `problemController.ts` = 14 APIs
- `submissionController.ts` = 6 APIs

รวมทั้งหมด: **50 APIs**

## Global Conventions

- Base routing ใน backend เป็น root (`/`) และใน production ผ่าน nginx proxy ด้วย prefix `/api` จาก frontend
- Authentication เป็น session-cookie (`connect.sid`) ต้องส่ง `withCredentials: true` จาก frontend
- Role ที่ใช้ในระบบ: `user`, `staff`, `admin`
- Middleware หลัก:
  - `requireAuth`: ต้อง login
  - `requireStaffOrAdmin`: ต้องเป็น staff/admin
  - `requireAdmin`: ต้องเป็น admin
  - `validateRequest`: ตรวจสอบ `body/params/query` ด้วย `z.object` จาก shared schema กลาง (`backend/schemas/requestSchemas.ts`)
- รูปแบบ error ที่พบได้:
  - `{ message: string }`
  - `{ message: string, errors: [...] }` (validation)
  - `{ message: string, error: string }` (import/export บางกรณี)

---

## 1) Admin Controller (10 APIs)

### 1. `GET /admin/users`
- Auth: `admin`
- Purpose: ดึงรายชื่อผู้ใช้ทั้งหมดสำหรับหน้า Admin User Management
- Request: ไม่มี body/query สำคัญ
- Response 200:
  - `[{ id, username, role, created_at }, ...]`

### 2. `POST /admin/users`
- Auth: `admin`
- Purpose: สร้าง user ใหม่จากฝั่ง admin
- Body:
  - `username: string`
  - `password: string`
  - `role: 'user' | 'staff'`
- Response 201:
  - `{ id, username, role }`
- Errors:
  - 400 validation fail
  - 409 username ซ้ำ

### 3. `PUT /admin/users/:id`
- Auth: `admin`
- Purpose: แก้ไข username/role ของ user
- Params:
  - `id: string` (user id)
- Body:
  - `username: string`
  - `role: 'user' | 'staff' | 'admin'`
- Response 200:
  - `{ id, username, role }`
- Errors:
  - 403 แก้ account ตัวเองไม่ได้
  - 403 account protected (`Nonbangkok`)
  - 404 user ไม่พบ
  - 409 username ซ้ำ

### 4. `DELETE /admin/users/:id`
- Auth: `admin`
- Purpose: ลบ user
- Params: `id`
- Response 200:
  - `{ message: 'User <id> deleted successfully' }`
- Errors:
  - 403 ลบ account ตัวเองไม่ได้
  - 403 account protected

### 5. `POST /admin/users/batch`
- Auth: `admin`
- Purpose: สร้าง user หลายคนแบบ batch
- Body:
  - `prefix: string`
  - `count: number`
- Response 201:
  - `{ message, users: [{ username, password }, ...] }`
- Error 409:
  - ชน username บางตัวในชุดที่กำลังสร้าง

### 6. `GET /admin/authors`
- Auth: `staff|admin`
- Purpose: ดึงรายชื่อ account ที่เป็น staff/admin เพื่อใช้เป็น author list
- Response 200:
  - `[{ id, username }, ...]`

### 7. `POST /admin/database/import`
- Auth: `admin`
- Purpose: import database dump
- Content-Type: `multipart/form-data`
- File field:
  - `databaseDump` (`.sql`, `.dump`, `.tar`)
- Response 200:
  - `{ message: 'Database imported successfully.' }`
- Errors:
  - 400 ไม่มีไฟล์
  - 400 extension ไม่รองรับ
  - 500 import ล้มเหลว

### 8. `POST /admin/database/export`
- Auth: `admin`
- Purpose: export database เป็นไฟล์ `.sql`
- Response 200:
  - file download (`application/sql`/binary stream)
- Errors:
  - 500 export ล้มเหลว

### 9. `GET /admin/settings/registration`
- Auth: `admin`
- Purpose: อ่านสถานะเปิด/ปิด registration
- Response 200:
  - `{ enabled: boolean }`

### 10. `PUT /admin/settings/registration`
- Auth: `admin`
- Purpose: เปิด/ปิด registration
- Body:
  - `{ enabled: boolean }`
- Response 200:
  - `{ message: 'Registration setting updated successfully.' }`

---

## 2) Auth Controller (5 APIs)

### 11. `POST /register`
- Auth: Public
- Purpose: สมัครสมาชิก
- Body:
  - `username: string`
  - `password: string`
- Response 201:
  - `{ message: 'User registered successfully', user: { id, username } }`
- Errors:
  - 400 validation fail
  - 400 username ซ้ำ
  - 403 registration ถูกปิด

### 12. `GET /settings/registration`
- Auth: Public
- Purpose: ให้ frontend เช็คว่าหน้า register ควรเปิดไหม
- Response 200:
  - `{ enabled: boolean }`

### 13. `POST /login`
- Auth: Public
- Purpose: login และสร้าง session
- Body:
  - `username: string`
  - `password: string`
- Response 200:
  - `{ message: 'Login successful', user: { id, username, role } }`
- Errors:
  - 400 validation fail
  - 401 user ไม่พบ/รหัสผ่านผิด

### 14. `POST /logout`
- Auth: ใช้ session ปัจจุบัน
- Purpose: destroy session
- Response 200:
  - `{ message: 'Logout successful' }`

### 15. `GET /me`
- Auth: Public
- Purpose: ตรวจสถานะ login ปัจจุบัน
- Response 200:
  - logged in: `{ isAuthenticated: true, user: {...} }`
  - not logged in: `{ isAuthenticated: false }`

---

## 3) Contest Controller (15 APIs)

### 16. `GET /contests`
- Auth: Public (มี session จะได้ข้อมูล `is_participant` ที่แม่นขึ้น)
- Purpose: list contest ทั้งหมด
- Response 200: contest list

### 17. `GET /admin/contests`
- Auth: `staff|admin`
- Purpose: list contests สำหรับ admin panel
- Response 200: contest list แบบ admin view

### 18. `GET /admin/contests/available-problems`
- Auth: `staff|admin`
- Purpose: list problems ที่พร้อมย้ายเข้า contest
- Response 200: problem list

### 19. `GET /contests/:id`
- Auth: Public
- Purpose: ดูรายละเอียด contest
- Params: `id` (contest id)
- Response 200: contest detail + problem metadata
- Error 404: contest ไม่พบ

### 20. `POST /contests/:id/join`
- Auth: required
- Purpose: join contest
- Params: `id`
- Response 200:
  - `{ message: 'Successfully joined contest' }`
- Errors:
  - 404 contest ไม่พบ
  - 400 contest หมดเวลาแล้ว
  - 400 joined ไปแล้ว

### 21. `GET /contests/:id/scoreboard`
- Auth: required
- Purpose: ดู scoreboard ของ contest
- Params: `id`
- Response 200:
  - `{ scoreboard: [...], problems: [...] }`
- Error 404

### 22. `POST /admin/contests`
- Auth: `staff|admin`
- Purpose: สร้าง contest ใหม่
- Body:
  - `title: string`
  - `description?: string`
  - `startTime: ISO string`
  - `endTime: ISO string`
- Response 201: contest row
- Errors:
  - 400 validation fail
  - 400 endTime ต้องมากกว่า startTime

### 23. `PUT /admin/contests/:id`
- Auth: `staff|admin`
- Purpose: แก้ไข contest
- Params: `id`
- Body: เหมือน create
- Response 200: updated contest
- Errors: 400/404

### 24. `DELETE /admin/contests/:id`
- Auth: `staff|admin`
- Purpose: ลบ contest
- Params: `id`
- Response 200: `{ message }`
- Errors:
  - 404 not found
  - 400 contest ที่กำลัง running ลบไม่ได้

### 25. `GET /admin/contests/:id/admin-problems`
- Auth: `staff|admin`
- Purpose: ดูปัญหาที่อยู่ใน contest
- Params: `id`
- Response 200: problem list

### 26. `POST /admin/contests/:id/problems`
- Auth: `staff|admin`
- Purpose: ย้ายหลายโจทย์เข้า contest หรือย้ายกลับ main
- Params: `id`
- Body:
  - `problemIds: string[]`
  - `action: 'move_to_contest' | 'move_to_main'`
- Response 200: migration result

### 27. `DELETE /admin/contests/:id/problems/:problemId`
- Auth: `staff|admin`
- Purpose: ย้ายโจทย์เดี่ยวกลับระบบหลัก
- Params:
  - `id` (contest)
  - `problemId`
- Response 200:
  - `{ message, problem }`
- Errors: 400/404

### 28. `GET /contests/:id/problems`
- Auth: required
- Purpose: list problems สำหรับ participant
- Params: `id`
- Response 200:
  - list problems
  - หรือ `[]` ถ้า contest ยังไม่ active
- Errors: 403/404

### 29. `GET /contests/:id/problems/:problemId`
- Auth: required
- Purpose: problem detail ใน contest
- Params: `id`, `problemId`
- Response 200: problem detail
- Errors: 403/404

### 30. `GET /contests/:id/problems/:problemId/pdf`
- Auth: required
- Purpose: โหลด PDF ของโจทย์ใน contest
- Response 200: `application/pdf`
- Errors: 403/404

---

## 4) Problem Controller (14 APIs)

### 31. `GET /problems-with-stats`
- Auth: required
- Purpose: list ปัญหาพร้อมสถิติของ user ปัจจุบัน
- Response 200: list with stats

### 32. `GET /problems`
- Auth: Public
- Purpose: list ปัญหาที่เปิดเผย (non-contest)
- Response 200: `[{ id, title, author }]`

### 33. `GET /problems/:id`
- Auth: Public
- Purpose: problem detail
- Response 200:
  - regular user จะไม่เห็น `is_visible`
  - staff/admin เห็นข้อมูลเต็ม
- Errors:
  - 404 not found
  - 403 hidden problem

### 34. `GET /admin/problems/:id`
- Auth: `staff|admin`
- Purpose: admin detail view ของ problem
- Response 200: full detail
- Error 404

### 35. `GET /problems/:id/pdf`
- Auth: required
- Purpose: โหลด PDF ของโจทย์
- Response 200: `application/pdf`
- Error 404

### 36. `POST /admin/problems`
- Auth: `staff|admin`
- Purpose: สร้างโจทย์ใหม่
- Body:
  - `id, title, author, time_limit_ms, memory_limit_mb`
- Response 201: created row

### 37. `PUT /admin/problems/:id`
- Auth: `staff|admin`
- Purpose: แก้โจทย์ (รวม rename id)
- Params: `id` เดิม
- Body: shape เดียวกับ create (field `id` คือใหม่)
- Response 200: updated row
- Errors: 404/409

### 38. `DELETE /admin/problems/:id`
- Auth: `staff|admin`
- Purpose: ลบโจทย์พร้อมข้อมูลเกี่ยวข้อง
- Response 200: `{ message }`
- Error 404

### 39. `GET /admin/problems`
- Auth: `staff|admin`
- Purpose: list problems สำหรับ admin table
- Response 200: list with visibility/contest status

### 40. `PUT /admin/problems/:id/visibility`
- Auth: `staff|admin`
- Purpose: toggle visibility
- Body: `{ isVisible: boolean }`
- Response 200:
  - `{ message, problem: { id, title, is_visible } }`
- Error 404

### 41. `POST /admin/problems/batch-upload`
- Auth: `staff|admin`
- Purpose: เริ่ม batch upload โจทย์จาก zip
- Multipart:
  - `problemsZip`
- Response 202:
  - `{ message, progressId }`

### 42. `GET /admin/problems/batch-upload-progress/:progressId`
- Auth: `staff|admin`
- Purpose: subscribe progress ของ batch upload
- Response: `text/event-stream`
- Events: `initial`, `progress`, `complete`, `error`

### 43. `POST /admin/problems/:id/upload`
- Auth: `staff|admin`
- Purpose: upload PDF หรือ testcase zip ให้โจทย์เดียว
- Multipart fields:
  - `problemPdf` (optional)
  - `testcasesZip` (optional)
  - ต้องมีอย่างน้อย 1 field
- Response 200: `{ message: 'Files processed successfully.' }`
- Errors: 400/500

### 44. `POST /admin/problems/export`
- Auth: `staff|admin`
- Purpose: export หลายโจทย์เป็น zip
- Body:
  - `{ problemIds: string[] }`
- Response 200: ZIP binary
- Error 400: ไม่มี problemIds

---

## 5) Submission Controller (6 APIs)

### 45. `POST /submit`
- Auth: required
- Purpose: ส่งโค้ดทั้ง global และ contest mode
- Body:
  - `problemId: string`
  - `language: string` (ตอนนี้รองรับ `cpp`)
  - `code: string`
  - `contestId?: string`
- Response 202:
  - `{ message, submissionId, isContestSubmission }`
- Errors:
  - 400 language/problem invalid
  - 403 ไม่ได้ join contest
  - 404 contest not found

### 46. `GET /submissions`
- Auth: required
- Purpose: list submissions
- Query (optional):
  - `filter`, `problemId`, `contestId`, `filterProblemId`, `filterUserId`
- Response 200: submissions list

### 47. `GET /search/problems`
- Auth: required
- Purpose: autocomplete/search problems
- Query:
  - `q?: string`
  - `contestId?: string`
- Response 200:
  - ถ้า `q` ว่าง => `[]`
  - ไม่ว่าง => `[{ id, title }]`

### 48. `GET /search/users`
- Auth: required
- Purpose: autocomplete/search users
- Query:
  - `q?: string`
  - `contestId?: string`
- Response 200:
  - ถ้า `q` ว่าง => `[]`
  - ไม่ว่าง => `[{ username }]`

### 49. `GET /submissions/:id`
- Auth: required
- Purpose: ดูรายละเอียด submission เดี่ยว
- Params: `id`
- Query optional:
  - `contestId` (กรณีดู contest submission)
- Response 200: submission detail
- Errors:
  - 404 not found
  - 403 ไม่มีสิทธิ์ดู

### 50. `GET /scoreboard`
- Auth: required
- Purpose: global scoreboard รวมคะแนนทุกโจทย์
- Response 200: scoreboard rows

---

## Frontend Implementation Notes (สำคัญ)

- ใช้ axios instance แบบ `withCredentials: true` ทุก request ที่ต้องใช้ session
- Endpoints ที่เป็นไฟล์ต้องตั้ง `responseType: 'blob'`
  - `/problems/:id/pdf`
  - `/contests/:id/problems/:problemId/pdf`
  - `/admin/problems/export`
  - `/admin/database/export`
- SSE endpoint:
  - `/admin/problems/batch-upload-progress/:progressId`
  - ใช้ `EventSource` แล้ว parse payload ตาม event name
- Validation error shape มี 2 แบบหลัก ต้องรองรับทั้งคู่
  - `{ errors: [...] }`
  - `{ message: 'Validation failed', errors: [...] }`
- หลีกเลี่ยง hardcode authorization ฝั่ง frontend ให้ยึด response จาก backend เป็นหลัก
