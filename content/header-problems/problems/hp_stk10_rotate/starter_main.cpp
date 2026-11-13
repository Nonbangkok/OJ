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

  s.rotate(3);
  std::cout << s.top() << std::endl;
  s.rotate(3);
  std::cout << s.top() << std::endl;
  s.rotate(1000);
  std::cout << s.top() << " " << s.size() << std::endl;

  while (!s.empty())
  {
    std::cout << s.top() << " ";
    s.pop();
  }
  std::cout << std::endl;
}
