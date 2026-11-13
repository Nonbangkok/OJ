// SECRET grader main for hp_pair07_normalize. Never shipped to students: it
// goes into problem_files role 'grader', is written into the judge sandbox,
// and is deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so normalize() is interleaved with
//     normalize_twice, sorted, copy assignment and copy construction;
//   * it instantiates THREE pair types (pair<int,int>,
//     pair<std::string,std::string> and pair<long long,long long>), so a
//     student.h that only works for int fails. All three have T1 == T2,
//     which is what normalize() requires;
//   * `norm` calls normalize() TWICE on the same element and prints the pair
//     after each call on one line. An implementation that swaps
//     unconditionally produces the right answer for the first half and the
//     original order for the second, so idempotence is checked directly;
//   * `from` and `copy` normalise a copy and print the ORIGINAL as well, so
//     an implementation that reaches outside its own object is caught;
//   * it calls the pre-existing member the student may have edited (sorted)
//     and the one the header defines on top of their normalize()
//     (normalize_twice), so an edit that breaks either is caught;
//   * every block ends by normalising the whole array, counting how many
//     elements report sorted() — which must be ALL of them — and hashing the
//     result.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>,
//                                2 = pair<std::string,std::string>,
//                                3 = pair<long long,long long>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i                norm   : normalize twice, printing after each call
//       2 i                twice  : normalize_twice(), then print
//       3 i                ask    : print without normalising
//       4 i a b            assign : A[i] = pair(a, b), normalise, print
//       5 i j              from   : A[i] = A[j], normalise A[i], print both
//       6 i                copy   : normalise a copy, print copy and original
//
// Output: one line per printing command, then "S <size> <sorted> <hash>"
// for the block's closing sweep.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

  // FNV-1a over the streamed text of the sweep. Unsigned on purpose: the
  // judge compiles with -fsanitize=signed-integer-overflow, and unsigned
  // wrap-around is well defined.
  unsigned long long digest_of(const std::string &text)
  {
    unsigned long long hash = 1469598103934665603ULL;
    for (unsigned char byte : text)
    {
      hash ^= byte;
      hash *= 1099511628211ULL;
    }
    return hash;
  }

  // Taken by const reference on purpose: this only compiles if sorted() is a
  // const member function, which is what the class declares.
  template <typename T1, typename T2>
  void print_pair(const CP::pair<T1, T2> &p)
  {
    std::cout << p.first << ' ' << p.second << ' ' << (p.sorted() ? 1 : 0);
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
        size_t i;
        std::cin >> i;
        a[i].normalize();
        std::cout << "N ";
        print_pair(a[i]);
        a[i].normalize();
        std::cout << " | ";
        print_pair(a[i]);
        std::cout << '\n';
        break;
      }
      case 2:
      {
        size_t i;
        std::cin >> i;
        a[i].normalize_twice();
        std::cout << "T ";
        print_pair(a[i]);
        std::cout << '\n';
        break;
      }
      case 3:
      {
        size_t i;
        std::cin >> i;
        std::cout << "A ";
        print_pair(a[i]);
        std::cout << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        a[i].normalize();
        std::cout << "G ";
        print_pair(a[i]);
        std::cout << '\n';
        break;
      }
      case 5:
      {
        size_t i, j;
        std::cin >> i >> j;
        a[i] = a[j];
        a[i].normalize();
        std::cout << "F ";
        print_pair(a[i]);
        std::cout << " | ";
        print_pair(a[j]);
        std::cout << '\n';
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        CP::pair<T1, T2> copied(a[i]);
        copied.normalize();
        std::cout << "C ";
        print_pair(copied);
        std::cout << " | ";
        print_pair(a[i]);
        std::cout << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    size_t in_order = 0;
    std::ostringstream sweep;
    for (size_t i = 0; i < a.size(); ++i)
    {
      a[i].normalize();
      if (a[i].sorted())
        ++in_order;
      sweep << a[i].first << '|' << a[i].second << ';';
    }
    std::cout << "S " << a.size() << ' ' << in_order << ' ' << digest_of(sweep.str()) << '\n';
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
      run_block<long long, long long>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
