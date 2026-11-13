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
  for (size_t i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    v.at(i) = element;
  }

  std::cout << v.size() << " " << v.capacity() << std::endl;

  size_t q;
  std::cin >> q;
  for (size_t k = 0; k < q; ++k)
  {
    size_t index;
    std::cin >> index;
    try
    {
      std::cout << v.at(index) << std::endl;
    }
    catch (const std::out_of_range &error)
    {
      std::cout << "out_of_range" << std::endl;
    }
  }
}
