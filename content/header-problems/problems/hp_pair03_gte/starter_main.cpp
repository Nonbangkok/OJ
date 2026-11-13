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
  CP::pair<int, int> floor_pair(a, b);

  for (int i = 1; i < n; ++i)
  {
    std::cin >> a >> b;
    CP::pair<int, int> p(a, b);
    std::cout << (p >= floor_pair ? 1 : 0) << " " << (p < floor_pair ? 1 : 0) << std::endl;
    p.clamp_low(floor_pair);
    std::cout << p.first << " " << p.second << std::endl;
  }
}
