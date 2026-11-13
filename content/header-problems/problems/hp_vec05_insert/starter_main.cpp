// The simple main.cpp students download together with vector.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "vector.h"
#include "student.h"

#include <iostream>

int main()
{
  size_t n;
  std::cin >> n;

  CP::vector<int> v;
  for (size_t i = 0; i < n; ++i)
  {
    int element;
    std::cin >> element;
    v.insert(v.size(), element);  // insert at the end = append
  }

  size_t q;
  std::cin >> q;
  for (size_t k = 0; k < q; ++k)
  {
    size_t pos;
    int value;
    std::cin >> pos >> value;
    v.insert(pos, value);
  }

  std::cout << v.size() << std::endl;
  for (size_t i = 0; i < v.size(); ++i)
  {
    std::cout << v[i] << " ";
  }
  std::cout << std::endl;
}
