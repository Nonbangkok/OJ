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

  std::cout << s.at(0) << " " << s.at(1) << " " << s.at(s.size() - 1) << std::endl;
  s.pop();
  std::cout << s.at(0) << " " << s.at(s.size() - 1) << std::endl;
  std::cout << s.size() << std::endl;
}
