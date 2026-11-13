// SECRET grader main for hp_pair10_ordering. Never shipped to students: it
// goes into problem_files role 'grader', is written into the judge sandbox,
// and is deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so the six operators are interleaved with
//     clamp, compare_sign, copy assignment and temporaries;
//   * it instantiates THREE pair types (pair<int,int>,
//     pair<std::string,int> and pair<long long,long long>), so a student.h
//     that only works for int fails;
//   * `laws` is the heart of it: over every ORDERED PAIR inside a short
//     window it checks the six consistency laws from the statement and
//     reports how many were violated. A submission whose operators are each
//     "almost right" but disagree on the equality edge reports a non-zero
//     count, so a mutually inconsistent set of six is caught even when every
//     individual answer looks plausible;
//   * `self` compares an element with itself, where 1 0 0 1 0 1 is the only
//     correct answer, and `sign` prints compare_sign in both directions,
//     which must be exact opposites;
//   * it calls the pre-existing member the student may have edited (clamp)
//     and the one the header defines on top of their < (compare_sign), so an
//     edit that breaks either is caught. clamp also returns a REFERENCE, and
//     the grader prints which object it points at;
//   * every block ends with a law sweep over all adjacent pairs plus a stable
//     merge sort driven by <, hashed — so the whole array is checked, in O(n)
//     and O(n log n), not just the windows a command asked about.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>, 2 = pair<std::string,int>,
//                                3 = pair<long long,long long>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              six    : the six operators between A[i] and A[j]
//       2 l len            laws   : law check over every pair in the window
//       3 i j k            clamp  : A[i].clamp(A[j], A[k]) plus its identity
//       4 i a b            assign : A[i] = pair(a, b)
//       5 i                self   : A[i] against itself
//       6 i                zero   : A[i] against a default-constructed pair
//       7 i j              sign   : compare_sign in both directions
//
// Output: one line per printing command, then
// "S <size> <violations> <codehash> <sortedhash>" for the block's closing
// sweep.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

  // FNV-1a. Unsigned on purpose: the judge compiles with
  // -fsanitize=signed-integer-overflow, and unsigned wrap-around is well
  // defined.
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

  // The six answers packed into one value, in the statement's order:
  // ==, !=, <, <=, >, >=.
  template <typename T1, typename T2>
  unsigned code_of(const CP::pair<T1, T2> &left, const CP::pair<T1, T2> &right)
  {
    unsigned code = 0;
    if (left == right)
      code |= 1u;
    if (left != right)
      code |= 2u;
    if (left < right)
      code |= 4u;
    if (left <= right)
      code |= 8u;
    if (left > right)
      code |= 16u;
    if (left >= right)
      code |= 32u;
    return code;
  }

  // How many of the six consistency laws this code breaks. A correct set of
  // operators can only ever produce 0 here.
  unsigned violations_of(unsigned code)
  {
    bool eq = (code & 1u) != 0;
    bool ne = (code & 2u) != 0;
    bool lt = (code & 4u) != 0;
    bool le = (code & 8u) != 0;
    bool gt = (code & 16u) != 0;
    bool ge = (code & 32u) != 0;

    unsigned broken = 0;
    if (eq == ne)
      ++broken;
    if (lt == ge)
      ++broken;
    if (gt == le)
      ++broken;
    if (le != (lt || eq))
      ++broken;
    if (ge != (gt || eq))
      ++broken;
    if ((lt ? 1 : 0) + (eq ? 1 : 0) + (gt ? 1 : 0) != 1)
      ++broken;
    return broken;
  }

  // Stable bottom-up merge sort driven entirely by the submission's <.
  // Hand-written rather than std::sort so an invalid ordering gives a wrong
  // answer instead of undefined behaviour inside the standard library.
  template <typename T1, typename T2>
  void stable_sort_pairs(std::vector<CP::pair<T1, T2>> &items)
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
          if (items[j] < items[i])
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

  void print_code(char tag, unsigned code)
  {
    std::cout << tag;
    for (unsigned bit = 0; bit < 6; ++bit)
      std::cout << ' ' << ((code >> bit) & 1u);
    std::cout << '\n';
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
        print_code('X', code_of(a[i], a[j]));
        break;
      }
      case 2:
      {
        size_t left, length;
        std::cin >> left >> length;
        if (left > a.size())
          left = a.size();
        if (length > a.size() - left)
          length = a.size() - left;
        unsigned broken = 0;
        std::ostringstream codes;
        for (size_t i = left; i < left + length; ++i)
        {
          for (size_t j = left; j < left + length; ++j)
          {
            unsigned code = code_of(a[i], a[j]);
            broken += violations_of(code);
            codes << code << ',';
          }
        }
        std::cout << "L " << length << ' ' << broken << ' '
                  << digest_of(codes.str()) << '\n';
        break;
      }
      case 3:
      {
        size_t i, j, k;
        std::cin >> i >> j >> k;
        const CP::pair<T1, T2> &result = a[i].clamp(a[j], a[k]);
        char which = 'X';
        if (&result == &a[i])
          which = 'S';
        else if (&result == &a[j])
          which = 'L';
        else if (&result == &a[k])
          which = 'H';
        std::cout << "C " << result.first << ' ' << result.second << ' ' << which << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        print_code('F', code_of(a[i], a[i]));
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        print_code('Z', code_of(a[i], CP::pair<T1, T2>()));
        break;
      }
      case 7:
      {
        size_t i, j;
        std::cin >> i >> j;
        std::cout << "G " << a[i].compare_sign(a[j]) << ' '
                  << a[j].compare_sign(a[i]) << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    unsigned broken = 0;
    std::ostringstream codes;
    for (size_t i = 0; i + 1 < a.size(); ++i)
    {
      unsigned code = code_of(a[i], a[i + 1]);
      broken += violations_of(code);
      codes << code << ',';
    }

    std::vector<CP::pair<T1, T2>> sorted(a);
    stable_sort_pairs(sorted);
    std::ostringstream order;
    for (size_t i = 0; i < sorted.size(); ++i)
      order << sorted[i].first << '|' << sorted[i].second << ';';

    std::cout << "S " << a.size() << ' ' << broken << ' '
              << digest_of(codes.str()) << ' ' << digest_of(order.str()) << '\n';
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
