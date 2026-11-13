// The simple main.cpp students download together with priority_queue.h and
// student.h. It is NOT the program the judge runs — see the statement's
// section ข้อบังคับ.
#include "priority_queue.h"
#include "student.h"

#include <iostream>

int main()
{
  CP::priority_queue<int> heap;
  int n;
  std::cin >> n;
  for (int i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    heap.push(element);
  }

  for (size_t i = 0; i < heap.size(); ++i)
    std::cout << heap.rank(i) << " ";
  std::cout << std::endl;

  std::cout << heap.top() << " " << heap.is_top(0) << std::endl;
}
