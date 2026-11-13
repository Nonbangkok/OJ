// The simple main.cpp students download together with vector.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "vector.h"
#include "student.h"

#include <iostream>

int main()
{
  size_t n;
  std::cin >> n;

  CP::vector<int> v(n);
  for (size_t index = 0; index < n; ++index)
  {
    int element;
    std::cin >> element;
    v[index] = element;
  }

  size_t q;
  std::cin >> q;
  for (size_t k = 0; k < q; ++k)
  {
    size_t i, j, len;
    std::cin >> i >> j >> len;
    v.block_swap(i, j, len);
  }

  for (size_t index = 0; index < v.size(); ++index)
  {
    std::cout << v[index] << " ";
  }
  std::cout << std::endl;
}
