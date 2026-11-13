// SECRET grader main for hp_pair03_gte. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so >= is interleaved with clamp_low, copy
//     assignment, copy construction and temporaries;
//   * it instantiates THREE pair types (pair<int,int>,
//     pair<std::string,std::string> and pair<long long,int>), so a student.h
//     that only works for int fails;
//   * every comparison prints >=, < and <= together. The header defines < as
//     !(a >= b) and <= as (b >= a), so the three digits cross-check one
//     implementation: an >= that is strict on equal pairs prints "0 1 1"
//     where a correct one prints "1 0 1";
//   * two commands exist only to pin the equality edge down: `self` compares
//     an element with itself and `copy` compares a copy-constructed element
//     with its original — both must always print "1 0 1";
//   * it calls the pre-existing member the student may have edited
//     (clamp_low), so an edit that breaks it is caught;
//   * every block ends with a full sweep over the array.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>,
//                                2 = pair<std::string,std::string>,
//                                3 = pair<long long,int>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              cmp    : compare A[i] with A[j]
//       2 i a b            assign : A[i] = pair(a, b)
//       3 i j              clamp  : A[i].clamp_low(A[j]), then print A[i]
//       4 i a b            temp   : compare A[i] with a temporary pair(a, b)
//       5 i                self   : compare A[i] with itself
//       6 i                zero   : compare A[i] with a default-constructed pair
//       7 i                copy   : compare a copy of A[i] with A[i]
//
// Output: one line per printing command, then "S <ge> <lt> <le>" for the
// block's closing sweep.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <string>
#include <vector>

namespace
{

  // Taken by const reference on purpose: this only compiles if >=, < and <=
  // are const member functions, which is what the class declares.
  template <typename T1, typename T2>
  void print_verdicts(const CP::pair<T1, T2> &left, const CP::pair<T1, T2> &right)
  {
    std::cout << (left >= right ? 1 : 0) << ' '
              << (left < right ? 1 : 0) << ' '
              << (left <= right ? 1 : 0) << '\n';
  }

  template <typename T1, typename T2>
  void run_block(size_t n, size_t commands)
  {
    std::vector<CP::pair<T1, T2>> a;
    a.reserve(n);
    for (size_t i = 0; i < n; ++i)
    {
      T1 first;
      T2 second;
      std::cin >> first >> second;
      a.push_back(CP::pair<T1, T2>(first, second));
    }

    for (size_t step = 0; step < commands; ++step)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        size_t i, j;
        std::cin >> i >> j;
        print_verdicts(a[i], a[j]);
        break;
      }
      case 2:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        break;
      }
      case 3:
      {
        size_t i, j;
        std::cin >> i >> j;
        a[i].clamp_low(a[j]);
        std::cout << "L " << a[i].first << ' ' << a[i].second << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        print_verdicts(a[i], CP::pair<T1, T2>(first, second));
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        print_verdicts(a[i], a[i]);
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        print_verdicts(a[i], CP::pair<T1, T2>());
        break;
      }
      case 7:
      {
        size_t i;
        std::cin >> i;
        CP::pair<T1, T2> copied(a[i]);
        print_verdicts(copied, a[i]);
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    size_t ge = 0;
    size_t lt = 0;
    size_t le = 0;
    for (size_t i = 0; i + 1 < a.size(); ++i)
    {
      if (a[i] >= a[i + 1])
        ++ge;
      if (a[i] < a[i + 1])
        ++lt;
      if (a[i] <= a[i + 1])
        ++le;
    }
    std::cout << "S " << ge << ' ' << lt << ' ' << le << '\n';
  }

} // namespace

int main()
{
  std::ios_base::sync_with_stdio(false);
  std::cin.tie(nullptr);

  int blocks;
  if (!(std::cin >> blocks))
    return 0;

  for (int b = 0; b < blocks; ++b)
  {
    int kind;
    size_t n, commands;
    if (!(std::cin >> kind >> n >> commands))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<int, int>(n, commands);
      break;
    case 2:
      run_block<std::string, std::string>(n, commands);
      break;
    case 3:
      run_block<long long, int>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
