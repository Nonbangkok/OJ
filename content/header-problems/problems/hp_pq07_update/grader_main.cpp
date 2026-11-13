// SECRET grader main for hp_pq07_update. Never shipped to students: it goes into
// problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so update() is interleaved with push/pop/top/
//     size instead of being called once at the end;
//   * it instantiates the class with four different <T, Comp> pairs, two of
//     which are NOT std::less: a min-heap over int, and a total order over a
//     struct that has no operator< at all. A student.h that compares with `<`
//     instead of the heap's own mLess therefore either answers the min-heap
//     blocks wrongly or does not compile at all;
//   * it exercises the members the student never edits (copy constructor,
//     copy assignment, push, pop, top, size, empty) around the target;
//   * update() is a MUTATING target: after every burst of updates the grader
//     keeps using the heap — top(), push(), pop(), the heap-property flag and
//     finally the whole drain — so an update that returns the right shape but
//     leaves the array un-heapified is caught even though update() itself
//     prints nothing;
//   * the `burst` command performs thousands of updates from one line of
//     input, with values drawn from the whole span, so roughly half of them
//     must sift UP and half must sift DOWN;
//   * out-of-range indices are asked on purpose and must throw.

#include "priority_queue.h"
#include "student.h"

#include <functional>
#include <iostream>

namespace
{

  const char EMPTY_MARK = '-';
  const char THREW_MARK = 'X';

  // ---- element types ------------------------------------------------------

  // Item has NO operator< on purpose: inside the class the only way to compare
  // two of them is the comparator object mLess, so `a < b` in a submission
  // breaks the build for these blocks instead of silently working.
  struct Item
  {
    long long w;
    long long id;
  };

  std::istream &operator>>(std::istream &in, Item &item) { return in >> item.w >> item.id; }

  std::ostream &operator<<(std::ostream &out, const Item &item)
  {
    return out << item.w << ':' << item.id;
  }

  struct ItemOrder
  {
    // A TOTAL order: two Items are equivalent only when they are identical, so
    // the expected output can never depend on which of two "equal" elements a
    // correct submission happens to pick.
    bool operator()(const Item &a, const Item &b) const
    {
      return a.w != b.w ? a.w < b.w : a.id > b.id;
    }
  };

  unsigned long long mix(int value)
  {
    return (unsigned long long)(unsigned int)value * 0x9E3779B97F4A7C15ULL;
  }

  unsigned long long mix(long long value)
  {
    return (unsigned long long)value * 0x9E3779B97F4A7C15ULL;
  }

  unsigned long long mix(const Item &value)
  {
    return (unsigned long long)value.w * 0x9E3779B97F4A7C15ULL +
           (unsigned long long)value.id * 0xBF58476D1CE4E5B9ULL;
  }

  // ---- procedural data ----------------------------------------------------

  // A `fill` command turns twenty bytes of input into a million pushes, which
  // is how the large cases stay far inside the per-problem testcase budget.
  struct Lcg
  {
    unsigned long long state;

    explicit Lcg(unsigned long long seed)
        : state(seed * 6364136223846793005ULL + 1442695040888963407ULL) {}

    unsigned long long next()
    {
      state = state * 6364136223846793005ULL + 1442695040888963407ULL;
      return state >> 17;
    }
  };

  // `span` is the size of the value universe: a small span means many ties,
  // which is what makes fixUp climb all the way to the root.
  template <typename T>
  T spread(unsigned long long raw, long long span);

  template <>
  int spread<int>(unsigned long long raw, long long span)
  {
    return (int)((long long)(raw % (unsigned long long)span) - span / 2);
  }

  template <>
  long long spread<long long>(unsigned long long raw, long long span)
  {
    return (long long)(raw % (unsigned long long)span) - span / 2;
  }

  template <>
  Item spread<Item>(unsigned long long raw, long long span)
  {
    Item item;
    item.w = (long long)(raw % (unsigned long long)span) - span / 2;
    item.id = (long long)((raw / (unsigned long long)span) % 1000ULL);
    return item;
  }

  // ---- shared command helpers --------------------------------------------

  // Taken by const reference on purpose: this only compiles while top() and
  // size() are const member functions, which is what the class declares.
  template <typename T, typename Comp>
  void print_top(const CP::priority_queue<T, Comp> &heap)
  {
    if (heap.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << heap.top() << '\n';
  }

  template <typename T, typename Comp>
  void fill(CP::priority_queue<T, Comp> &heap, size_t count, unsigned long long seed, long long span)
  {
    Lcg random(seed);
    for (size_t i = 0; i < count; i++)
      heap.push(spread<T>(random.next(), span));
  }

  // The copy constructor and the copy assignment must carry the whole heap.
  // Draining the COPY in priority order and hashing it checks the entire
  // order rather than the root alone, and the original has to survive
  // untouched — which the block's own epilogue then verifies.
  template <typename T, typename Comp>
  void copy_check(const CP::priority_queue<T, Comp> &heap)
  {
    CP::priority_queue<T, Comp> copied(heap);
    CP::priority_queue<T, Comp> assigned;
    assigned = copied;

    unsigned long long hash = 1469598103934665603ULL;
    size_t count = assigned.size();
    while (!assigned.empty())
    {
      hash = hash * 1099511628211ULL + mix(assigned.top());
      assigned.pop();
    }
    std::cout << "C " << count << ' ' << hash << '\n';
  }

  // Every block ends here. `limit` elements are popped in priority order and
  // hashed (the first few are printed as well), so a target that produced the
  // right answer while leaving the array corrupted is caught even when
  // nothing printed it at the time.
  template <typename T, typename Comp>
  void finish(CP::priority_queue<T, Comp> &heap, size_t limit)
  {
    std::cout << "E " << heap.size() << ' ' << (heap.heap_ok() ? 1 : 0);
    unsigned long long hash = 1469598103934665603ULL;
    size_t drained = 0;
    while (!heap.empty() && drained < limit)
    {
      if (drained < 40)
        std::cout << ' ' << heap.top();
      hash = hash * 1099511628211ULL + mix(heap.top());
      heap.pop();
      drained++;
    }
    std::cout << " # " << drained << ' ' << hash << ' ' << heap.size() << '\n';
  }

  // ---- the command stream -------------------------------------------------

  template <typename T, typename Comp>
  void run_block(size_t commands, size_t drain)
  {
    CP::priority_queue<T, Comp> heap;
    for (size_t index = 0; index < commands; index++)
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
          heap.push(value);
          break;
        }
        case 2:
          if (!heap.empty())
            heap.pop();
          break;
        case 3:
          print_top(heap);
          break;
        case 4:
          std::cout << heap.size() << '\n';
          break;
        case 5:
        {
          size_t count;
          unsigned long long seed;
          long long span;
          std::cin >> count >> seed >> span;
          fill(heap, count, seed, span);
          break;
        }
        case 6:
          copy_check(heap);
          break;
        case 7:
          std::cout << "H " << (heap.heap_ok() ? 1 : 0) << ' ' << heap.size() << '\n';
          break;
        case 8:
        {
          // THE TARGET, on a slot that exists. Nothing is printed: the effect
          // on the heap is what gets checked, later and repeatedly.
          size_t raw;
          T value;
          std::cin >> raw >> value;
          if (!heap.empty())
            heap.update(raw % heap.size(), value);
          break;
        }
        case 9:
        {
          // The raw index passed through unchanged: most of these are out of
          // range and must throw std::out_of_range — and must not damage the
          // heap on the way out.
          size_t raw;
          T value;
          std::cin >> raw >> value;
          try
          {
            heap.update(raw, value);
            std::cout << "U\n";
          }
          catch (const std::out_of_range &)
          {
            std::cout << THREW_MARK << '\n';
          }
          break;
        }
        case 10:
        {
          // A burst of `count` updates generated in here, then one line
          // summarising the heap: its size, its most important element and
          // whether the array is still a heap at all.
          size_t count;
          unsigned long long seed;
          long long span;
          std::cin >> count >> seed >> span;
          if (heap.empty())
          {
            std::cout << "B " << EMPTY_MARK << '\n';
            break;
          }
          Lcg random(seed);
          for (size_t q = 0; q < count; q++)
          {
            size_t index = (size_t)(random.next() % (unsigned long long)heap.size());
            heap.update(index, spread<T>(random.next(), span));
          }
          std::cout << "B " << heap.size() << ' ' << heap.top() << ' '
                    << (heap.heap_ok() ? 1 : 0) << '\n';
          break;
        }
        default:
          std::cerr << "unknown command " << op << '\n';
          return;
        }
    }

    finish(heap, drain);
  }

} // namespace

int main()
{
  std::ios_base::sync_with_stdio(false);
  std::cin.tie(nullptr);

  int blocks;
  if (!(std::cin >> blocks))
    return 0;

  for (int b = 0; b < blocks; b++)
  {
    int kind;
    size_t commands, drain;
    if (!(std::cin >> kind >> commands >> drain))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<int, std::less<int>>(commands, drain);
      break;
    case 2:
      run_block<int, std::greater<int>>(commands, drain);
      break;
    case 3:
      run_block<long long, std::less<long long>>(commands, drain);
      break;
    case 4:
      run_block<Item, ItemOrder>(commands, drain);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
