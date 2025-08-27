import React, { useState } from 'react';
import styles from './Home.module.css';

const quotes = [
  "วันนี้คุณทำโจทย์แล้วหรือยัง",
  "The best way to predict the future is to implement it.",
  "อัลกอริทึมที่สวยงาม ก็เหมือนบทกวีที่ทำงานได้",
  "First, solve the problem. Then, write the code.",
  "อย่ายอมแพ้ให้กับ 'Time Limit Exceeded'",
  "It’s not a bug – it’s an undocumented feature.",
  "ความสำเร็จคือผลรวมของความพยายามเล็กๆ น้อยๆ ที่ทำซ้ำๆ ทุกวัน",
  "Talk is cheap. Show me the code. - Linus Torvalds",
  "ทุกๆ บรรทัดของโค้ด คือก้าวเล็กๆ สู่ความสำเร็จที่ยิ่งใหญ่",
  "A good programmer looks both ways before crossing a one-way street.",
  "เขียนโค้ดให้เหมือนบทกวี ดีบั๊กให้เหมือนนักสืบ",
  "Debugging is like being the detective in a crime movie where you are also the murderer.",
  "Code is like humor. When you have to explain it, it’s bad.",
  "โปรแกรมเมอร์ที่ดีคือคนที่ขี้เกียจอย่างมีประสิทธิภาพ",
  "Measuring programming progress by lines of code is like measuring aircraft building progress by weight. - Bill Gates",
  "คอมไพล์ไม่ผ่าน ไม่ใช่ปัญหาใหญ่... แค่ยังไม่เจอเซมิโคลอนที่หายไป",
  "The computer was born to solve problems that did not exist before.",
  "Stack Overflow คือเพื่อนแท้ในยามยาก",
  "Any fool can write code that a computer can understand. Good programmers write code that humans can understand. - Martin Fowler",
  "อย่าหยุดเรียนรู้ เพราะเทคโนโลยีไม่เคยหยุดพัฒนา",
  "Walking on water and developing software from a specification are easy if both are frozen.",
  "ยิ่งโค้ดรก ยิ่งดีบั๊กสนุก (?!)",
  "The most important property of a program is whether it accomplishes the intention of its user. - C.A.R. Hoare",
  "เขียนเทสก่อนโค้ด เหมือนมีตาข่ายกันตก",
  "Programming isn't about what you know; it's about what you can figure out.",
  "กาแฟ: เชื้อเพลิงหลักของโปรแกรมเมอร์",
  "If at first you don't succeed, call it version 1.0.",
  "ทุก Error คือบทเรียน ปลาตะเพียนอยู่ในน้ำ",
  "The function of good software is to make the complex appear to be simple. - Grady Booch",
  "หลับไปพร้อมกับบั๊ก ตื่นมาพร้อมกับโซลูชัน",
  "Code never lies, comments sometimes do.",
  "อย่ากลัวที่จะลบโค้ดเก่า",
  "Simplicity is the soul of efficiency.",
  "Refactor จนกว่าจะพอใจ",
  "Before software can be reusable it first has to be usable. - Ralph Johnson",
  "โค้ดที่ดีที่สุด คือโค้ดที่ไม่ได้เขียน",
  "There are only two hard things in Computer Science: cache invalidation and naming things. - Phil Karlton",
  "อัลกอริทึมที่ดี อาจมีค่ามากกว่าฮาร์ดแวร์ที่แรงที่สุด",
  "The trouble with programmers is that you can never tell what a programmer is doing until it’s too late. - Seymour Cray",
  "แก้บั๊กเหมือนงมเข็มในมหาสมุทร... ที่เราเป็นคนทำเข็มตกเอง",
  "Simplicity, carried to an extreme, becomes elegance. - Jon Franklin",
  "อย่าเพิ่ง Optimize ถ้ามันยังไม่เวิร์ค",
  "Programming is the art of telling another human being what one wants the computer to do. - Donald Knuth",
  "บางทีวิธีแก้ที่ดีที่สุดคือการนอน",
  "Always code as if the guy who ends up maintaining your code will be a violent psychopath who knows where you live. - John Woods",
  "ทุกครั้งที่ commit คือการบันทึกประวัติศาสตร์",
  "The sooner you start to code, the longer the program will take.",
  "Documentation คือจดหมายรักถึงตัวเองในอนาคต",
  "Deleted code is debugged code.",
  "ถ้ามันทำงานได้ อย่าไปแตะมัน... (เป็นคำแนะนำที่ไม่ดี)"
];

const Home = () => {
  const [currentQuote, setCurrentQuote] = useState("ยินดีต้อนรับ");
  const [isWelcome, setIsWelcome] = useState(true);
  const [isFading, setIsFading] = useState(false);

  const getRandomQuote = () => {
    // Prevent showing the same quote twice in a row
    let newQuote;
    do {
      newQuote = quotes[Math.floor(Math.random() * quotes.length)];
    } while (newQuote === currentQuote);
    return newQuote;
  };

  const handleClick = () => {
    if (isFading) return; // Prevent clicking while animating

    setIsFading(true); // Start fade out

    setTimeout(() => {
      if (isWelcome) {
        setIsWelcome(false);
      }
      setCurrentQuote(getRandomQuote());
      setIsFading(false); // Start fade in
    }, 300); // Match CSS transition duration
  };

  const textClassName = `${isWelcome ? styles['welcome-text'] : styles['quote-text']} ${isFading ? styles.fading : ''}`;

  return (
    <div className={styles['home-container']}>
      <div className={styles['quote-box']} onClick={handleClick}>
        <p className={textClassName}>
          {currentQuote}
        </p>
      </div>
    </div>
  );
};

export default Home; 