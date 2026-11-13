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
  CP::pair<int, int> head(a, b);
  CP::pair<int, int> best(a, b);

  for (int i = 1; i < n; ++i)
  {
    std::cin >> a >> b;
    CP::pair<int, int> p(a, b);
    std::cout << (head.dominates(p) ? 1 : 0) << " " << (p.dominates(head) ? 1 : 0) << std::endl;
    best = best.larger(p);
  }

  std::cout << best.first << " " << best.second << std::endl;
}
