// SECRET grader main for hp_pair01_equal. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so == is interleaved with set / copy
//     construction / copy assignment / temporaries instead of being called in
//     one fixed loop;
//   * it instantiates TWO different pair types (pair<int,int> and
//     pair<std::string,int>), so a student.h that only works for int fails;
//   * it calls the pre-existing member the student may have edited (set) and
//     the one defined in the header on top of their == (operator!=), so an
//     edit that breaks either is caught;
//   * every printing command prints == AND != together, so an == that returns
//     a plausible-but-wrong value (always true, only comparing first, …) is
//     visible as a different pair of digits;
//   * every block ends with a full sweep over the array, which checks every
//     element and not only the ones a command asked about.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>, 2 = pair<std::string,int>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              cmp    : print (A[i] == A[j]) and (A[i] != A[j])
//       2 i a b            set    : A[i].set(a, b)
//       3 i j              assign : A[i] = A[j], then print A[i] == A[j]
//       4 i                copy   : copy construct from A[i] and compare back
//       5 i a b            temp   : compare A[i] with a temporary pair(a, b)
//       6 i                zero   : compare A[i] with a default-constructed pair
//
// Output: one line per printing command, then "S <equal-adjacent-count>" for
// the block's closing sweep.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <string>
#include <vector>

namespace
{

  // Taken by const reference on purpose: this only compiles if == and != are
  // const member functions, which is what the class declares.
  template <typename T1, typename T2>
  void print_pair_of_verdicts(const CP::pair<T1, T2> &left, const CP::pair<T1, T2> &right)
  {
    std::cout << (left == right ? 1 : 0) << ' ' << (left != right ? 1 : 0) << '\n';
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
        print_pair_of_verdicts(a[i], a[j]);
        break;
      }
      case 2:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i].set(first, second);
        break;
      }
      case 3:
      {
        size_t i, j;
        std::cin >> i >> j;
        a[i] = a[j];
        print_pair_of_verdicts(a[i], a[j]);
        break;
      }
      case 4:
      {
        size_t i;
        std::cin >> i;
        CP::pair<T1, T2> copied(a[i]);
        print_pair_of_verdicts(copied, a[i]);
        break;
      }
      case 5:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        print_pair_of_verdicts(a[i], CP::pair<T1, T2>(first, second));
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        print_pair_of_verdicts(a[i], CP::pair<T1, T2>());
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    size_t equal_adjacent = 0;
    for (size_t i = 0; i + 1 < a.size(); ++i)
    {
      if (a[i] == a[i + 1])
        ++equal_adjacent;
    }
    std::cout << "S " << equal_adjacent << '\n';
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
      run_block<std::string, int>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
