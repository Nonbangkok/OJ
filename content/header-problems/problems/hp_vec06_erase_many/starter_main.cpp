// The simple main.cpp students download together with vector.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
//
// <vector> is included BEFORE "vector.h" on purpose: the class declares
// erase_many(const std::vector<size_t>&), so std::vector has to be known
// already. You therefore do not need (and are not allowed) to add any
// #include of your own in student.h.
#include <vector>

#include "vector.h"
#include "student.h"

#include <iostream>

int main()
{
  size_t n;
  std::cin >> n;

  CP::vector<int> v(n);
  for (size_t i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    v[i] = element;
  }

  size_t k;
  std::cin >> k;
  std::vector<size_t> positions(k);
  for (size_t i = 0; i < k; ++i)
  {
    std::cin >> positions[i];
  }

  v.erase_many(positions);

  std::cout << v.size() << std::endl;
  for (size_t i = 0; i < v.size(); ++i)
  {
    std::cout << v[i] << " ";
  }
  std::cout << std::endl;
}
