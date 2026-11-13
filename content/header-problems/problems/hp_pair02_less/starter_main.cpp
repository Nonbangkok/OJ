// The simple main.cpp students download together with pair.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "pair.h"
#include "student.h"

#include <iostream>

int main()
{
  int n;
  std::cin >> n;

  CP::pair<int, int> reference;
  CP::pair<int, int> best;
  for (int i = 0; i < n; ++i)
  {
    int a, b;
    std::cin >> a >> b;
    CP::pair<int, int> p(a, b);
    if (i == 0)
    {
      reference = p;
      best = p;
    }
    else
    {
      best.make_min(p);
    }
    std::cout << (p < reference ? 1 : 0) << " " << (p > reference ? 1 : 0) << std::endl;
  }

  std::cout << best.first << " " << best.second << std::endl;
}
