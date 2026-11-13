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

  int a, b;
  std::cin >> a >> b;

  heap.update(0, a);
  std::cout << heap.top() << " " << heap.heap_ok() << std::endl;

  heap.update(heap.size() - 1, b);
  std::cout << heap.top() << " " << heap.heap_ok() << std::endl;

  while (!heap.empty())
  {
    std::cout << heap.top() << " ";
    heap.pop();
  }
  std::cout << std::endl;
}
