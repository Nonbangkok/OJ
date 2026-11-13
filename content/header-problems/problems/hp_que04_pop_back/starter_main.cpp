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

  // m may be larger than the queue: the extra calls must do nothing at all.
  int m;
  std::cin >> m;
  for (int i = 0; i < m; ++i)
  {
    q.pop_back();
  }
  std::cout << q.size() << std::endl;

  q.push(77);
  q.push(88);
  std::cout << q.front() << " " << q.back() << " " << q.size() << std::endl;

  while (!q.empty())
  {
    std::cout << q.front() << " ";
    q.pop();
  }
  std::cout << std::endl;
}
