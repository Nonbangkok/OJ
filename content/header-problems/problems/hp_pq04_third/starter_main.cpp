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

  std::cout << heap.top() << " " << heap.third() << std::endl;
  std::cout << heap.take_three() << " " << heap.size() << std::endl;
  std::cout << heap.top() << " " << heap.third() << std::endl;
}
