<!--
  The shared ข้อบังคับ partial: identical for all 50 header problems, so it
  lives here ONCE and every statement.md pulls it in with {{> rules}}.
  Placeholders ({{ds}}, {{submission}}, {{class}}) are substituted by build.py
  from meta.json, so the text names the right header and class per problem.
  Edit this file to change the rules everywhere; never copy it into a problem.
-->

## ข้อบังคับ :

1. ส่งไฟล์ `{{submission}}` เพียงไฟล์เดียว ระบบจะนำไปคอมไพล์รวมกับ `main.cpp`
   และ `{{ds}}` ของผู้ออกข้อสอบ ซึ่ง **ไม่ใช่** ไฟล์ชุดเดียวกับที่ให้
   ดาวน์โหลดไป การแก้ `main.cpp` หรือ `{{ds}}` ในเครื่องตัวเองจึงไม่มีผลต่อ
   การตรวจ
2. แก้ไขได้เฉพาะภายในฟังก์ชันที่อยู่ใน `{{submission}}` เท่านั้น ห้ามเพิ่ม
   ฟังก์ชันสมาชิก (member function) หรือตัวแปรสมาชิก (member variable) ใหม่
   ให้คลาส `{{class}}` เพราะไฟล์ `{{ds}}` ของผู้ออกข้อสอบจะเป็นตัวกำหนด
   โครงสร้างของคลาส
3. ฟังก์ชันที่มีคอมเมนต์ `// You MAY need to edit this function` กำกับไว้
   แก้ไขได้ตามต้องการ แต่ต้องยังทำงานถูกต้องตามความหมายเดิมของฟังก์ชันนั้น
   เพราะโปรแกรมของผู้ออกข้อสอบจะเรียกใช้ฟังก์ชันเหล่านี้สลับกับฟังก์ชันที่
   โจทย์กำหนดให้เขียน
4. ห้ามอ่านหรือเขียนข้อมูลเข้า/ออก (I/O) ใน `{{submission}}` เช่น `std::cin`,
   `std::cout`, `printf`, `scanf` หรือการเปิดไฟล์
5. ห้ามใช้ preprocessor directive อื่นนอกจากที่มีให้แล้วในไฟล์ต้นแบบ
   โดยเฉพาะห้าม `#include` ไฟล์เพิ่ม และห้ามใช้ inline assembly
   (`asm`, `__asm__`, `.incbin`) ระบบตรวจจะปฏิเสธโปรแกรมที่มีคำเหล่านี้
6. ห้ามใช้โครงสร้างข้อมูลจาก standard library (เช่น `std::vector`,
   `std::queue`, `std::map`) เป็นที่เก็บข้อมูลเพิ่มเติม ยกเว้นโจทย์ระบุไว้
   เป็นอย่างอื่น ข้อมูลทั้งหมดต้องอยู่ในตัวแปรสมาชิกที่คลาสมีอยู่แล้ว
7. ภาษาที่ใช้ได้คือ C++ เท่านั้น คอมไพล์ด้วย `g++ -std=c++20`
