# API Schema — WOI Grader Backend (116 APIs)

เอกสารนี้สรุป API ของ backend ตาม controller ทั้งหมด **ครบ 116 APIs** ตามรายการด้านล่าง
- `adminController.ts` = 18 APIs
- `analyticsController.ts` = 9 APIs
- `authController.ts` = 7 APIs
- `contestController.ts` = 17 APIs
- `healthController.ts` = 2 APIs
- `problemController.ts` = 21 APIs
- `realtimeController.ts` = 2 APIs
- `submissionController.ts` = 6 APIs
- `userProfileController.ts` = 3 APIs
- `authorProfileController.ts` = 4 APIs
- Problem authoring draft/job/testcase/workspace controllers = 27 APIs

รวมทั้งหมด: **116 APIs**

## Global Conventions

- Base routing ใน backend เป็น root (`/`) และใน production ผ่าน nginx proxy ด้วย prefix `/api` จาก frontend (nginx strip `/api` ก่อน forward)
- Authentication เป็น session-cookie (`connect.sid`) ต้องส่ง `withCredentials: true` จาก frontend
- Session ถูก revalidate ทุก request (`revalidateSessionUser`): role/username/existence sync จากตาราง `users` ทุกครั้ง — controller อ่าน identity จาก `req.user` เท่านั้น
- Role ที่ใช้ในระบบ: `user`, `staff`, `admin`
- Middleware หลัก:
  - `requireAuth`: ต้อง login
  - `requireStaffOrAdmin`: ต้องเป็น staff/admin
  - `requireAdmin`: ต้องเป็น admin
  - `requirePublicAccess`: ผ่านเสมอใน PUBLIC mode; ใน PRIVATE mode ต้อง login (guest ได้ 401)
  - `validateRequest`: ตรวจสอบ `body/params/query` ด้วย `z.object` จาก shared schema กลาง (`backend/schemas/requestSchemas.ts`)
- Rate limiting (ทุก limiter key บน proxy-vouched IP — nginx เขียนทับ X-Real-IP/XFF ด้วย `$remote_addr` เสมอ):
  - General: 1000 requests / 15 นาที (ยกเว้น path ที่ prefix ด้วย `/admin/authoring/`, `/admin/author-profiles`, `/realtime/`)
  - Auth (`/login`, `/register`): 10 / 15 นาที + per-account lockout (10 ครั้งผิดพร่อง / 15 นาที → lock 15 นาที, ตอบ 429)
  - Submit: 30 / นาที (key ด้วย user id ถ้า login)
  - ตอบ 429 พร้อม standard rate-limit headers
- Maintenance mode: ระหว่าง database import ทุก request อื่นตอบ 503 (ยกเว้น health checks และ import-progress ที่ auth ด้วย token)
- รูปแบบ error ที่พบได้:
  - `{ message: string }`
  - `{ message: string, errors: [...] }` (validation)
  - `{ message: string, error: string }` (import/export บางกรณี)
  - `{ code: string, message: string }` (authoring บางกรณี)

---

## 1) Admin Controller (18 APIs)

### 1. `GET /admin/users`
- Auth: `admin`
- Purpose: รายชื่อผู้ใช้แบบ paginate (ADMIN-008)
- Query (optional):
  - `page: number` (default 1)
  - `limit: number` (default 100, max 500)
- Response 200:
  - `{ users: [{ id, username, role, created_at }, ...], total, page, limit }`

### 2. `POST /admin/users`
- Auth: `admin`
- Purpose: สร้าง user ใหม่จากฝั่ง admin (รวม role `admin` ได้)
- Body:
  - `username: string`
  - `password: string` (อย่างน้อย 8 ตัวอักษร)
  - `role: 'user' | 'staff' | 'admin'`
- Response 201:
  - `{ id, username, role }`
- Errors:
  - 400 validation fail
  - 409 username ซ้ำ (case-insensitive)

### 3. `PUT /admin/users/:id`
- Auth: `admin`
- Purpose: แก้ไข username/role ของ user (transactional)
- Params:
  - `id` (user id, ต้องเป็นตัวเลข — ไม่ใช่ตอบ 500)
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

### 4. `PUT /admin/users/:id/password`
- Auth: `admin`
- Purpose: admin reset รหัสผ่านของ user (AUTH-004) — kill session ทั้งหมดของ user คนนั้น (ต้อง login ใหม่)
- Body:
  - `newPassword: string` (อย่างน้อย 8 ตัวอักษร)
- Response 200:
  - `{ message }`
- Errors:
  - 403 account protected
  - 404 user ไม่พบ

### 5. `DELETE /admin/users/:id`
- Auth: `admin`
- Purpose: ลบ user — transactional และลบ `user_sessions` ของ user ด้วย
- Params: `id`
- Response 200:
  - `{ message: 'User <id> deleted successfully' }`
- Errors:
  - 403 ลบ account ตัวเองไม่ได้ / account protected
  - 404 user ไม่พบ (ADMIN-007)

### 6. `POST /admin/users/batch`
- Auth: `admin`
- Purpose: สร้าง user หลายคนแบบ batch
- Body:
  - `prefix: string`
  - `count: number`
- Response 201:
  - `{ message, users: [{ username, password }, ...] }`
- Error 409:
  - ชน username บางตัวในชุดที่กำลังสร้าง (เช็คแบบ case-insensitive)

### 7. `GET /admin/authors`
- Auth: `staff|admin`
- Purpose: ดึงรายชื่อ account ที่เป็น staff/admin เพื่อใช้เป็น author list
- Response 200:
  - `[{ id, username }, ...]`

### 8. `POST /admin/database/import`
- Auth: `admin`
- Purpose: import database dump — เริ่ม job แบบ async
- Content-Type: `multipart/form-data`
- File field:
  - `databaseDump` (`.sql`, `.dump`, `.tar`)
- Response 202:
  - `{ message, jobId, token }` — ใช้ token ตรวจ progress
- Errors:
  - 400 ไม่มีไฟล์ / extension ไม่รองรับ
  - 409 มี import กำลังรันอยู่ (single-flight)
- ระหว่าง import: maintenance mode active — request อื่นตอบ 503, scheduler หยุด tick
- Import ใช้ `DROP SCHEMA public CASCADE` (ครบทุกตาราง)

### 9. `GET /admin/database/import-progress/:jobId`
- Auth: header `x-import-token` ที่ได้จาก endpoint 8 (session ใช้ไม่ได้ระหว่าง import เพราะ session table ถูก drop)
- Response 200: progress object
- Errors: 401 token ผิด, 404 job ไม่พบ

### 10. `POST /admin/database/export`
- Auth: `admin`
- Purpose: export database เป็นไฟล์ `.sql` (exclude `user_sessions`)
- Response 200: file download (`application/sql`/binary stream)
- Errors: 500 export ล้มเหลว

### 11. `GET /admin/settings/registration`
- Auth: `admin`
- Response 200: `{ enabled: boolean }`

### 12. `PUT /admin/settings/registration`
- Auth: `admin`
- Body: `{ enabled: boolean }`
- Response 200: `{ message: 'Registration setting updated successfully.' }`

### 13. `GET /admin/settings/site-access`
- Auth: `admin`
- Response 200: `{ accessMode: 'public' | 'private' }`

### 14. `PUT /admin/settings/site-access`
- Auth: `admin`
- Body: `{ accessMode: 'public' | 'private' }`
- Response 200: `{ message }`
- ผล: PRIVATE mode ทำให้ guest เข้าถึง content ไม่ได้ (401 จาก `requirePublicAccess`)

### 15. `GET /admin/settings/password-change`
- Auth: `admin`
- Response 200: `{ enabled: boolean }`

### 16. `PUT /admin/settings/password-change`
- Auth: `admin`
- Body: `{ enabled: boolean }`
- Response 200: `{ message }`
- ผล: ปิดไว้ user/staff เปลี่ยนรหัสผ่านเองไม่ได้ (403), admin ยังเปลี่ยนเองได้ และ admin reset (endpoint 4) ไม่กระทบ

### 17. `POST /admin/rejudge/problem/:problemId`
- Auth: `admin`
- Purpose: rejudge ทุก submission ของโจทย์ (ผ่าน judge queue ปกติ)
- Response 200: `{ queued, skipped, busy? }`
- Errors: 404 โจทย์ไม่พบ; 409 rejudge เดิมยังรันอยู่

### 18. `POST /admin/rejudge/contest/:contestId`
- Auth: `admin`
- Purpose: rejudge ทุก submission ของ contest
- Response 200: `{ queued, skipped, busy? }`
- Errors:
  - 404 contest ไม่พบ
  - 409 rejudge ซ้ำ / contest จบแล้ว (scoreboard ถูก freeze — ให้ rejudge รายโจทย์แทน)

หมายเหตุ rejudge: `queued` = จำนวนที่รับไป rejudge, `skipped` = แถวที่ไม่ judgeable, `busy` = แถวที่มี judge กำลังรันอยู่ (JUDGE-004 — ไม่ reset เพื่อกันสอง judge ชนกันในแถวเดียว)

---

## 2) Auth Controller (7 APIs)

### 19. `POST /register`
- Auth: Public (rate-limited)
- Body:
  - `username: string` (3–50 ตัวอักษร)
  - `password: string` (อย่างน้อย 8 ตัวอักษร)
- Response 201: `{ message, user: { id, username } }`
- Errors:
  - 400 validation fail
  - 400 username ซ้ำ (เช็ค case-insensitive — unique index บน `LOWER(username)`)
  - 403 registration ถูกปิด

### 20. `GET /settings/registration`
- Auth: Public
- Response 200: `{ enabled: boolean }`

### 21. `GET /site-config`
- Auth: Public
- Purpose: config ที่ frontend ต้องรู้ก่อน render (PUBLIC/PRIVATE mode, registration, password change)
- Response 200:
  - `{ accessMode: 'public' | 'private', allowRegistration: boolean, passwordChangeEnabled: boolean }`

### 22. `POST /login`
- Auth: Public (rate-limited + per-account lockout)
- Body:
  - `username: string`
  - `password: string`
- Response 200:
  - `{ message, user: { id, username, role, hasAvatar, tier?, level? } }` — tier/level แนบมาเพื่อ navbar
- Errors:
  - 400 validation fail
  - 401 invalid username or password (ข้อความเดียวกันทั้ง unknown user และ wrong password)
  - 429 account lockout (พยายาม login ผิดเกิน 10 ครั้งใน 15 นาที)
- Login สำเร็จ: session regenerate (กัน session fixation)

### 23. `POST /logout`
- Purpose: destroy session
- Response 200: `{ message: 'Logout successful' }`

### 24. `PUT /profile/password`
- Auth: required
- Purpose: เปลี่ยนรหัสผ่านตัวเอง (AUTH-004) — verify รหัสปัจจุบัน, คง session ปัจจุบันไว้, kill session อื่นทั้งหมด
- Body:
  - `currentPassword: string`
  - `newPassword: string` (อย่างน้อย 8 ตัวอักษร)
- Response 200: `{ message }`
- Errors:
  - 401 current password ผิด (frontend แสดง inline — ไม่ redirect ไปหน้า login)
  - 403 ตอน setting `password_change_enabled` ปิดอยู่ (ยกเว้น admin)
  - 404 account ไม่พบ
- UI entry point เดียว: เมนู user ใน navbar

### 25. `GET /me`
- Auth: Public
- Response 200:
  - logged in: `{ isAuthenticated: true, user: { id, username, role, hasAvatar, tier?, level? } }`
  - not logged in: `{ isAuthenticated: false }`

---

## 3) Contest Controller (17 APIs)

### 26. `GET /contests`
- Auth: `requirePublicAccess` (PUBLIC mode guest ดูได้)
- Purpose: list contest ที่มองเห็น (hidden contest ถูกกรองออกสำหรับ non-staff)
- Response 200: contest list

### 27. `GET /admin/contests`
- Auth: `staff|admin`
- Purpose: list contests สำหรับ admin panel — รวม hidden contests (มี flag `is_visible`)
- Response 200: contest list แบบ admin view

### 28. `GET /admin/contests/available-problems`
- Auth: `staff|admin`
- Purpose: list problems ที่พร้อมย้ายเข้า contest
- Response 200: problem list

### 29. `GET /contests/:id`
- Auth: `requirePublicAccess`
- Purpose: ดูรายละเอียด contest
- Params: `id`
- Response 200: contest detail + problem metadata
- Errors: 404 contest ไม่พบ **หรือ hidden สำหรับ non-staff** (hidden = nonexistent, ไม่มี oracle)

### 30. `POST /contests/:id/join`
- Auth: required
- Params: `id`
- Response 200: `{ message: 'Successfully joined contest' }`
- Errors:
  - 404 contest ไม่พบ/hidden
  - 400 contest หมดเวลาแล้ว / joined ไปแล้ว

### 31. `GET /contests/:id/scoreboard`
- Auth: `requirePublicAccess` (PUBLIC mode guest อ่านได้)
- Params: `id`
- Purpose: scoreboard ตาม status — finished: snapshot จาก `contest_scoreboards` (รวมผู้เข้าแข่งขันที่ submit เป็นศูนย์ครั้ง พร้อม `detailed_scores` รูปเดียวกับ live), running/finishing: aggregate สด, อื่น ๆ: คะแนนศูนย์ทั้งหมด
- Response 200: `{ scoreboard: [...], problems: [...] }`
- Errors: 404 ไม่พบ/hidden (สำหรับ non-staff)

### 32. `POST /admin/contests`
- Auth: `staff|admin`
- Body:
  - `title: string`
  - `description?: string`
  - `startTime: ISO string`
  - `endTime: ISO string`
- Response 201: contest row
- Errors:
  - 400 validation fail / endTime ต้องมากกว่า startTime

### 33. `PUT /admin/contests/:id`
- Auth: `staff|admin`
- Body: เหมือน create
- Response 200: updated contest
- Errors: 400/404

### 34. `PUT /admin/contests/:id/visibility`
- Auth: `staff|admin`
- Purpose: toggle `is_visible` ของ contest (migration 0020) — publishing gate แยกอิสระจาก status
- Body: `{ isVisible: boolean }`
- Response 200: `{ message, contest }`
- Error: 404

### 35. `DELETE /admin/contests/:id`
- Auth: `staff|admin`
- Response 200: `{ message }`
- Errors:
  - 404 not found
  - 400 contest ที่กำลัง running ลบไม่ได้

### 36. `GET /admin/contests/:id/admin-problems`
- Auth: `staff|admin`
- Purpose: ดูปัญหาที่อยู่ใน contest
- Response 200: problem list

### 37. `POST /admin/contests/:id/problems`
- Auth: `staff|admin`
- Purpose: ย้ายหลายโจทย์เข้า contest หรือย้ายกลับ main (tri-state select-all ใน frontend)
- Body:
  - `problemIds: string[]`
  - `action: 'move_to_contest' | 'move_to_main'`
- Response 200: migration result
- ย้ายเข้า contest: snapshot `is_visible_before_contest` — ทุก exit path (bulk/single move-back, contest delete, post-contest migration) คืนค่าเดิม

### 38. `DELETE /admin/contests/:id/problems/:problemId`
- Auth: `staff|admin`
- Purpose: ย้ายโจทย์เดี่ยวกลับระบบหลัก
- Response 200: `{ message, problem }`
- Errors: 400/404

### 39. `GET /contests/:id/problems`
- Auth: required
- Purpose: list problems สำหรับ participant (ต้องเป็น participant; hidden contest = 404)
- Response 200: list problems หรือ `[]` ถ้า contest ยังไม่ active
- Errors: 403 ไม่ได้ join, 404 ไม่พบ/hidden

### 40. `GET /contests/:id/problems/:problemId`
- Auth: required
- Purpose: problem detail ใน contest (participant เท่านั้น)
- Response 200: problem detail
- Errors: 403/404

### 41. `GET /contests/:id/problems/:problemId/pdf`
- Auth: required
- Purpose: โหลด PDF ของโจทย์ใน contest (participant เท่านั้น)
- Response 200: `application/pdf`
- Errors: 403/404

### 42. `GET /admin/contests/:id/similarity`
- Auth: `staff|admin`
- Purpose: contest cheat detection — คู่ user ต่างคนที่ submission ล่าสุดของโจทย์เดียวกันคล้ายกันหลัง normalize
- Query (optional): `threshold` (0, 1] — default 0.6
- Response 200: `{ contestId, pairs: [...] }`

---

## 4) Problem Controller (21 APIs)

### 43. `GET /problems-with-stats`
- Auth: `requirePublicAccess` (PUBLIC mode guest เห็น list แต่ไม่มี personal stats)
- Purpose: list ปัญหาพร้อมสถิติของ user ปัจจุบัน — **keyset cursor pagination** + server-side filters
- Query (optional):
  - `difficultyMin`, `difficultyMax: number`
  - `sort: 'difficulty'`, `order: 'asc' | 'desc'`
  - `search: string` (ILIKE บน id/title, escape wildcard)
  - `category: string` (ชื่อ category หรือ `'Uncategorized'`)
  - `limit: number` (default 20, max 100)
  - `cursor: string` (opaque token จากหน้าก่อน)
- Response 200:
  - `{ problems: [...], nextCursor: string | null, hasMore: boolean }`
- ลำดับ default: by id; sort by difficulty ใช้ id เป็น tiebreaker

### 44. `GET /problems/categories`
- Auth: `requirePublicAccess`
- Purpose: จำนวนโจทย์ต่อ category (global counts สำหรับ tab) — visible standalone เท่านั้น
- Response 200: `{ categories: [{ name, count }], total, uncategorized }`

### 45. `GET /problems`
- Auth: `requirePublicAccess`
- Purpose: list ปัญหาที่เปิดเผย (non-contest)
- Response 200: `[{ id, title, author }]`

### 46. `GET /problems/:id`
- Auth: `requirePublicAccess`
- Purpose: problem detail
- Response 200:
  - regular user จะไม่เห็น `is_visible`
  - staff/admin เห็นข้อมูลเต็ม
- Errors:
  - 404 not found **หรือ hidden สำหรับ non-staff** (PROBLEM-002: hidden = nonexistent, ไม่มี title oracle)

### 47. `GET /admin/problems/:id`
- Auth: `staff|admin`
- Purpose: admin detail view ของ problem
- Response 200: full detail
- Error 404

### 48. `GET /problems/:id/pdf`
- Auth: `requirePublicAccess`
- Purpose: โหลด PDF ของโจทย์
- Response 200: `application/pdf` (+ `X-Content-Type-Options: nosniff`)
- Error 404 — รวม hidden และ contest problem สำหรับ non-staff

### 49. `POST /admin/problems`
- Auth: `staff|admin`
- Purpose: สร้างโจทย์ใหม่
- Body:
  - `id, title, author, time_limit_ms, memory_limit_mb`
  - `categories?: string[]`, `difficulty?: number`, `collection_id?: number`
- Response 201: created row
- Error 409: id ซ้ำ

### 50. `PUT /admin/problems/:id`
- Auth: `staff|admin`
- Purpose: แก้โจทย์ (รวม rename id — rename cascade ไป `user_problem_rewards`/`authoring_published_problems`/`problem_drafts`)
- Body: shape เดียวกับ create (field `id` คือใหม่)
- Response 200: updated row
- Errors: 404/409

### 51. `DELETE /admin/problems/:id`
- Auth: `staff|admin`
- Response 200: `{ message }`
- Error 404

### 52. `GET /admin/problems`
- Auth: `staff|admin`
- Purpose: list problems สำหรับ admin table
- Response 200: list with visibility/contest status/collection/categories/difficulty

### 53. `PUT /admin/problems/:id/visibility`
- Auth: `staff|admin`
- Body: `{ isVisible: boolean }`
- Response 200: `{ message, problem: { id, title, is_visible } }`
- Error 404

### 54. `GET /admin/problems/:id/testcases`
- Auth: `staff|admin`
- Purpose: testcase viewer ของโจทย์ (JUDGE-011: content เป็น staff-only)
- Query: ไม่มี = metadata list (case numbers + byte sizes คำนวณใน SQL)
  - `?caseNumber=N` = เนื้อหา testcase เดี่ยว (truncate ที่ 1 MiB ต่อฝั่ง, response มี `truncated: true` + true sizes)
- Response 200: `{ testcases: [...], total }` หรือ testcase เดี่ยว
- Errors: 404 problem/testcase ไม่พบ

### 55. `GET /admin/collections`
- Auth: `staff|admin`
- Purpose: list collections (กลุ่มจัดระเบียบ เช่น บทเรียน)
- Response 200: collection list

### 56. `POST /admin/collections`
- Auth: `staff|admin`
- Body: `{ name: string }`
- Response 201: collection
- Error 409 ชื่อซ้ำ

### 57. `PUT /admin/collections/:id`
- Auth: `staff|admin`
- Body: `{ name }`
- Response 200: collection
- Errors: 404/409

### 58. `DELETE /admin/collections/:id`
- Auth: `staff|admin`
- Response 200: `{ message }` — โจทย์ใน collection ถูก detach (ไป No Collection) ไม่ถูกลบ
- Error 404

### 59. `PUT /admin/collections/:id/visibility`
- Auth: `staff|admin`
- Purpose: toggle visibility ทั้ง collection — เขียน `is_visible` ของโจทย์ทุกตัวใน collection ใน transaction เดียว
- Body: `{ isVisible: boolean }`
- Response 200: `{ message, updated }`
- Error 404

### 60. `POST /admin/problems/batch-upload`
- Auth: `staff|admin`
- Multipart: `problemsZip`
- Response 202: `{ message, progressId }`

### 61. `GET /admin/problems/batch-upload-progress/:progressId`
- Auth: `staff|admin`
- Purpose: subscribe progress ของ batch upload
- Response: `text/event-stream` — Events: `initial`, `progress`, `complete`, `error`

### 62. `POST /admin/problems/:id/upload`
- Auth: `staff|admin`
- Purpose: upload PDF หรือ testcase zip ให้โจทย์เดียว
- Multipart fields:
  - `problemPdf` (optional — ต้องขึ้นต้นด้วย `%PDF`)
  - `testcasesZip` (optional)
- Response 200: `{ message: 'Files processed successfully.' }`
- Errors: 400 (ไม่มีไฟล์/ไม่ใช่ PDF/ไม่มี valid pairs), 404 problem ไม่พบ

### 63. `POST /admin/problems/export`
- Auth: `staff|admin`
- Body: `{ problemIds: string[] }`
- Response 200: ZIP binary
- Error 400: ไม่มี problemIds

---

## 5) Submission Controller (6 APIs)

### 64. `POST /submit`
- Auth: required (rate-limited 30/min)
- Purpose: ส่งโค้ดทั้ง global และ contest mode — ผ่าน judge queue (max 3 concurrent)
- Body:
  - `problemId: string`
  - `language: 'cpp' | 'python'` (Python ได้ time ×4 / memory ×2)
  - `code: string` (max 64 KiB)
  - `contestId?: string`
- Response 202: `{ message, submissionId, isContestSubmission }`
- Errors:
  - 400 language/problem invalid / โจทย์ไม่มี testcase เลย (DB-06)
  - 403 ไม่ได้ join contest
  - 404 contest not found
- Contest submission: ตรวจ wall-clock `start_time`/`end_time` ตรง ๆ (ไม่พึ่ง scheduler status เพียงอย่างเดียว)

### 65. `GET /submissions`
- Auth: `requirePublicAccess` (PUBLIC mode guest อ่าน feed สาธารณะได้ — DTO ไม่มี source code)
- Query (optional):
  - `filter`, `problemId`, `contestId`, `filterProblemId`, `filterUserId`
  - `page: number` (default 1, max 500; หน้าละ 200 แถว — SUB-004)
- Response 200: submissions list
- การ gate: feed สาธารณะไม่รวมโจทย์ hidden/contest สำหรับ non-staff; feed ต่อ contest (`?contestId=`) ต้องเป็น participant/staff และ contest ต้อง visible

### 66. `GET /search/problems`
- Auth: required
- Query:
  - `q?: string`
  - `contestId?: string`
- Response 200: `[]` ถ้า `q` ว่าง, ไม่ว่าง => `[{ id, title }]`
- ผลลัพธ์ visibility-filtered ตาม role ของ caller (PROBLEM-001) — สาขา contest ต้องเป็น participant

### 67. `GET /search/users`
- Auth: required
- Query: เหมือน search/problems
- Response 200: `[]` หรือ `[{ username }]`

### 68. `GET /submissions/:id`
- Auth: required (guest ไม่ได้รับสิทธิ์นี้แม้ใน PUBLIC mode)
- Query optional: `contestId`
- Response 200: submission detail
- Errors:
  - 404 not found (id ต้องเป็นตัวเลข — ไม่ใช่ตอบ 500)
  - 403 ไม่มีสิทธิ์ดู

### 69. `GET /scoreboard`
- Auth: `requirePublicAccess` (PUBLIC mode guest อ่านได้)
- Purpose: global scoreboard — tie-aware competition ranking ทำที่ frontend
- Response 200: scoreboard rows

---

## 6) Health Controller (2 APIs)

### 70. `GET /health/live`
- Auth: Public (mount ก่อน session/maintenance middleware)
- Purpose: process liveness
- Response 200

### 71. `GET /health/ready`
- Auth: Public
- Purpose: DB + schema readiness
- Response 200 / 503

---

## 7) Realtime Controller (2 APIs) — SSE

### 72. `GET /realtime/submissions`
- Auth: required
- Purpose: SSE stream ของ `submission_update` events สำหรับ submission ของ user คนเองเท่านั้น (filter `user_id` ฝั่ง server) — รวม `xp_awarded` ตอน first solve
- Response: `text/event-stream` (heartbeat ทุก 30 วินาที)

### 73. `GET /realtime/contests/:id`
- Auth: required
- Purpose: SSE stream ของ `scoreboard_update` pings สำหรับ contest เดียว (ping ไม่มี data — client refetch)
- Hidden contest สำหรับ non-staff: ไม่มี stream (404)
- Response: `text/event-stream`

---

## 8) User Profile Controller (3 APIs)

### 74. `GET /users/:username/profile`
- Auth: Public
- Purpose: โปรไฟล์สาธารณะ — stats, streaks, achievements, category radar, progression (XP/level/tier/global rank), recent XP rewards
- Semantics (PROFILE-PROBLEM-SCOPE): ทุก stat บน profile คิดจาก **โจทย์ที่ visible อยู่ตอนนี้** (`problems.is_visible = true`) เท่านั้น — solved/attempted/total score/submissions/verdicts/languages/activity heatmap/streak days/achievements/category radar และ `recentRewards` (Recently Solved) ทั้งหมดกรองด้วย scope เดียวกัน **สำหรับทุก viewer รวมถึง admin** (profile semantics ต้อง stable ไม่ขึ้นกับ role ของคนดู) — ซ่อนโจทย์ = ตัวเลข/รายการลดลงทันที, แสดงกลับ = กลับมาเอง (filter เป็น pure query predicate ไม่ mutate ประวัติใด ๆ) / radar ใช้ numerator (solved) กับ denominator (total) universe เดียวกันคือ visible standalone problems (`is_visible = true AND contest_id IS NULL` — โจทย์ที่ถูก assign เข้า contest จะถูก contest migration ซ่อนและกลับมาหลังจบ contest) / โจทย์ที่ถูกลบแล้ว (ไม่มีแถวใน `problems`) ยังแสดงใน `recentRewards` ด้วย title เป็น null / **ข้อยกเว้นเดียว: XP / Level / Tier / Global Rank** คิดจาก `user_problem_rewards` ซึ่งเป็น historical reward ledger — ไม่กรองด้วย is_visible เป็นอันขาด ดังนั้น profile อาจแสดง "Solved: 5" คู่กับ "XP: 1,200" ที่รวม reward ของ solve ที่ถูกซ่อน
- Response 200: profile object
- Error 404: user ไม่พบ

### 75. `GET /users/:username/avatar`
- Auth: Public
- Response 200: `image/png` (cache 300 วินาที) / 404

### 76. `PUT /profile/avatar`
- Auth: required
- Multipart: `avatar` (JPEG/PNG/WebP, max 10 MiB — normalize เป็น 256×256 PNG)
- Response 200: `{ message, avatarUpdatedAt }`

---

## 9) Analytics Controller (9 APIs)

ทั้งหมด Auth: `staff|admin` (Admin Analysis tab)

### 77. `GET /analytics/overview`
- Query: `days?: number` (default 30)
- Response 200: KPIs + ซีรีส์รายวัน/รายชั่วโมง (bucket ตาม `ANALYTICS_TIMEZONE` = Asia/Bangkok)

### 78. `GET /analytics/users`
- Query: `search`, `limit`, `offset`, `sortBy`, `sortDir`
- Response 200: `{ users }` — top-lists คำนวณตาม time window

### 79. `GET /analytics/problems`
- Query: เหมือน users
- Response 200: `{ problems }`

### 80. `GET /analytics/users/:userId`
- Response 200: per-user analytics / 404

### 81. `GET /analytics/submissions`
- Query: `problemId?`, `userId?`, `verdict?`, `limit`, `offset`
- Response 200: `{ submissions }`

### 82. `GET /analytics/contests/:contestId`
- Response 200: per-contest analytics / 404

### 83. `GET /analytics/problems/:problemId`
- Response 200: per-problem analytics / 404

### 84. `GET /analytics/retention`
- Query: `idleDays?`
- Response 200: retention analytics

### 85. `GET /analytics/export`
- Query: `type: 'users' | 'problems' | 'submissions'` + filters เดียวกับ tab นั้น
- Response 200: CSV download (มี formula-injection guard — ANALYSIS-006; จำกัด EXPORT_MAX_ROWS)

---

## 10) Author Profile & Problem Authoring Controllers (31 APIs)

All endpoints in this section require an authenticated **staff or admin** (`requireStaffOrAdmin`).

### 86. `POST /admin/author-profiles`

- Purpose: Create a reusable author identity, optionally linked to one OJ account.
- Accepts JSON metadata, or multipart form data when uploading an image.
- Metadata:
  - `userId: number | null` (optional, defaults to `null`)
  - `akaName: string`
  - `realName: string`
  - `defaultLanguage: string`
  - `countryCode: string` (three uppercase letters)
- Optional multipart file: `profileImage` (JPEG/PNG/WebP, maximum 10 MiB).
- The backend verifies decoded format and stores only a normalized 512×512 PNG.
- Response 201: camel-case profile metadata with `hasProfileImage`; image bytes are omitted.
- Errors: 400 validation/image error, 409 account already linked, 413 image too large.

### 87. `GET /admin/author-profiles`

- Purpose: List author profile metadata ordered by AKA name.
- Response 200: camel-case rows including `hasProfileImage`; image BYTEA is never loaded into this list query.

### 88. `GET /admin/author-profiles/:id/image`

- Purpose: One profile's stored normalized PNG bytes.
- Response 200: `image/png` with private/no-store headers.
- Errors: 404 missing profile/image.

### 89. `PATCH /admin/author-profiles/:id`

- Purpose: Update profile metadata, replace its image, or remove its image.
- Params: UUID `id`.
- Accepts JSON or multipart form data. Metadata fields are optional.
- Optional multipart file: `profileImage`.
- Optional body field: `removeProfileImage: boolean`; it cannot be true in the same request as a new image.
- Response 200: updated camel-case profile metadata.
- Errors: 400 empty/invalid update, 404 profile missing, 409 account already linked, 413 image too large.

### 90. `POST /admin/authoring/drafts`

- Purpose: Create a private problem draft at revision 1.
- Body: `problemId`, `title`, `authorProfileId`, time/memory limits, `categories`, `difficulty`, plus optional statement/C++/template fields.
- When `authorProfileId` is non-null, display fields and canonical/fallback PNG are copied from that profile; caller-supplied author display fields cannot override it.
- When `authorProfileId` is null, `authorAkaName`, `authorRealName`, `language`, and `countryCode` are required and a fallback PNG is generated.
- Response 201: complete camel-case draft data, excluding PDF and profile-image bytes.

### 91. `GET /admin/authoring/drafts`

- Purpose: List draft summaries without private C++ source or binary artifacts.
- Query: `scope` — `all` (default) or `mine`. `mine` matches the logged-in username against Author Profile AKA names (exact, case-normalized comparison mirroring `users_username_lower_unique`); drafts match via their linked profile or their own AKA snapshot. No matching profile → empty list, never a fallback to all drafts.
- Response 200: draft summaries ordered by most recently updated.

### 92. `GET /admin/authoring/drafts/:id`

- Purpose: Load a complete private draft for editing.
- Params: UUID `id`.
- Response 200: draft detail with binary presence flags.
- Error 404: draft missing.

### 93. `PATCH /admin/authoring/drafts/:id`

- Purpose: Optimistically update editable draft content.
- Params: UUID `id`.
- Body: positive `expectedRevision` plus at least one editable field.
- A successful update increments revision and invalidates readiness.
- Selecting a non-null `authorProfileId` copies its current display fields and image snapshot in the same optimistic update.
- Errors: 404 draft missing; 409 revision conflict or published/read-only draft.
  The only published-draft exception is a statement-only update from the dedicated
  statement editor. It increments revision, sets status back to `draft`, retains
  `publishedAt`, and invalidates readiness; it does not change the live grader
  problem until Verify and Publish complete.
- Once a draft has been published, `problemId` is permanently locked to its
  recorded legacy problem. A request attempting to change it returns 409
  `published_problem_id_locked`.

### 94. `POST /admin/authoring/drafts/:id/refresh-author-profile`

- Purpose: Explicitly replace the draft author snapshot with current values from its linked profile.
- Body: `{ expectedRevision: positive integer }`.
- Success increments draft revision and invalidates readiness through the normal optimistic update.
- Errors: 404 draft missing; 409 revision conflict, published draft, no linked profile, or linked profile removed during the operation.

### 95. `POST /admin/authoring/drafts/:id/new-revision`

- Purpose: Reopen a published draft for a new revision cycle (demotes to `draft`, retains `published_at`).
- Errors: 404 draft missing; 409 `draft_not_published` for unpublished drafts.

### 96. `GET /admin/authoring/drafts/:id/assets`

- Purpose: List statement image metadata without loading or returning binary content.
- Response 200: array of `{ id, draftId, filename, mimeType, checksumSha256, sizeBytes, createdAt, updatedAt }`, ordered by filename.
- Error 404: draft missing. An existing draft with no assets returns an empty array.

### 97. `POST /admin/authoring/drafts/:id/assets`

- Purpose: Validate, normalize, and add one statement image while atomically advancing draft revision.
- Content type: `multipart/form-data`.
- Fields:
  - `asset`: required JPEG/PNG/WebP file, maximum 10 MiB raw upload.
  - `expectedRevision`: required positive integer.
  - `filename`: optional override; otherwise the uploaded filename is used.
- Filename must use safe ASCII characters and an extension matching the verified media type. The backend decodes and re-encodes the image before persistence.
- Response 201: `{ asset: assetMetadata, draftRevision: number }`.
- Errors: 400 invalid request/image/filename; 404 draft missing; 409 revision conflict, published draft, or duplicate filename; 413 raw upload too large or draft asset total above 100 MiB.

### 98. `DELETE /admin/authoring/drafts/:id/assets/:assetId`

- Purpose: Delete one statement image while atomically advancing draft revision.
- Query: required positive integer `expectedRevision`.
- Response 200: `{ asset: deletedAssetMetadata, draftRevision: number }`.
- Errors: 400 invalid params/query; 404 draft or asset missing; 409 revision conflict or published draft.

### 99–103. `POST /admin/authoring/drafts/:id/jobs/{compile|generate|outputs|pdf|verify}`

- Body: `{ expectedRevision: positive integer }`; compile additionally accepts `target?: "solution" | "generator"` (default solution); generate additionally requires `seed: unsigned-64-bit decimal string`.
- Response 202: queued job metadata including ID, captured revision, type and status; never the private request snapshot.
- Errors: 400 empty source/validation/`source_missing`/`inputs_missing`/`unsupported_resource_limits`; 404 missing draft; 409 revision conflict, published draft, or existing active job; 429 global queue full; 503 runner not configured.
- `compile` compiles a captured C++20 source asynchronously. It does not execute the binary, change draft revision, or mark the draft Ready.
- `generate` uses saved generator source once to create multiple files in `./input/`. Successful current-revision results replace the entire testcase set atomically, clear outputs/readiness, and set draft status to `generated` without incrementing revision. Result summary includes seed, input hashes/sizes/names, case count, and an unverified-reproducibility warning.
- `outputs` captures immutable solution, ordered inputs and execution limits; compiles once and runs once per input; replaces all outputs only after every execution succeeds. See `AUTHORING_OUTPUTS.md`.
- `pdf` compiles the saved task-pdf-writer source and captures sanitized HTML, author metadata/avatar, assets and template version immutably; success installs PDF and sets `generated`, never Ready.
- `verify` revalidates everything and runs the solution against expected outputs with current judge comparison semantics; only a complete, current, unexpired result atomically installs PDF and sets `ready`. See `AUTHORING_VERIFY.md`.

### 104. `GET /admin/authoring/jobs/:id`

- Response 200: job metadata, bounded compiler log, result summary and error/timestamps. No source snapshot or binary artifacts.
- Error 404: job missing.
- Poll until a terminal status (`succeeded`, `failed`, `timed_out`, `stale`). A result for an edited draft becomes stale even when compilation succeeded.
- Existing history remains readable when queue submission is disabled.

### 105. `GET /admin/authoring/drafts/:id/testcases`

- Response 200: `{ revision, testcases: [...] }`, metadata only, sorted by case number.
- Metadata includes ID, filename, case number, input/output byte sizes, `hasOutput`, source/source revision and timestamps.
- Error 404: draft missing. Existing empty drafts return an empty array.

### 106. `GET /admin/authoring/drafts/:id/testcases/:caseId`

- Response 200: one case's metadata plus exact `input` and nullable `output` strings.
- Error 404: case missing or belongs to another draft.

### 107. `POST /admin/authoring/drafts/:id/testcases`

- Multipart fields: `expectedRevision`, either `input` plus optional `output`, OR `archive` ZIP.
- Individual files append one case. A ZIP replaces the entire set atomically using existing grader pairing conventions; missing outputs are allowed.
- Response 201: `{ revision }`; successful upload advances revision and invalidates readiness.
- Errors: 400 invalid text/paths/pairing/request; 404 draft missing; 409 stale revision/published; 413 count/file/total limits.

### 108. `PATCH /admin/authoring/drafts/:id/testcases/:caseId`

- Multipart fields: `expectedRevision` and `input` and/or `output`.
- Output-only updates attach a missing answer. Replacing only input clears the old output. Empty output is retained as an empty string.
- Response 200: `{ revision }`. Same validation/revision/size rules as POST; cross-draft cases return 404.

### 109. `DELETE /admin/authoring/drafts/:id/testcases/:caseId`

- JSON body: `{ expectedRevision: positive integer }`.
- Response 200: `{ revision }`; advances revision, clears readiness, preserves remaining case numbers.
- Errors: 400 invalid request; 404 missing draft/case; 409 stale revision/published.

Detailed limits, ZIP pairing and runtime isolation: `AUTHORING_TESTCASES.md`.

### 110. `POST /admin/authoring/drafts/:id/publish`

- Body: `{ expectedRevision: positive integer }`; no visibility/source overrides.
- Response 201 (first publication) / 200 (revision update): `{ draftId, problemId, revision, caseCount, publishedAt, status: "published", isVisible }`.
- Requires current ready/verified revision, no active job, matching successful
  Verify All report/PDF and complete testcase pairs. Runs synchronously in one DB transaction.
- Inserts new hidden legacy problem + exact cases with stable numbers and marks
  draft published atomically. Never copies private C++ sources into grader records/export.
- Errors: 400 invalid request; 404 `draft_not_found`; 409 `draft_published`,
  `revision_conflict`, `job_active`, `draft_not_ready`, `pdf_not_verified`,
  `invalid_testcases`, `problem_id_conflict`, `published_problem_missing`/`published_problem_mismatch`/`published_problem_provenance_missing`. All failures preserve existing records.
- Does not require an online runner or automatically expose the problem to contestants.
  See `AUTHORING_PUBLISH.md` for mapping, retry and concurrency details.

### 111. `GET /admin/authoring/drafts/:id/jobs`

- Response 200: latest 100 jobs ordered by creation time and ID descending.
- List rows contain only IDs, revision/type/status, bounded error text and timestamps.
  Full result reports and logs are intentionally omitted; fetch the job detail endpoint
  only when an admin selects one job. Source snapshots are never returned.
- Error 404: missing draft. Response is private and not cacheable.

### 112. `POST /admin/authoring/drafts/:id/preview`

- Body: strict `{ statementHtml: string }`, at most 2 MiB UTF-8. The
  field name is retained for compatibility; its value is task-pdf-writer-compatible
  Markdown with inline HTML and LaTeX.
- Response 200: `{ html }`, a self-contained compiled and sanitized preview using the saved
  metadata/avatar/assets and the current unsaved statement text.
- KaTeX is rendered on the server for `$...$`, `$$...$$`, `\(...\)` and `\[...\]`.
  Scripts and remote resources are absent; CSP permits only inline style and
  embedded image/font data. This endpoint creates no runner job and writes no data.
- Errors: 400 unsafe/invalid/oversized content, math, asset or template; 404 missing draft.

### 113. `GET /admin/authoring/drafts/:id/assets/:assetId`

- Response 200: exact stored normalized PNG/JPEG/WebP bytes with private/no-store,
  nosniff and sandbox CSP headers.
- Errors: 400 unsupported stored media type; 404 missing/cross-draft asset.
- Used only for private authoring inspection. Public statement/PDF APIs never expose it.

### 114. `GET /admin/authoring/drafts/:id/pdf`

- Response 200: last successful PDF, `application/pdf`, inline disposition.
- `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, same-origin framing.
- `X-PDF-Revision` / `X-Draft-Revision` allow the editor to label an outdated preview.
- Error 404: missing draft or `pdf_missing`. Editing a draft does not erase its previous PDF.
- Full statement/security/runtime contract: `AUTHORING_PDF.md`.

### 115. `GET /admin/authoring/profile-syncs`

- No params. Readable even when the runner transport is disabled
  (the rows live in the main database, like job history).
- Response 200: the 20 most recent profile-sync cascade runs, newest first.
  Rows contain run UUID, profile UUID and aka name, run status
  (`queued`/`running`/`succeeded`/`failed`), result summary, timestamps and
  progress counters `{ total, synced, failed }` (failed includes deferred).

### 116. `GET /admin/authoring/profile-syncs/:id`

- Params: UUID sync run `id`.
- Response 200: one run plus `items`, the per-draft rows ordered by creation:
  draft UUID, problem ID/title, item status (`pending`/`syncing`/`synced`/
  `failed`/`deferred`), attempts, error message, draft status and whether the
  draft was published. Metadata only — no statement or PDF bytes.
- Errors: 400 invalid UUID; 404 `profile_sync_not_found`.

---

## Frontend Implementation Notes (สำคัญ)

- ใช้ axios instance แบบ `withCredentials: true` ทุก request ที่ต้องใช้ session
- 401 interceptor redirect ไป `/login?expired=1&returnTo=…` แบบ one-shot และ **re-arm หลัง login สำเร็จ** (AUTH-008); 401 จาก `/profile/password` (รหัสปัจจุบันผิด) ไม่ถูกนับเป็น session expiry — แสดง inline
- Endpoints ที่เป็นไฟล์ต้องตั้ง `responseType: 'blob'`
  - `/problems/:id/pdf`
  - `/contests/:id/problems/:problemId/pdf`
  - `/admin/problems/export`
  - `/admin/database/export`
  - `/admin/authoring/drafts/:id/pdf`
  - `/analytics/export`
- SSE endpoints (ใช้ `EventSource`):
  - `/admin/problems/batch-upload-progress/:progressId`
  - `/realtime/submissions`, `/realtime/contests/:id` (ผ่าน `services/realtimeService.ts`; fallback เป็น polling เมื่อ stream ตาย)
- Validation error shape มี 2 แบบหลัก ต้องรองรับทั้งคู่
  - `{ errors: [...] }`
  - `{ message: 'Validation failed', errors: [...] }`
- หลีกเลี่ยง hardcode authorization ฝั่ง frontend ให้ยึด response จาก backend เป็นหลัก
