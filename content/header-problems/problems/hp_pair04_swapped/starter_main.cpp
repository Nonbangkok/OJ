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

  CP::pair<int, std::string> last;
  for (int i = 0; i < n; ++i)
  {
    int a;
    std::string b;
    std::cin >> a >> b;
    CP::pair<int, std::string> p(a, b);

    CP::pair<std::string, int> flipped = p.swapped();
    std::cout << flipped.first << " " << flipped.second << std::endl;

    last = p;
  }

  CP::pair<int, std::string> back = last.round_trip();
  std::cout << back.first << " " << back.second << std::endl;
}
