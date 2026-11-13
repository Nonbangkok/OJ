// SECRET grader main for hp_stk08_min. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so min() is asked for hundreds of thousands
//     of times while the stack keeps changing — which is what makes an O(n)
//     scan inside min() time out on the large subtask;
//   * command 8 pops and then prints min(), which is the one thing a
//     "remember the smallest value I have ever seen" solution cannot do: the
//     minimum has to come BACK when the element carrying it leaves;
//   * this problem hands push/pop/top to the student as editable functions,
//     so the stream keeps checking that they still behave;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     solution that encodes numbers arithmetically instead of tracking a
//     position fails;
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
//       4                  print size
//       5                  print min, or '-' when empty
//       6                  copy check
//       7                  fold min into the running hash (no output)
//       8                  pop, then print min, or '-' when empty
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
  // is what lets a case ask for min() a hundred thousand times without a
  // hundred thousand lines of expected output, while staying exact: one
  // wrong minimum changes the hash.
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

  // Taken by const reference on purpose: it only compiles if min() really is
  // a const member function, which is what the class declares.
  template <typename T>
  void print_min(const CP::stack<T> &s)
  {
    if (s.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << s.min() << '\n';
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

  // A copy must carry whatever bookkeeping the student keeps for min(), not
  // just the elements: the copy's min() is read right here, and the copy is
  // then popped down to nothing, so a copied index that was left pointing at
  // the original's array shows up as a wrong answer.
  template <typename T>
  void copy_check(const CP::stack<T> &s)
  {
    CP::stack<T> copied(s);
    std::cout << "C " << copied.size();
    if (copied.empty())
      std::cout << ' ' << EMPTY_MARK << ' ' << EMPTY_MARK << '\n';
    else
      std::cout << ' ' << copied.top() << ' ' << copied.min() << '\n';

    CP::stack<T> assigned;
    assigned = copied;
    std::cout << 'A';
    size_t printed = 0;
    while (!assigned.empty())
    {
      fold_value(assigned.min());
      const T value = assigned.top();
      fold_value(value);
      if (printed < PRINT_LIMIT)
      {
        std::cout << ' ' << value;
        printed++;
      }
      assigned.pop();
    }
    std::cout << '\n';
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
        print_min(s);
        break;
      case 6:
        copy_check(s);
        break;
      case 7:
        if (!s.empty())
          fold_value(s.min());
        break;
      case 8:
        if (!s.empty())
          s.pop();
        std::cout << "R ";
        print_min(s);
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
