# Frontend Project Topology

เอกสารฉบับนี้อธิบายถึงโครงสร้างโฟลเดอร์ภายใน `frontend/src` ของโปรเจกต์ OJ เพื่อให้การพัฒนาเป็นไปในทิศทางเดียวกัน มีความเป็นระเบียบ และบำรุงรักษาได้ง่ายในระยะยาว

## 📂 โครงสร้างโฟลเดอร์ (Directory Structure)

| โฟลเดอร์ | หน้าที่และความสำคัญ |
| :--- | :--- |
| `assets/` | เก็บไฟล์ Static ต่างๆ เช่น รูปภาพ (Images), ไอคอน (Icons), fonts หรือไฟล์ SVG |
| `components/` | เก็บ **UI Components** ที่เป็นอิสระและสามารถนำกลับมาใช้ซ้ำได้ (Reusable) เช่น Button, Table, Input, โดยมักจะแยกเป็นหมวดหมู่ย่อย เช่น `common`, `forms` |
| `context/` | เก็บ **React Context** สำหรับการจัดการสถานะภายในแอปพลิเคชัน (State Management) เช่น `AuthContext`, `SettingsContext` |
| `features/` | เก็บส่วนประกอบแยกตาม **Domain/Feature** ของระบบ เช่น `admin`, `problems`, `contests` โดยภายในอาจมี components, hooks, หรือ logic เฉพาะตัวสำหรับฟีเจอร์นั้นๆ |
| `hooks/` | เก็บ **Custom Hooks** ที่ใช้จัดการ logic ที่สามารถใช้ซ้ำได้ในหลายๆ ส่วนของแอป เช่น `useAuth`, `useSubmissions` |
| `layouts/` | เก็บโครงสร้างหลักของหน้าเว็บ (Layouts) เช่น `Navbar`, `Sidebar`, `Footer` หรือ `MainLayout` ที่ครอบคลุมหน้าหลายๆ หน้า |
| `pages/` | เก็บ **Page Components** ซึ่งเป็นจุดเริ่มต้นของแต่ละเส้นทาง (Route) โดยทั่วไปจะมี logic ในการดึงข้อมูลและประกอบ components เข้าด้วยกัน |
| `services/` | เก็บ **API Service Layer** สำหรับการเชื่อมต่อกับ Backend โดยใช้ `axios` เพื่อแยก logic ของการส่ง request ออกจากตัว component |
| `utils/` | เก็บฟังก์ชันช่วยเหลือทั่วไป (Utility Functions) เช่น การฟอร์แมตวันที่ (Date Formatters), การคำนวณต่างๆ ที่ไม่มี state |
| `tests/` | เก็บไฟล์ทดสอบ (Unit tests, Integration tests) เพื่อตรวจสอบความถูกต้องของแอปพลิเคชัน |

---

## 🛠 คำแนะนำในการจัดไฟล์ (Organizational Recommendations)

เพื่อให้โค้ดมีคุณภาพและอ่านง่าย (Clean Code) เรายึดถือหลักการสำคัญดังนี้:

### 1. Component Declaration
- ใช้ **Arrow Functions** สำหรับการประกาศ Component ทุกครั้ง
- ตั้งชื่อไฟล์ตามชื่อ Component (PascalCase) เช่น `SubmissionModal.js`

```javascript
const MyComponent = ({ prop1, prop2 }) => {
  return <div>{prop1}</div>;
};
export default MyComponent;
```

### 2. Styling with CSS Modules
- ห้ามใช้ไฟล์ CSS ธรรมดาแบบ Global ยกเว้นใน `index.css`
- ให้ใช้ **CSS Modules** (ไฟล์นามสกุล `.module.css`) เพื่อป้องกันปัญหา Class name ทะเลาะกัน
- นำเข้า styles ในรูปแบบ object: `import styles from './MyComponent.module.css';`

### 3. Service Layer Pattern
- อย่าใช้ `axios` หรือส่ง request ใน Component โดยตรง
- สร้างฟังก์ชันใน `services/` และเรียกใช้ผ่าน Hooks หรือ Context แทน เพื่อให้โค้ดทดสอบได้ง่ายและเป็นระเบียบ

### 4. Logic Separation
- หาก Component มี logic ที่ซับซ้อน ให้พิจารณาแยกออกมาเป็น **Custom Hook** (ภายในโฟลเดอร์ `hooks/`) 
- พยายามทำให้ Component มีหน้าที่หลักเพียงอย่างเดียว (Single Responsibility)

### 5. Proper Naming
- **Variables/Functions**: `camelCase`
- **Components/Classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

---

> [!TIP]
> การจัดโครงสร้างตาม Feature (ในโฟลเดอร์ `features/`) ช่วยให้เราสามารถ scale แอปพลิเคชันได้ดีขึ้นเมื่อขนาดโปรเจกต์ใหญ่ขึ้น เนื่องจากโค้ดที่เกี่ยวข้องกันจะถูกจัดรวมกลุ่มไว้อยู่ที่เดียวกัน
