// The simple main.cpp students download together with pair.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "pair.h"
#include "student.h"

#include <iostream>
#include <string>

int main()
{
  int n;
  std::cin >> n;

  CP::pair<long long, std::string> total;
  CP::pair<long long, std::string> last;
  for (int i = 0; i < n; ++i)
  {
    long long a;
    std::string b;
    std::cin >> a >> b;
    CP::pair<long long, std::string> p(a, b);

    total += p;
    std::cout << total.first << " " << total.second << std::endl;

    last = p;
  }

  total.absorb_twice(last);
  std::cout << total.first << " " << total.second << std::endl;
}
