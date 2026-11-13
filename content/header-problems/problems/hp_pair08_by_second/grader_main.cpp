// SECRET grader main for hp_pair08_by_second. Never shipped to students: it
// goes into problem_files role 'grader', is written into the judge sandbox,
// and is deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so less_by_second is interleaved with
//     greater_by_second, equal_by_second, copy assignment and copy
//     construction;
//   * it instantiates THREE pair types (pair<std::string,int>,
//     pair<int,long long> and pair<std::string,std::string>), so a student.h
//     that only works for one component type fails;
//   * it USES the comparator for real: a stable bottom-up merge sort, run on
//     short windows during the stream and on the whole array at the end of
//     every block. A comparator that is right on individual queries but not
//     a strict ordering (true for equal pairs, or tie-broken the wrong way)
//     lands the sort on a different permutation, and the hash says so;
//   * the sort is hand-written rather than std::sort precisely because an
//     invalid comparator must produce a wrong answer, not a crash or
//     undefined behaviour inside the standard library;
//   * every comparison is printed in both directions, so two equal pairs show
//     up as "0 0" and a comparator that is not antisymmetric as "1 1";
//   * it calls the pre-existing member the student may have edited
//     (greater_by_second) and the one the header defines on top of their
//     comparator (equal_by_second), so an edit that breaks either is caught.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<std::string,int>,
//                                2 = pair<int,long long>,
//                                3 = pair<std::string,std::string>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              cmp     : both directions plus equal_by_second
//       2 i a b            assign  : A[i] = pair(a, b)
//       3 l len            sort    : sort a copy of the window, print it
//       4 i j              gt      : greater_by_second, both directions
//       5 i                zero    : A[i] against a default-constructed pair
//       6 i j              viacopy : A[i] against a copy of A[j]
//
// Output: one line per printing command, then
// "S <size> <hash> <first> <last>" for the block's closing sort.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

  // FNV-1a over the streamed text of the sorted array. Unsigned on purpose:
  // the judge compiles with -fsanitize=signed-integer-overflow, and unsigned
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

  // Stable bottom-up merge sort driven entirely by less_by_second. Taking the
  // right element only when it is STRICTLY less than the left one is what
  // makes it stable, and it is also what turns a comparator that claims equal
  // pairs are ordered into a visibly different permutation.
  template <typename T1, typename T2>
  void stable_sort_by_second(std::vector<CP::pair<T1, T2>> &items)
  {
    const size_t count = items.size();
    if (count < 2)
      return;
    std::vector<CP::pair<T1, T2>> buffer(items);

    for (size_t width = 1; width < count; width *= 2)
    {
      for (size_t left = 0; left < count; left += 2 * width)
      {
        size_t middle = left + width < count ? left + width : count;
        size_t right = left + 2 * width < count ? left + 2 * width : count;
        size_t i = left;
        size_t j = middle;
        size_t out = left;
        while (i < middle && j < right)
        {
          if (items[j].less_by_second(items[i]))
            buffer[out++] = items[j++];
          else
            buffer[out++] = items[i++];
        }
        while (i < middle)
          buffer[out++] = items[i++];
        while (j < right)
          buffer[out++] = items[j++];
      }
      items.swap(buffer);
    }
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
        std::cout << "C " << (a[i].less_by_second(a[j]) ? 1 : 0) << ' '
                  << (a[j].less_by_second(a[i]) ? 1 : 0) << ' '
                  << (a[i].equal_by_second(a[j]) ? 1 : 0) << '\n';
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
        size_t left, length;
        std::cin >> left >> length;
        if (left > a.size())
          left = a.size();
        if (length > a.size() - left)
          length = a.size() - left;
        std::vector<CP::pair<T1, T2>> window(a.begin() + left, a.begin() + left + length);
        stable_sort_by_second(window);
        std::cout << 'W' << ' ' << length;
        for (size_t i = 0; i < window.size(); ++i)
          std::cout << ' ' << window[i].first << ':' << window[i].second;
        std::cout << '\n';
        break;
      }
      case 4:
      {
        size_t i, j;
        std::cin >> i >> j;
        std::cout << "G " << (a[i].greater_by_second(a[j]) ? 1 : 0) << ' '
                  << (a[j].greater_by_second(a[i]) ? 1 : 0) << '\n';
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        const CP::pair<T1, T2> empty;
        std::cout << "Z " << (a[i].less_by_second(empty) ? 1 : 0) << ' '
                  << (empty.less_by_second(a[i]) ? 1 : 0) << '\n';
        break;
      }
      case 6:
      {
        size_t i, j;
        std::cin >> i >> j;
        CP::pair<T1, T2> copied(a[j]);
        std::cout << "V " << (a[i].less_by_second(copied) ? 1 : 0) << ' '
                  << (copied.less_by_second(a[i]) ? 1 : 0) << ' '
                  << (a[i].equal_by_second(copied) ? 1 : 0) << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::vector<CP::pair<T1, T2>> sorted(a);
    stable_sort_by_second(sorted);
    std::ostringstream sweep;
    for (size_t i = 0; i < sorted.size(); ++i)
      sweep << sorted[i].first << '|' << sorted[i].second << ';';
    std::cout << "S " << sorted.size() << ' ' << digest_of(sweep.str());
    if (!sorted.empty())
    {
      std::cout << ' ' << sorted.front().first << ':' << sorted.front().second
                << ' ' << sorted.back().first << ':' << sorted.back().second;
    }
    std::cout << '\n';
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
      run_block<std::string, int>(n, commands);
      break;
    case 2:
      run_block<int, long long>(n, commands);
      break;
    case 3:
      run_block<std::string, std::string>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
