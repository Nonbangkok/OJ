// The simple main.cpp students download together with vector.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "vector.h"
#include "student.h"

#include <iostream>

int main()
{
  size_t n, k;
  std::cin >> n >> k;

  CP::vector<int> v(n);
  for (size_t i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    v[i] = element;
  }

  v.rotate(k);

  std::cout << v.size() << std::endl;
  for (size_t i = 0; i < v.size(); ++i)
  {
    std::cout << v[i] << " ";
  }
  std::cout << std::endl;
}
