// SECRET grader main for hp_stk10_rotate. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM. The large cases call rotate tens of
//     thousands of times with the SAME k in long runs, which is what makes a
//     per-call O(k) rotation time out while a deferred one does not;
//   * the runs are broken up by push, pop, top and size, which is exactly
//     where deferred work has to be flushed. A solution that defers the
//     rotation but forgets to flush it before changing the stack produces
//     the wrong order here;
//   * the k values also include 0, 1, exactly size and more than size;
//   * it instantiates THREE different T (int, std::string, long long);
//   * it copies the stack, rotates only the copy, and reads the copy out, so
//     deferred state has to survive a copy and must not reach back into the
//     original;
//   * every block ends by draining the stack, which pins down the whole
//     order — the only way to see where a rotated block really landed.
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
//       5 k                rotate(k), and remember k
//       6                  copy check
//       7                  fold top into the running hash (no output)
//       8                  rotate(k) again with the last remembered k. This
//                          is two bytes of input and no output, which is how
//                          a case affords a run of tens of thousands of
//                          rotations on one block.
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
  // keeps a 30,000-element drain out of the expected-output file while
  // staying order sensitive: a block rotated by the wrong amount changes the
  // hash.
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

  // The copy must carry the stack's logical content, including any rotation
  // the student has not performed yet. The original is taken by const
  // reference and must come out untouched, which the block's final drain
  // then verifies.
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
    assigned.rotate(assigned.size());
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

    size_t last_k = 0;
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
        std::cin >> k;
        last_k = k;
        s.rotate(k);
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
        s.rotate(last_k);
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
