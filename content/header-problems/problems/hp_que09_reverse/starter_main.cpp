// The simple main.cpp students download together with queue.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "queue.h"
#include "student.h"

#include <iostream>

int main()
{
  CP::queue<int> q;
  int n;
  std::cin >> n;
  for (int i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    q.push(element);
  }

  q.reverse();

  std::cout << q.front() << " " << q.back() << std::endl;
  while (!q.empty())
  {
    std::cout << q.front() << " ";
    q.pop();
  }
  std::cout << std::endl;
}
