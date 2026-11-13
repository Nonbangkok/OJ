// SECRET grader main for hp_stk06_deep_push. Never shipped to students: it
// goes into problem_files role 'grader', is written into the judge sandbox,
// and is deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so deep_push is interleaved with push, pop,
//     top and size — this problem hands push/pop/top to the student as
//     editable functions, so a change that breaks one of them is caught here
//     and not only by deep_push's own output;
//   * the k values include 0 (a plain push), size (the bottom), size + 1 and
//     values far beyond the stack's height;
//   * command 8 is deep_push(k, top()) — the value is a REFERENCE into the
//     stack's own array, so an implementation that shifts (or reallocates)
//     before copying the value inserts garbage;
//   * it instantiates THREE different T (int, std::string, long long);
//   * every block ends by draining the stack, which checks the whole order —
//     the only way to see that the new element landed at the right depth.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = int, 2 = std::string, 3 = long long
//     a_1 ... a_n          n elements pushed in order onto an empty stack
//     q command lines:
//       1 x                push x
//       2                  pop (ignored when the stack is empty)
//       3                  print top, or '-' when empty
//       4                  print size
//       5 k x              deep_push(k, x)
//       6                  copy check
//       7                  fold top into the running hash (no output)
//       8 k                deep_push(k, top()) (ignored when empty)
//
// Output: one line per printing command, then "D <size>", the drained
// elements (at most the first 100 of them) and "H <hash>" per block.

#include "stack.h"
#include "student.h"

#include <iostream>
#include <string>

namespace
{

  const char EMPTY_MARK = '-';
  const size_t PRINT_LIMIT = 100;

  // FNV-1a over everything the grader looks at. Folding instead of printing
  // keeps a 10^4-element drain out of the expected-output file while staying
  // order sensitive: one element at the wrong depth changes the hash.
  unsigned long long gHash = 1469598103934665603ull;

  void fold(unsigned long long value)
  {
    gHash ^= value;
    gHash *= 1099511628211ull;
  }

  void fold_value(int value)
  {
    fold(static_cast<unsigned long long>(static_cast<long long>(value)));
  }

  void fold_value(long long value)
  {
    fold(static_cast<unsigned long long>(value));
  }

  void fold_value(const std::string &value)
  {
    fold(value.size());
    for (unsigned char byte : value)
      fold(byte);
  }

  template <typename T>
  void drain_into(CP::stack<T> &s, const char *label)
  {
    std::cout << label;
    size_t printed = 0;
    while (!s.empty())
    {
      const T value = s.top();
      fold_value(value);
      if (printed < PRINT_LIMIT)
      {
        std::cout << ' ' << value;
        printed++;
      }
      s.pop();
    }
    std::cout << '\n';
  }

  // Copy constructor + copy assignment must carry the whole stack. The
  // original is taken by const reference and must be untouched afterwards,
  // which the block's final drain then verifies.
  template <typename T>
  void copy_check(const CP::stack<T> &s)
  {
    CP::stack<T> copied(s);
    std::cout << "C " << copied.size();
    if (copied.empty())
      std::cout << ' ' << EMPTY_MARK << '\n';
    else
      std::cout << ' ' << copied.top() << '\n';

    CP::stack<T> assigned;
    assigned = copied;
    drain_into(assigned, "A");
  }

  template <typename T>
  void run_block(size_t n, size_t commands)
  {
    CP::stack<T> s;
    for (size_t i = 0; i < n; ++i)
    {
      T value;
      std::cin >> value;
      s.push(value);
    }

    for (size_t i = 0; i < commands; ++i)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        T value;
        std::cin >> value;
        s.push(value);
        break;
      }
      case 2:
        if (!s.empty())
          s.pop();
        break;
      case 3:
        if (s.empty())
          std::cout << EMPTY_MARK << '\n';
        else
          std::cout << s.top() << '\n';
        break;
      case 4:
        std::cout << s.size() << '\n';
        break;
      case 5:
      {
        size_t k;
        T value;
        std::cin >> k >> value;
        s.deep_push(k, value);
        break;
      }
      case 6:
        copy_check(s);
        break;
      case 7:
        if (!s.empty())
          fold_value(s.top());
        break;
      case 8:
      {
        size_t k;
        std::cin >> k;
        if (!s.empty())
          s.deep_push(k, s.top()); // aliasing on purpose
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::cout << "D " << s.size() << '\n';
    drain_into(s, "E");
    std::cout << "H " << gHash << '\n';
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
      run_block<int>(n, commands);
      break;
    case 2:
      run_block<std::string>(n, commands);
      break;
    case 3:
      run_block<long long>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
