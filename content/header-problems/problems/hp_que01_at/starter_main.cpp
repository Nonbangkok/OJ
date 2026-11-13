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

  int queries;
  std::cin >> queries;
  for (int k = 0; k < queries; ++k)
  {
    size_t index;
    std::cin >> index;
    std::cout << q.at(index) << " ";
  }
  std::cout << std::endl;

  // at() must still be right once mFront has moved away from 0.
  q.pop();
  q.push(60);
  std::cout << q.at(0) << " " << q.at(q.size() - 1) << " " << q.size() << std::endl;
}
