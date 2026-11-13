// SECRET grader main for hp_stk02_second. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so second() is asked for while the stack
//     keeps changing — in particular right after a pop, which is where an
//     off-by-one shows up;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     student.h that only works for int fails;
//   * it asks for top() and second() next to each other, so a second() that
//     accidentally returns the top is caught immediately;
//   * it exercises the members the student did NOT write (push, pop, top,
//     size, empty, copy constructor, copy assignment);
//   * every block ends by draining the stack, which checks the whole order.
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
//       4                  print second, or '-' when fewer than 2 elements
//       5                  print size
//       6                  copy check
//       7                  fold second into the running hash (no output)
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
  // keeps a 10^5-element drain out of the expected-output file while staying
  // order sensitive: one element out of place changes the hash.
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

  // Taken by const reference on purpose: it only compiles if second() really
  // is a const member function, which is what the class declares.
  template <typename T>
  void print_second(const CP::stack<T> &s)
  {
    if (s.size() < 2)
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << s.second() << '\n';
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

  // Copy constructor + copy assignment must carry the whole stack, and the
  // copy's second() must agree with the original's. The original must be
  // untouched afterwards, which the block's final drain then verifies.
  template <typename T>
  void copy_check(const CP::stack<T> &s)
  {
    CP::stack<T> copied(s);
    std::cout << "C " << copied.size();
    if (copied.size() < 2)
      std::cout << ' ' << EMPTY_MARK << '\n';
    else
      std::cout << ' ' << copied.top() << ' ' << copied.second() << '\n';

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
        print_second(s);
        break;
      case 5:
        std::cout << s.size() << '\n';
        break;
      case 6:
        copy_check(s);
        break;
      case 7:
        if (s.size() >= 2)
          fold_value(s.second());
        break;
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
