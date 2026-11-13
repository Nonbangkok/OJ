// SECRET grader main for hp_pair06_maxpair. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so larger() is interleaved with larger3,
//     dominates, copy assignment and temporaries;
//   * it instantiates THREE pair types (pair<int,int>,
//     pair<std::string,int> and pair<long long,long long>), so a student.h
//     that only works for int fails;
//   * it prints WHICH OBJECT the returned reference points at, not only the
//     value: 'L' for the left operand, 'R' for the right one, 'X' for
//     anything else. A larger() that returns a copy (or a reference to a
//     local) can produce the right value and still prints X, so the
//     "reference, not a copy" requirement is checked directly rather than
//     hoped for;
//   * it calls the pre-existing member the student may have edited (larger3)
//     and the one the header defines on top of their larger (dominates), so
//     an edit that breaks either is caught;
//   * `self` and the tie-heavy inputs pin down the rule for equal pairs:
//     larger() must hand back the LEFT operand, so dom on two equal elements
//     prints "1 1";
//   * every block ends by folding the whole array through larger(), advancing
//     the champion only when the returned reference IS the new element — so a
//     copy-returning implementation never advances and prints the wrong
//     maximum.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>, 2 = pair<std::string,int>,
//                                3 = pair<long long,long long>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              max    : A[i].larger(A[j])
//       2 i j k            max3   : A[i].larger3(A[j], A[k])
//       3 i j              dom    : both directions of dominates
//       4 i a b            assign : A[i] = pair(a, b), then A[i] against itself
//       5 i                self   : A[i].larger(A[i])
//       6 i                zero   : A[i] against a default-constructed pair
//
// Output: one line per printing command, then "S <size> <argmax> <value>"
// for the block's closing fold.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <string>
#include <vector>

namespace
{

  // Which of the candidate objects the returned reference actually points at.
  // Comparing the addresses of objects that are all alive is well defined.
  template <typename T1, typename T2>
  char which_of_two(const CP::pair<T1, T2> *result,
                    const CP::pair<T1, T2> *left,
                    const CP::pair<T1, T2> *right)
  {
    if (result == left)
      return 'L';
    if (result == right)
      return 'R';
    return 'X';
  }

  template <typename T1, typename T2>
  void print_winner(char tag, const CP::pair<T1, T2> &result, char which)
  {
    std::cout << tag << ' ' << result.first << ' ' << result.second << ' ' << which << '\n';
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
        const CP::pair<T1, T2> &result = a[i].larger(a[j]);
        print_winner('M', result, which_of_two(&result, &a[i], &a[j]));
        break;
      }
      case 2:
      {
        size_t i, j, k;
        std::cin >> i >> j >> k;
        const CP::pair<T1, T2> &result = a[i].larger3(a[j], a[k]);
        char which = 'X';
        if (&result == &a[i])
          which = 'L';
        else if (&result == &a[j])
          which = 'M';
        else if (&result == &a[k])
          which = 'R';
        print_winner('3', result, which);
        break;
      }
      case 3:
      {
        size_t i, j;
        std::cin >> i >> j;
        std::cout << "D " << (a[i].dominates(a[j]) ? 1 : 0) << ' '
                  << (a[j].dominates(a[i]) ? 1 : 0) << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        const CP::pair<T1, T2> &result = a[i].larger(a[i]);
        print_winner('N', result, which_of_two(&result, &a[i], &a[i]));
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        const CP::pair<T1, T2> &result = a[i].larger(a[i]);
        print_winner('S', result, which_of_two(&result, &a[i], &a[i]));
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        const CP::pair<T1, T2> empty;
        const CP::pair<T1, T2> &result = a[i].larger(empty);
        print_winner('Z', result, which_of_two(&result, &a[i], &empty));
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    size_t champion = 0;
    for (size_t i = 1; i < a.size(); ++i)
    {
      const CP::pair<T1, T2> &result = a[champion].larger(a[i]);
      if (&result == &a[i])
        champion = i;
    }
    std::cout << "S " << a.size() << ' ' << champion << ' '
              << a[champion].first << ' ' << a[champion].second << '\n';
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
    case 3:
      run_block<long long, long long>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
