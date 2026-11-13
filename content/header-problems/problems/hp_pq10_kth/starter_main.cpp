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

  int q;
  std::cin >> q;
  for (int i = 0; i < q; ++i)
  {
    size_t k;
    std::cin >> k;
    std::cout << heap.kth(k) << " ";
  }
  std::cout << std::endl;

  std::cout << heap.heap_ok() << " " << heap.size() << std::endl;
}
