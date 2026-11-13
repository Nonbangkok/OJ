// The simple main.cpp students download together with pair.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "pair.h"
#include "student.h"

#include <iostream>

int main()
{
  int n;
  std::cin >> n;

  for (int i = 0; i < n; ++i)
  {
    int a, b;
    std::cin >> a >> b;
    CP::pair<int, int> p(a, b);

    std::cout << (p.sorted() ? 1 : 0);
    p.normalize();
    std::cout << " " << p.first << " " << p.second
              << " " << (p.sorted() ? 1 : 0) << std::endl;
  }
}
