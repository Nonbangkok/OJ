// The simple main.cpp students download together with pair.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "pair.h"
#include "student.h"

#include <iostream>

int main()
{
  int n;
  std::cin >> n;

  int a, b;
  std::cin >> a >> b;
  CP::pair<int, int> reference(a, b);
  CP::pair<int, int> last(a, b);

  for (int i = 1; i < n; ++i)
  {
    std::cin >> a >> b;
    CP::pair<int, int> p(a, b);
    std::cout << (p == reference ? 1 : 0) << " "
              << (p != reference ? 1 : 0) << " "
              << (p < reference ? 1 : 0) << " "
              << (p <= reference ? 1 : 0) << " "
              << (p > reference ? 1 : 0) << " "
              << (p >= reference ? 1 : 0) << std::endl;
    last = p;
  }

  std::cout << last.compare_sign(reference) << std::endl;
}
