// SECRET grader main for hp_que09_reverse. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so reverse() is interleaved with push/pop/
//     front/back/size instead of being called once at the end;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     student.h that only works for int fails;
//   * it exercises the pre-existing members the student may have edited
//     (push/pop/front/back) and the ones they may not (copy constructor, copy
//     assignment, empty, size), so an edit that breaks them is caught;
//   * every block ends by draining the queue, which checks the whole logical
//     order rather than just its two ends.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = int, 2 = std::string, 3 = long long
//     a_1 ... a_n          n elements pushed in order into an empty queue
//     q command lines:
//       1 x                push x
//       2                  pop (ignored when the queue is empty)
//       3                  print front, or '-' when empty
//       4                  print back, or '-' when empty
//       5                  reverse
//       6                  print size
//       7                  copy check (see below)
//
// Output: one line per printing command, then "D <size>" and the drained
// elements of the block, space separated, on one line.

#include "queue.h"
#include "student.h"

#include <iostream>
#include <string>

namespace
{

  const char EMPTY_MARK = '-';

  // Taken by const reference on purpose: it only compiles if front()/back()
  // are const member functions, which is what the class declares.
  template <typename T>
  void print_front(const CP::queue<T> &q)
  {
    if (q.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << q.front() << '\n';
  }

  template <typename T>
  void print_back(const CP::queue<T> &q)
  {
    if (q.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << q.back() << '\n';
  }

  // Copy constructor + copy assignment must carry the queue's logical content,
  // including any lazy state the student introduced. The original must be
  // untouched afterwards, which the block's final drain then verifies.
  template <typename T>
  void copy_check(const CP::queue<T> &q)
  {
    CP::queue<T> copied(q);
    std::cout << "C " << copied.size();
    if (copied.empty())
      std::cout << ' ' << EMPTY_MARK << ' ' << EMPTY_MARK << '\n';
    else
      std::cout << ' ' << copied.front() << ' ' << copied.back() << '\n';

    CP::queue<T> assigned;
    assigned = copied;
    std::cout << 'A';
    while (!assigned.empty())
    {
      std::cout << ' ' << assigned.front();
      assigned.pop();
    }
    std::cout << '\n';
  }

  template <typename T>
  void run_block(size_t n, size_t commands)
  {
    CP::queue<T> q;
    for (size_t i = 0; i < n; ++i)
    {
      T value;
      std::cin >> value;
      q.push(value);
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
        q.push(value);
        break;
      }
      case 2:
        if (!q.empty())
          q.pop();
        break;
      case 3:
        print_front(q);
        break;
      case 4:
        print_back(q);
        break;
      case 5:
        q.reverse();
        break;
      case 6:
        std::cout << q.size() << '\n';
        break;
      case 7:
        copy_check(q);
        break;
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::cout << "D " << q.size() << '\n';
    while (!q.empty())
    {
      std::cout << q.front() << ' ';
      q.pop();
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
