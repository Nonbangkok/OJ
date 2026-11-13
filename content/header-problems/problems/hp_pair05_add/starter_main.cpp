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

  CP::pair<int, std::string> previous;
  CP::pair<int, std::string> head;
  for (int i = 0; i < n; ++i)
  {
    int a;
    std::string b;
    std::cin >> a >> b;
    CP::pair<int, std::string> p(a, b);

    if (i == 0)
      head = p;
    else
    {
      CP::pair<int, std::string> sum = previous + p;
      std::cout << sum.first << " " << sum.second << std::endl;
    }
    previous = p;
  }

  CP::pair<int, std::string> twice = head.doubled();
  std::cout << twice.first << " " << twice.second << std::endl;
}
