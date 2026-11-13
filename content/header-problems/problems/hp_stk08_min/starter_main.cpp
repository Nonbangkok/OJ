// The simple main.cpp students download together with stack.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "stack.h"
#include "student.h"

#include <iostream>

int main()
{
  CP::stack<int> s;
  int n;
  std::cin >> n;
  for (int i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    s.push(element);
  }

  std::cout << s.top() << " " << s.min() << std::endl;
  s.pop();
  std::cout << s.top() << " " << s.min() << std::endl;
  s.push(5);
  std::cout << s.min() << std::endl;
}
