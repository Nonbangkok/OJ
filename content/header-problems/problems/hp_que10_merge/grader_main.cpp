// SECRET grader main for hp_que10_merge. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it keeps TWO queues per block and reads a COMMAND STREAM in which every
//     command names the queue it acts on, so merge is interleaved with
//     push/pop/front/back/size on both of them and runs in both directions;
//   * the generator shapes the two rings before each large merge: the SOURCE
//     is wrapped around the end of its own array, and the destination's run
//     of free slots starts near the end of ITS array, so the copy has to wrap
//     on both sides at once — and the two queues have different mCap, which
//     is what breaks a merge that reuses one modulus for both;
//   * it merges an empty source into a full queue and a full source into an
//     empty queue, and pushes into a queue that was just emptied, which a
//     merge that leaves `other` in a broken state fails;
//   * `merge` prints both sizes immediately, so a source that was not emptied
//     is caught at once rather than at the end of the block;
//   * `digest` walks a COPY of a queue front to back for a single line of
//     output, so one element copied from the wrong slot is caught even after
//     a 50,000-element merge;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     student.h that only works for int fails;
//   * both queues are drained at the end of the block, which checks the whole
//     logical order rather than just the sizes.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n0 n1 q         kind: 1 = int, 2 = std::string, 3 = long long
//     a_1 ... a_n0         pushed in order into queue 0
//     b_1 ... b_n1         pushed in order into queue 1
//     q command lines, each naming a queue s in {0, 1}:
//       1 s x              push x into queue s
//       2 s                pop queue s (ignored when it is empty)
//       3 s                print front of s, or '-' when empty
//       4 s                print back of s, or '-' when empty
//       5 s                queue[s].merge(queue[1 - s]), then print both sizes
//       6 s                print size of s
//       7 s                copy check on s (see below)
//       8 s                print the digest of s
//
// Output: one line per printing command, then one epilogue line per queue,
// "D <s> <size> [elements] H <digest>".

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

  // The whole logical order, read off a copy, folded into one number.
  template <typename T>
  void print_digest(const CP::queue<T> &q)
  {
    CP::queue<T> walk(q);
    unsigned long long state = DIGEST_SEED;
    while (!walk.empty())
    {
      state = fold(state, value_of(walk.front()));
      walk.pop();
    }
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
      std::cout << ' ' << assigned.front();
      assigned.pop();
    }
    std::cout << '\n';
  }

  template <typename T>
  void drain(int index, CP::queue<T> &q)
  {
    const bool verbose = q.size() <= VERBOSE_DRAIN_MAX;
    unsigned long long state = DIGEST_SEED;
    std::cout << "D " << index << ' ' << q.size();
    while (!q.empty())
    {
      if (verbose)
        std::cout << ' ' << q.front();
      state = fold(state, value_of(q.front()));
      q.pop();
    }
    std::cout << " H " << state << '\n';
  }

  template <typename T>
  void run_block(size_t n0, size_t n1, size_t commands)
  {
    CP::queue<T> queues[2];
    for (size_t i = 0; i < n0; ++i)
    {
      T value;
      std::cin >> value;
      queues[0].push(value);
    }
    for (size_t i = 0; i < n1; ++i)
    {
      T value;
      std::cin >> value;
      queues[1].push(value);
    }

    for (size_t i = 0; i < commands; ++i)
    {
      int op, which;
      if (!(std::cin >> op >> which))
        break;
      if (which != 0 && which != 1)
      {
        std::cerr << "bad queue index " << which << '\n';
        return;
      }
      CP::queue<T> &q = queues[which];
      CP::queue<T> &other = queues[1 - which];
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
        q.merge(other);
        std::cout << "M " << q.size() << ' ' << other.size() << '\n';
        break;
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

    drain(0, queues[0]);
    drain(1, queues[1]);
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
    size_t n0, n1, commands;
    if (!(std::cin >> kind >> n0 >> n1 >> commands))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<int>(n0, n1, commands);
      break;
    case 2:
      run_block<std::string>(n0, n1, commands);
      break;
    case 3:
      run_block<long long>(n0, n1, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
