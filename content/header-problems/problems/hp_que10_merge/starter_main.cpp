// The simple main.cpp students download together with queue.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "queue.h"
#include "student.h"

#include <iostream>

int main()
{
  CP::queue<int> a;
  CP::queue<int> b;

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
  std::cout << a.size() << " " << b.size() << std::endl;

  // The emptied queue must still work.
  b.push(99);
  std::cout << b.front() << " " << b.back() << " " << b.size() << std::endl;

  while (!a.empty())
  {
    std::cout << a.front() << " ";
    a.pop();
  }
  std::cout << std::endl;
}
