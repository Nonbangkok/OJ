// The simple main.cpp students download together with pair.h and student.h.
// It is NOT the program the judge runs — see the statement's ข้อบังคับ.
#include "pair.h"
#include "student.h"

#include <iostream>
#include <string>
#include <vector>

int main()
{
  int n;
  std::cin >> n;

  std::vector<CP::pair<std::string, int>> items;
  for (int i = 0; i < n; ++i)
  {
    std::string a;
    int b;
    std::cin >> a >> b;
    items.push_back(CP::pair<std::string, int>(a, b));
  }

  for (int i = 1; i < n; ++i)
  {
    std::cout << (items[i].less_by_second(items[0]) ? 1 : 0) << " "
              << (items[0].less_by_second(items[i]) ? 1 : 0) << std::endl;
  }

  // Insertion sort, using less_by_second as the comparator.
  for (int i = 1; i < n; ++i)
  {
    CP::pair<std::string, int> key = items[i];
    int j = i - 1;
    while (j >= 0 && key.less_by_second(items[j]))
    {
      items[j + 1] = items[j];
      --j;
    }
    items[j + 1] = key;
  }

  for (int i = 0; i < n; ++i)
    std::cout << items[i].first << " " << items[i].second << std::endl;
}
