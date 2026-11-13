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

  std::cout << heap.is_heap() << std::endl;

  // raw_swap exchanges two slots of mData without repairing anything, so the
  // array normally stops being a heap here.
  heap.raw_swap(0, n - 1);
  std::cout << heap.is_heap() << " " << heap.top() << std::endl;
}
