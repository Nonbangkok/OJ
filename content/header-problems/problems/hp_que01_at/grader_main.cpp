// SECRET grader main for hp_que01_at. Never shipped to students: it goes into
// problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so at() is interleaved with push/pop/front/
//     back/size instead of being asked in one batch at the start;
//   * the generator primes every block with pop/push churn, so most at()
//     calls land on a WRAPPED ring (mFront + i >= mCap) — an at() that
//     computes mData[mFront + i] reads garbage and fails;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     student.h that only works for int fails;
//   * it calls at() through a const reference, which only compiles if at() is
//     a const member function;
//   * it exercises the members the student did not write (push, pop, front,
//     back, size, empty, copy constructor, copy assignment) in between;
//   * `digest` folds at(0..size-1) into one number, so a single element read
//     from the wrong slot changes the output even on a huge queue, and the
//     block epilogue does the same through front()/pop() — the whole logical
//     order is checked, not just its two ends.
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
//       5 i                print at(i), or '-' when i >= size
//       6                  print size
//       7                  copy check (see below)
//       8                  print the digest of at(0) ... at(size - 1)
//
// Output: one line per printing command, then the block epilogue line
// "D <size> [elements] H <digest>".

#include "queue.h"
#include "student.h"

#include <iostream>
#include <string>

namespace
{

  const char EMPTY_MARK = '-';

  // Up to this many elements, the epilogue prints them one by one as well as
  // the digest; above it only the digest, which keeps the stored outputs small
  // while still depending on every element and its position.
  const size_t VERBOSE_DRAIN_MAX = 200;

  // A hand-rolled FNV-style fold. std::hash is deliberately avoided: its
  // values are libstdc++-implementation-defined, and the expected outputs are
  // produced by the build image while the judge compiles on its own box.
  // Everything here is unsigned, so -fsanitize=signed-integer-overflow has
  // nothing to complain about.
  const unsigned long long DIGEST_SEED = 1469598103934665603ULL;

  unsigned long long fold(unsigned long long state, unsigned long long value)
  {
    state ^= value;
    state *= 1099511628211ULL;
    state ^= state >> 29;
    return state;
  }

  unsigned long long value_of(int value)
  {
    return static_cast<unsigned long long>(static_cast<long long>(value));
  }

  unsigned long long value_of(long long value)
  {
    return static_cast<unsigned long long>(value);
  }

  unsigned long long value_of(const std::string &value)
  {
    unsigned long long state = DIGEST_SEED;
    for (char character : value)
      state = fold(state, static_cast<unsigned char>(character));
    return state;
  }

  // Taken by const reference on purpose: it only compiles if at()/front()/
  // back() are const member functions, which is what the class declares.
  template <typename T>
  void print_at(const CP::queue<T> &q, size_t index)
  {
    if (index >= q.size())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << q.at(index) << '\n';
  }

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

  // The whole logical order, read through at(), folded into one number.
  template <typename T>
  void print_digest(const CP::queue<T> &q)
  {
    unsigned long long state = DIGEST_SEED;
    for (size_t index = 0; index < q.size(); ++index)
      state = fold(state, value_of(q.at(index)));
    std::cout << "H " << state << '\n';
  }

  // Copy constructor + copy assignment must carry the queue's logical
  // content. The original must be untouched afterwards, which the block's
  // epilogue then verifies.
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
      std::cout << ' ' << assigned.at(0);
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
      {
        size_t index;
        std::cin >> index;
        print_at(q, index);
        break;
      }
      case 6:
        std::cout << q.size() << '\n';
        break;
      case 7:
        copy_check(q);
        break;
      case 8:
        print_digest(q);
        break;
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    const bool verbose = q.size() <= VERBOSE_DRAIN_MAX;
    unsigned long long state = DIGEST_SEED;
    std::cout << "D " << q.size();
    while (!q.empty())
    {
      if (verbose)
        std::cout << ' ' << q.front();
      state = fold(state, value_of(q.front()));
      q.pop();
    }
    std::cout << " H " << state << '\n';
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
