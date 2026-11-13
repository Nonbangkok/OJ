// The simple main.cpp students download together with vector.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "vector.h"
#include "student.h"

#include <iostream>

int main()
{
  size_t n;
  int value;
  std::cin >> n >> value;

  CP::vector<int> v(n);
  for (size_t i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    v[i] = element;
  }

  for (size_t i = 0; i < v.size(); ++i)
    std::cout << v[i] << " ";
  std::cout << std::endl;

  v.fill(value);

  for (size_t i = 0; i < v.size(); ++i)
    std::cout << v[i] << " ";
  std::cout << std::endl;
  std::cout << v.size() << " " << v.capacity() << std::endl;
}
