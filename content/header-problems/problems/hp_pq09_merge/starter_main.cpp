// The simple main.cpp students download together with priority_queue.h and
// student.h. It is NOT the program the judge runs — see the statement's
// section ข้อบังคับ.
#include "priority_queue.h"
#include "student.h"

#include <iostream>

int main()
{
  CP::priority_queue<int> a, b;

  int n;
  std::cin >> n;
  for (int i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    a.push(element);
  }

  int m;
  std::cin >> m;
  for (int i = 0; i < m; ++i)
  {
    int element;
    std::cin >> element;
    b.push(element);
  }

  a.merge(b);
  std::cout << a.size() << " " << b.size() << " " << a.heap_ok() << std::endl;

  while (!a.empty())
  {
    std::cout << a.top() << " ";
    a.pop();
  }
  std::cout << std::endl;
}
